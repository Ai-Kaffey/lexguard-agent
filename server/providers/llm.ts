/**
 * C1 LLM Provider：OpenAI 兼容 /chat/completions 流式解析（原生 fetch，零 SDK 依赖）
 * + 内置 Mock LLM（无需任何密钥，断网也能完整演示与跑 CI）。
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type LLMEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; content: string; toolCalls: ToolCall[] };

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly isLocal: boolean;
  streamChat(messages: ChatMessage[], tools: ToolDefinition[]): AsyncGenerator<LLMEvent, void, unknown>;
}

const MAX_TOOL_CALLS = 8;

function toApiMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.tool_calls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: t.arguments },
        })),
      };
    }
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai-compatible';
  readonly isLocal = false;

  constructor(
    readonly baseUrl: string,
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  async *streamChat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): AsyncGenerator<LLMEvent, void, unknown> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: toApiMessages(messages),
        tools: tools.map((t) => ({ type: 'function', function: t })),
        tool_choice: 'auto',
        temperature: 0.2,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`LLM 请求失败：${res.status} ${await res.text().catch(() => '')}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const calls = new Map<number, { id: string; name: string; args: string }>();

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let parsed: {
          choices?: { delta?: { content?: string; tool_calls?: Array<{
            index?: number; id?: string;
            function?: { name?: string; arguments?: string };
          }> } }[];
        };
        try {
          parsed = JSON.parse(data) as typeof parsed;
        } catch {
          continue;
        }
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          yield { type: 'delta', text: delta.content };
        }
        for (const tc of delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const prev = calls.get(idx) ?? { id: tc.id ?? `call_${idx}`, name: '', args: '' };
          if (tc.id) prev.id = tc.id;
          if (tc.function?.name) prev.name += tc.function.name;
          if (tc.function?.arguments) prev.args += tc.function.arguments;
          calls.set(idx, prev);
          if (calls.size > MAX_TOOL_CALLS) break;
        }
      }
    }

    const toolCalls: ToolCall[] = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => ({ id: c.id, name: c.name, arguments: c.args || '{}' }));
    yield { type: 'done', content, toolCalls };
  }
}

/** 无密钥演示：第一轮发起一次工具调用，第二轮给出带引用的回答 */
export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';
  readonly model = 'mock-local';
  readonly isLocal = true;

  async *streamChat(
    messages: ChatMessage[],
    _tools: ToolDefinition[],
  ): AsyncGenerator<LLMEvent, void, unknown> {
    const hasToolResult = messages.some((m) => m.role === 'tool');
    const userText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    if (!hasToolResult) {
      const useContract = /合同|协议|条款|审查|风险/.test(userText);
      const name = useContract ? 'review_contract' : 'rag_search';
      const args = useContract
        ? JSON.stringify({ text: userText.slice(0, 2000) })
        : JSON.stringify({ query: userText.slice(0, 200) });
      yield {
        type: 'done',
        content: '',
        toolCalls: [{ id: 'mock_call_1', name, arguments: args }],
      };
      return;
    }

    const answer =
      '【演示回答｜数据来自本地 DEMO 语料，非法律意见】\n\n' +
      '根据检索到的资料，提供格式条款的一方应当采取合理方式提示对方注意' +
      '免除或者减轻其责任等与对方有重大利害关系的条款，并按对方要求予以说明；' +
      '依据《中华人民共和国民法典》第496条。未尽提示说明义务，对方可主张该条款' +
      '不成为合同内容，依据《中华人民共和国民法典》第497条。\n\n' +
      '违约金过分高于造成的损失的，当事人可以请求适当减少，' +
      '依据《中华人民共和国民法典》第585条。相关演示案例：DEMO-CASE-2024-001。\n\n' +
      '注意：上述命中均为演示语料（demo_only），不构成权威库核验；' +
      '正式使用须接入已授权权威数据源，并由承办人员回原文逐条核对。';

    for (let i = 0; i < answer.length; i += 24) {
      yield { type: 'delta', text: answer.slice(i, i + 24) };
    }
    yield { type: 'done', content: answer, toolCalls: [] };
  }
}

export interface LLMConfig {
  provider: 'mock' | 'openai';
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function createLLMProvider(config: LLMConfig): LLMProvider {
  if (config.provider === 'openai' && config.apiKey) {
    return new OpenAICompatibleProvider(config.baseUrl, config.model, config.apiKey);
  }
  return new MockLLMProvider();
}
