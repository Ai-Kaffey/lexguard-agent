import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditLog } from './core/audit';
import { Persistence, type PersistedReview, type PersistedSession } from './core/persistence';
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
import { FactStore } from './core/facts';
import { SkillRegistry } from './core/skills';
import { demoTenancy } from './core/tenancy';
import { UsageMeter, type UsageRecord } from './core/usage';
import type { AuditEvent, Citation, ContractRisk } from './core/schema';
import { FIXTURE_STATS, createManagedDataSource } from './providers/datasource';
import { createLLMProvider, type ChatMessage } from './providers/llm';
import { mcpToolList } from './mcp/handler';
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
const ds = createManagedDataSource({
  mode: dsMode,
  url: process.env.LAW_DATASOURCE_URL,
  token: process.env.LAW_DATASOURCE_TOKEN,
});

// 关键状态落盘为 append-only JSONL，服务重启后可回放
const persistence = new Persistence(
  process.env.LEXGUARD_DATA_DIR ?? path.resolve(process.cwd(), 'data'),
);
const audit = new AuditLog((e) => persistence.audit.append(e));
audit.restore(persistence.audit.readAll<AuditEvent>());
const skills = new SkillRegistry();
const facts = new FactStore();
const tenancy = demoTenancy();
const usage = new UsageMeter((r) => persistence.usage.append(r));
usage.restore(persistence.usage.readAll<UsageRecord>());

// 演示事实：故意放入一条冲突取值，用来展示「矛盾显式暴露、不自动合并」的能力
facts.add({ subject: '甲公司', predicate: '注册资本', value: '1000万元', source: 'DEMO-工商摘录', demo: true, verified: false });
facts.add({ subject: '甲公司', predicate: '注册资本', value: '1200万元', source: 'DEMO-尽调访谈纪要', demo: true, verified: false });
facts.add({ subject: '甲公司', predicate: '涉诉记录', value: '2条', source: 'DEMO-裁判文书检索', demo: true, verified: false });

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

// 启动时回放签字记录与会话结果（按 sessionId 取最后一条）
const reviewGroups = new Map<string, PersistedReview[]>();
for (const r of persistence.reviews.readAll<PersistedReview>()) {
  if (r.key === '__reset__') {
    reviewGroups.set(r.sessionId, []);
    continue;
  }
  const arr = reviewGroups.get(r.sessionId) ?? [];
  arr.push(r);
  reviewGroups.set(r.sessionId, arr);
}
for (const [sid, rows] of reviewGroups) {
  gateFor(sid).restore(rows.map((r) => ({
    citationRaw: r.key,
    reviewer: r.reviewer,
    decision: r.decision as 'approved' | 'rejected' | 'edited',
    at: r.at,
    ...(r.note ? { note: r.note } : {}),
  })));
}
for (const row of persistence.sessions.readAll<PersistedSession>()) {
  results.set(row.sessionId, {
    content: row.content,
    citations: row.citations as Citation[],
    risks: [],
  });
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
  if (message.length > 8000) {
    res.status(400).json({ error: 'message 过长（上限 8000 字符）' });
    return;
  }
  // sessionId 只接受安全字符，避免路径穿越或被猜测的会话键
  const sid = /^[A-Za-z0-9_-]{1,64}$/.test(sessionId) ? sessionId : 'default';

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const ctx = { llm, toolCtx: { ds }, audit, usage, who, sessionId: sid };
  // 新一轮对话重置复核闸门，避免沿用上一轮的签字记录；重置标记同步落盘
  gates.set(sid, new ReviewGate());
  persistence.reviews.append({
    sessionId: sid, key: '__reset__', reviewer: 'system', decision: 'approved',
    at: new Date().toISOString(),
  });
  const gate = gates.get(sid)!;

  try {
    for await (const ev of runAgent(message, history, ctx)) {
      send(ev);
      if (ev.type === 'done') {
        results.set(sid, { content: ev.content, citations: ev.citations, risks: [] });
        persistence.sessions.append({
          sessionId: sid, content: ev.content, citations: ev.citations,
          at: new Date().toISOString(),
        });
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
  const sid = /^[A-Za-z0-9_-]{1,64}$/.test(sessionId) ? sessionId : 'default';
  const gate = gateFor(sid);
  const record = gate.approve(key, reviewer, decision, note);
  persistence.reviews.append({
    sessionId: sid, key, reviewer, decision, at: record.at,
    ...(note ? { note } : {}),
  });
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

/** 落盘状态：兑现「审计日志留存」承诺，可核对是否真的写到了磁盘 */
app.get('/api/persistence', (_req: Request, res: Response) => {
  res.json(persistence.stats());
});

/* ---------------- 第 3 期：平台化能力 API ---------------- */

/** 一次性汇总，供工作台「平台」面板渲染 */
app.get('/api/platform', (_req: Request, res: Response) => {
  res.json({
    skills: skills.list(),
    facts: facts.list(),
    contradictions: facts.contradictions(),
    gaps: facts.missing('甲公司', ['注册资本', '涉诉记录', '重大合同', '知识产权', '劳动用工']),
    usage: usage.summary(),
    datasource: { name: ds.name, demo: ds.demo, degraded: ds.isDegraded, stats: FIXTURE_STATS },
    tenancy: { tenantId: 'tenant-demo', matters: tenancy.getTenant('tenant-demo')?.matters ?? [] },
    mcpTools: mcpToolList().map((t) => t.name),
  });
});

/** C4 逐项确认 */
app.post('/api/skills/check', (req: Request, res: Response) => {
  const { id, answeredIds = [], version } = req.body as {
    id?: string; answeredIds?: string[]; version?: string;
  };
  if (!id) {
    res.status(400).json({ error: 'id 必填' });
    return;
  }
  res.json(skills.runChecklist(id, answeredIds, version));
});

/** C5 新增事实：无出处一律拒绝 */
app.post('/api/facts', (req: Request, res: Response) => {
  const { subject, predicate, value, source } = req.body as Record<string, string>;
  try {
    const fact = facts.add({
      subject: subject ?? '', predicate: predicate ?? '', value: value ?? '',
      source: source ?? '', demo: true, verified: false,
    });
    audit.record({ who: 'api', dataClass: 'C', action: 'fact_add', detail: fact.id });
    res.json(fact);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** E3 用量（token 为估算，非计费口径） */
app.get('/api/usage', (_req: Request, res: Response) => {
  res.json({ ...usage.summary(), recent: usage.all().slice(-20) });
});

/** E2 数据源健康检查；失败会降级到 DEMO，并在核验结果里显式体现 */
app.post('/api/datasources/health', async (_req: Request, res: Response) => {
  const health = await ds.health();
  audit.record({
    who: 'api', dataClass: 'C', action: 'datasource_health',
    detail: `${health.ok ? '正常' : '降级'}｜${health.active}`,
  });
  res.json(health);
});

/** E1 伦理墙：只返回该用户可见的项目 */
app.get('/api/tenants/:id/matters', (req: Request, res: Response) => {
  // 中文用户名不能放 HTTP header（ByteString 限制），统一走 query 参数
  const userId = String(req.query.userId ?? req.header('x-user-id') ?? 'anonymous');
  res.json({
    userId,
    tenantId: req.params.id,
    matters: tenancy.listMatters(userId, req.params.id),
    note: '伦理墙：被 blockedUsers 排除或不在 allowedUsers 中的项目不会出现在列表里',
  });
});

/** D4 暴露的 MCP 工具清单 */
app.get('/api/mcp/tools', (_req: Request, res: Response) => {
  res.json({ protocolVersion: '2024-11-05', transport: 'stdio', command: 'npm run mcp', tools: mcpToolList() });
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
