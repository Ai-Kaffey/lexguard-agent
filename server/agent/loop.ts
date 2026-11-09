import { hasBlockingCitation, verifyText } from '../core/citations';
import { assertOutboundAllowed, classifyData } from '../core/routing';
import type { AuditLog } from '../core/audit';
import type { Citation, ContractRisk, DataClass } from '../core/schema';
import type { ChatMessage, LLMProvider, ToolCall } from '../providers/llm';
import { buildSystemPrompt } from './prompts';
import { dispatchTool, TOOL_DEFINITIONS, type ToolContext } from './tools';

export const MAX_TURNS = 5;

export type AgentEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: string }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      result: string;
      risks?: ContractRisk[];
      citations?: Citation[];
      hits?: { id: string; source: string; demo: boolean }[];
    }
  | { type: 'verification'; citations: Citation[] }
  | { type: 'review_required'; message: string }
  | { type: 'done'; content: string; citations: Citation[]; dataClass: DataClass }
  | { type: 'error'; message: string };

export interface AgentContext {
  llm: LLMProvider;
  toolCtx: ToolContext;
  audit: AuditLog;
  who: string;
  sessionId: string;
}

function err(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** C2 Agent 循环：任务拆解 → 工具调度 → 结果校验 → 人工闸门 */
export async function* runAgent(
  message: string,
  history: ChatMessage[],
  ctx: AgentContext,
): AsyncGenerator<AgentEvent, void, unknown> {
  const dataClass = classifyData(message);
  try {
    assertOutboundAllowed(dataClass, ctx.llm.isLocal ? 'local' : 'cloud');
  } catch (e) {
    ctx.audit.record({
      who: ctx.who,
      dataClass,
      action: 'outbound_blocked',
      detail: err(e),
    });
    yield { type: 'error', message: err(e) };
    return;
  }

  ctx.audit.record({
    who: ctx.who,
    agent: 'lexguard-main',
    dataClass,
    action: 'chat_start',
    detail: `session=${ctx.sessionId}`,
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...history.filter((m) => m.role !== 'system').slice(-12),
    { role: 'user', content: message },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    let draft = '';
    let content = '';
    let toolCalls: ToolCall[] = [];

    try {
      for await (const ev of ctx.llm.streamChat(messages, TOOL_DEFINITIONS)) {
        if (ev.type === 'delta') {
          draft += ev.text;
          yield { type: 'delta', text: ev.text };
        } else {
          content = ev.content || draft;
          toolCalls = ev.toolCalls;
        }
      }
    } catch (e) {
      yield { type: 'error', message: `模型调用失败：${err(e)}` };
      return;
    }

    if (toolCalls.length > 0) {
      messages.push({ role: 'assistant', content: draft, tool_calls: toolCalls });
      for (const call of toolCalls) {
        yield { type: 'tool_call', id: call.id, name: call.name, args: call.arguments };
        let out;
        try {
          out = await dispatchTool(call.name, call.arguments, ctx.toolCtx);
        } catch (e) {
          out = { result: `工具执行失败：${err(e)}` };
        }
        yield { type: 'tool_result', id: call.id, name: call.name, ...out };
        ctx.audit.record({
          who: ctx.who,
          agent: 'lexguard-main',
          tool: call.name,
          dataClass,
          action: 'tool_call',
          source: ctx.toolCtx.ds.name,
        });
        messages.push({ role: 'tool', tool_call_id: call.id, content: out.result });
      }
      continue;
    }

    const citations = await verifyText(content, ctx.toolCtx.ds);
    yield { type: 'verification', citations };

    for (const c of citations) {
      ctx.audit.record({
        who: ctx.who,
        agent: 'lexguard-main',
        tool: 'verify_citations',
        dataClass,
        action: 'verification',
        citation: c.raw,
        verification: c.status,
        source: ctx.toolCtx.ds.name,
      });
    }

    yield {
      type: 'review_required',
      message: hasBlockingCitation(citations)
        ? '检出已废止 / 库中不存在 / 格式异常的引用，须修正后重新生成，禁止导出'
        : '引用已进入复核队列，请逐条确认并签字后方可导出',
    };

    yield { type: 'done', content, citations, dataClass };
    return;
  }

  yield { type: 'error', message: `达到最大工具轮次 ${MAX_TURNS}，已停止以避免失控循环` };
}
