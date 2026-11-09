import { describe, expect, it } from 'vitest';
import { runAgent, type AgentEvent } from '../server/agent/loop';
import { dispatchTool, TOOL_DEFINITIONS } from '../server/agent/tools';
import { AuditLog } from '../server/core/audit';
import { LocalFixtureProvider } from '../server/providers/datasource';
import { MockLLMProvider, OpenAICompatibleProvider } from '../server/providers/llm';

const ds = new LocalFixtureProvider();

async function collect(message: string, llm: MockLLMProvider | OpenAICompatibleProvider) {
  const audit = new AuditLog();
  const events: AgentEvent[] = [];
  for await (const ev of runAgent(message, [], { llm, toolCtx: { ds }, audit, who: 'tester', sessionId: 'test' })) {
    events.push(ev);
  }
  return { events, audit };
}

const types = (events: AgentEvent[]) => events.map((e) => e.type);

describe('C1 / C2 Agent 循环', () => {
  it('工具定义齐全且参数 schema 合法', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      'search_laws', 'search_cases', 'verify_citations',
      'review_contract', 'search_company', 'rag_search',
    ]);
    expect(TOOL_DEFINITIONS.every((t) => t.parameters.type === 'object')).toBe(true);
  });

  it('Mock LLM 无密钥跑通「工具调用 → 带引用回答」完整链路', async () => {
    const { events, audit } = await collect('这份合同有哪些风险？', new MockLLMProvider());
    const t = types(events);
    expect(t).toContain('tool_call');
    expect(t).toContain('tool_result');
    expect(t).toContain('verification');
    expect(t).toContain('review_required');
    expect(t).toContain('done');
    const done = events.find((e) => e.type === 'done');
    expect(done?.type === 'done' && done.content).toContain('《中华人民共和国民法典》第496条');
    expect(audit.size()).toBeGreaterThan(1);
  });

  it('A 类数据在调用外部模型前被拦截，不产生任何网络请求', async () => {
    const external = new OpenAICompatibleProvider('http://127.0.0.1:1/v1', 'test', 'k');
    const { events } = await collect('绝密资料：身份证 110101199003072316，帮我审查', external);
    expect(types(events)).toEqual(['error']);
    expect(events[0].type === 'error' && events[0].message).toContain('不出域');
  });

  it('未知工具被安全拒绝', async () => {
    const out = await dispatchTool('no_such_tool', '{}', { ds });
    expect(out.result).toContain('未知工具');
  });

  it('非法参数不会导致崩溃', async () => {
    const out = await dispatchTool('review_contract', '{broken', { ds });
    expect(out.result).toContain('不是合法 JSON');
  });
});
