import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditLog } from './core/audit';
import { verifyText } from './core/citations';
import { countByLevel, reviewContract, RISK_RULES } from './core/contract';
import {
  DOCUMENT_KEY,
  DISCLAIMER,
  ExportBlockedError,
  ReviewGate,
  buildExportBundle,
} from './core/review';
import { classifyData } from './core/routing';
import type { Citation, ContractRisk } from './core/schema';
import { FIXTURE_STATS, createDataSource } from './providers/datasource';
import { createLLMProvider, type ChatMessage } from './providers/llm';
import { runAgent } from './agent/loop';

const forced = process.env.LLM_PROVIDER;
const apiKey = process.env.LLM_API_KEY ?? '';
const provider: 'mock' | 'openai' =
  forced === 'openai' ? 'openai' : forced === 'mock' ? 'mock' : apiKey ? 'openai' : 'mock';

const llm = createLLMProvider({
  provider,
  baseUrl: process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
  model: process.env.LLM_MODEL ?? 'deepseek-chat',
  apiKey,
});

const dsMode = process.env.LAW_DATASOURCE === 'http' && process.env.LAW_DATASOURCE_URL ? 'http' : 'local';
const ds = createDataSource({
  mode: dsMode,
  url: process.env.LAW_DATASOURCE_URL,
  token: process.env.LAW_DATASOURCE_TOKEN,
});

const audit = new AuditLog();
const gates = new Map<string, ReviewGate>();
const results = new Map<string, { content: string; citations: Citation[]; risks: ContractRisk[] }>();

const app = express();
app.use(express.json({ limit: '2mb' }));

function gateFor(sessionId: string): ReviewGate {
  let g = gates.get(sessionId);
  if (!g) {
    g = new ReviewGate();
    gates.set(sessionId, g);
  }
  return g;
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    name: 'LexGuard',
    disclaimer: DISCLAIMER,
    llm: { provider: llm.name, model: llm.model, isLocal: llm.isLocal },
    datasource: { name: ds.name, demo: ds.demo, stats: FIXTURE_STATS },
    ruleCount: RISK_RULES.length,
    auditEvents: audit.size(),
  });
});

/** C3 SSE 事件流：delta / tool_call / tool_result / verification / review_required / done / error */
app.post('/api/chat', async (req: Request, res: Response) => {
  const { message, history = [], sessionId = 'default', who = 'anonymous' } = req.body as {
    message?: string;
    history?: ChatMessage[];
    sessionId?: string;
    who?: string;
  };
  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'message 不能为空' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const ctx = { llm, toolCtx: { ds }, audit, who, sessionId };
  // 新一轮对话重置复核闸门，避免沿用上一轮的签字记录
  gates.set(sessionId, new ReviewGate());
  const gate = gates.get(sessionId)!;

  try {
    for await (const ev of runAgent(message, history, ctx)) {
      send(ev);
      if (ev.type === 'done') {
        results.set(sessionId, { content: ev.content, citations: ev.citations, risks: [] });
        gate.markVerification();
      }
    }
  } catch (e) {
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
});

/** B1 + D2：合同审查，依据法条自动走 A2 核验 */
app.post('/api/contract/review', async (req: Request, res: Response) => {
  const { text } = req.body as { text?: string };
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text 不能为空' });
    return;
  }
  const dc = classifyData(text);
  const risks = reviewContract(text);
  const citations = await verifyText(risks.flatMap((r) => r.basis).join('；'), ds);
  audit.record({
    who: 'api', tool: 'review_contract', dataClass: dc,
    action: 'contract_review', source: ds.name,
    detail: `命中 ${risks.length} 条风险规则`,
  });
  res.json({
    disclaimer: DISCLAIMER,
    dataClass: dc,
    risks,
    counts: countByLevel(risks),
    citations,
    note: '规则引擎结果可复现；未命中不代表合同无风险，关键条款须人工复核',
  });
});

/** A1/A2：单独核验一段文本里的引用 */
app.post('/api/verify', async (req: Request, res: Response) => {
  const { text } = req.body as { text?: string };
  const citations = await verifyText(text ?? '', ds);
  res.json({ datasource: ds.name, demo: ds.demo, citations });
});

/** A4：逐条人工复核签字 */
app.post('/api/review', (req: Request, res: Response) => {
  const { sessionId = 'default', key, reviewer, decision = 'approved', note } = req.body as {
    sessionId?: string;
    key?: string;
    reviewer?: string;
    decision?: 'approved' | 'rejected' | 'edited';
    note?: string;
  };
  if (!key || !reviewer) {
    res.status(400).json({ error: 'key 与 reviewer 必填' });
    return;
  }
  const gate = gateFor(sessionId);
  const record = gate.approve(key, reviewer, decision, note);
  audit.record({
    who: reviewer, action: 'review_sign', dataClass: 'B',
    citation: key, reviewer, detail: decision,
  });
  res.json({ state: gate.getState(), records: gate.list(), record });
});

app.get('/api/review/:sessionId', (req: Request, res: Response) => {
  const gate = gateFor(req.params.sessionId);
  const stored = results.get(req.params.sessionId);
  res.json({
    state: gate.getState(),
    records: gate.list(),
    fullyApproved: stored ? gate.isFullyApproved(stored.citations) : false,
    pendingKeys: stored
      ? [DOCUMENT_KEY, ...stored.citations.map((c) => c.raw)].filter(
          (k) => !gate.list().some((r) => r.citationRaw === k),
        )
      : [],
  });
});

/** A4 闸门 + A7 四件套导出：未签字或含阻断引用一律 403 */
app.get('/api/export/:sessionId', (req: Request, res: Response) => {
  const stored = results.get(req.params.sessionId);
  if (!stored) {
    res.status(404).json({ error: '会话尚无生成结果' });
    return;
  }
  const gate = gateFor(req.params.sessionId);
  try {
    gate.assertExportable(stored.citations);
  } catch (e) {
    res.status(403).json({
      error: e instanceof ExportBlockedError ? e.message : '导出被拒绝',
      state: gate.getState(),
      pendingKeys: [DOCUMENT_KEY, ...stored.citations.map((c) => c.raw)].filter(
        (k) => !gate.list().some((r) => r.citationRaw === k),
      ),
    });
    return;
  }
  const reviewedBy = gate.list().find((r) => r.citationRaw === DOCUMENT_KEY)?.reviewer ?? '未签字';
  const bundle = buildExportBundle({
    report: stored.content,
    citations: stored.citations,
    records: gate.list(),
    toolName: `LexGuard / ${llm.name}`,
    reviewedBy,
  });
  gate.markExported();
  audit.record({
    who: reviewedBy, action: 'export', dataClass: 'B',
    reviewer: reviewedBy, exported: true, detail: '导出四件套',
  });
  res.json(bundle);
});

app.get('/api/audit', (_req: Request, res: Response) => {
  res.json({ count: audit.size(), events: audit.all(), report: audit.toReport() });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');
app.use(express.static(dist));
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(dist, 'index.html'), (e) => {
    if (e) res.status(200).json({ name: 'LexGuard API', hint: '前端尚未构建，请先 npm run build' });
  });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`LexGuard 已启动：http://localhost:${port}`);
  console.log(`LLM=${llm.name}/${llm.model}｜数据源=${ds.name}（demo=${ds.demo}）｜规则=${RISK_RULES.length}`);
  console.log(DISCLAIMER);
});
