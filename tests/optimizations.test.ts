import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonlStore, Persistence } from '../server/core/persistence';
import { AuditLog } from '../server/core/audit';
import { UsageMeter } from '../server/core/usage';
import { ReviewGate, buildAiUsageDeclaration, renderDeclaration, DOCUMENT_KEY } from '../server/core/review';
import { mergeCitations } from '../server/core/citations';
import { MockLLMProvider, OpenAICompatibleProvider, type ChatMessage } from '../server/providers/llm';
import { runAgent } from '../server/agent/loop';
import { LocalFixtureProvider } from '../server/providers/datasource';
import type { Citation } from '../server/core/schema';

const ds = new LocalFixtureProvider();
function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lexguard-test-'));
}

describe('持久化：宣称的留存必须真的落盘', () => {
  it('JsonlStore 追加写、读回、跳过损坏行', () => {
    const dir = tmp();
    try {
      const store = new JsonlStore(dir, 'x.jsonl');
      store.append({ a: 1 });
      store.append({ a: 2 });
      fs.appendFileSync(store.file, '{broken json}\n', 'utf8');
      expect(store.readAll<{ a: number }>()).toEqual([{ a: 1 }, { a: 2 }]);
      expect(store.size()).toBe(2);
      expect(fs.existsSync(store.file)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AuditLog 写盘回调生效，回放不重复写盘', () => {
    const dir = tmp();
    try {
      const writes: unknown[] = [];
      const log = new AuditLog((e) => writes.push(e));
      log.record({ who: 'u', dataClass: 'C', action: 'test' });
      expect(writes).toHaveLength(1);
      const replayed = log.all();
      const restored = new AuditLog((e) => writes.push(e));
      restored.restore([...replayed]);
      expect(restored.size()).toBe(1);
      expect(writes).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('UsageMeter 写盘回调与回放', () => {
    const writes: unknown[] = [];
    const meter = new UsageMeter((r) => writes.push(r));
    meter.recordLLM('s1', 'u', 40);
    meter.recordTool('s1', 'u', 'verify_citations');
    const restored = new UsageMeter();
    restored.restore([...meter.all()]);
    expect(restored.summary().tokensEstimate).toBe(10);
    expect(restored.summary().toolCalls).toBe(1);
    expect(writes).toHaveLength(2);
  });

  it('Persistence 四张表统计准确', () => {
    const dir = tmp();
    try {
      const p = new Persistence(dir);
      p.audit.append({ action: 'a' });
      p.usage.append({ kind: 'llm' });
      p.reviews.append({ sessionId: 's', key: DOCUMENT_KEY });
      p.sessions.append({ sessionId: 's', content: 'x' });
      expect(p.stats()).toMatchObject({ auditEvents: 1, usageRecords: 1, reviewRecords: 1, sessionRecords: 1 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ReviewGate.restore 恢复逐条签字后可导出', () => {
    const g = new ReviewGate();
    g.markVerification();
    g.approve(DOCUMENT_KEY, '张律师');
    const records = g.list();
    const restored = new ReviewGate();
    restored.restore(records);
    expect(restored.getState()).toBe('pending_review');
    expect(restored.isFullyApproved([])).toBe(true);
  });
});

describe('引用核验覆盖与声明完整性', () => {
  const c = (raw: string): Citation => ({
    raw, kind: 'law', status: 'demo_only', reason: '演示语料',
  });

  it('mergeCitations 按原文去重并保持顺序', () => {
    expect(mergeCitations([c('A'), c('B')], [c('B'), c('C')]).map((x) => x.raw)).toEqual(['A', 'B', 'C']);
  });

  it('AI 使用声明包含逐条复核签字明细（此前 records 被丢弃）', () => {
    const d = buildAiUsageDeclaration({
      toolName: 'LexGuard', usedIn: ['合同审查'], reviewedBy: '张律师',
      citations: [c('《中华人民共和国民法典》第496条')],
      records: [{ citationRaw: DOCUMENT_KEY, reviewer: '张律师', decision: 'approved', at: '2026-11-10T00:00:00.000Z' }],
    });
    const text = renderDeclaration(d);
    expect(text).toContain('人工复核签字明细');
    expect(text).toContain('张律师');
    expect(d.reviewRecords).toHaveLength(1);
  });
});

describe('演示与输入安全', () => {
  async function mockAnswer(question: string): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: question },
      { role: 'tool', tool_call_id: '1', content: '工具结果' },
    ];
    let text = '';
    for await (const ev of new MockLLMProvider().streamChat(messages, [])) {
      if (ev.type === 'delta') text += ev.text;
    }
    return text;
  }

  it('不同问题给出不同回答，不再千篇一律', async () => {
    const labor = await mockAnswer('未签书面劳动合同的二倍工资依据');
    const penalty = await mockAnswer('违约金过高能否请求调减');
    expect(labor).toContain('第82条');
    expect(penalty).toContain('第585条');
    expect(labor).not.toBe(penalty);
  });

  it('敏感信息藏在 history 里同样被拦截', async () => {
    const external = new OpenAICompatibleProvider('http://127.0.0.1:1/v1', 'm', 'k');
    const audit = new AuditLog();
    const events = [];
    for await (const ev of runAgent('继续分析', [{ role: 'user', content: '绝密资料 身份证 110101199003072316' }], {
      llm: external, toolCtx: { ds }, audit, who: 'tester', sessionId: 's',
    })) events.push(ev);
    expect(events[0]?.type).toBe('error');
  });
});
