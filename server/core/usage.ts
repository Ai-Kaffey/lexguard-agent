/**
 * E3 用量与成本计量（tokenomics）。
 *
 * ⚠️ 口径：token 数按「字符数 / 4」粗略估算，仅用于相对用量观察，
 * 不是模型厂商的计费口径，不得当作成本金额对外宣称。
 */

export interface UsageRecord {
  ts: string;
  sessionId: string;
  who: string;
  kind: 'llm' | 'tool';
  tokensEstimate: number;
  toolName?: string;
}

export interface UsageSummary {
  sessions: number;
  llmCalls: number;
  toolCalls: number;
  tokensEstimate: number;
  note: string;
}

export class UsageMeter {
  private records: UsageRecord[] = [];

  constructor(private readonly onRecord?: (record: UsageRecord) => void) {}

  /** 启动时从 JSONL 回放；回放不触发 onRecord */
  restore(records: UsageRecord[]): void {
    this.records = [...records];
  }

  recordLLM(sessionId: string, who: string, chars: number): number {
    const tokensEstimate = Math.ceil(Math.max(0, chars) / 4);
    const record: UsageRecord = { ts: new Date().toISOString(), sessionId, who, kind: 'llm', tokensEstimate };
    this.records.push(record);
    this.onRecord?.(record);
    return tokensEstimate;
  }

  recordTool(sessionId: string, who: string, toolName: string): void {
    const record: UsageRecord = {
      ts: new Date().toISOString(), sessionId, who, kind: 'tool', tokensEstimate: 0, toolName,
    };
    this.records.push(record);
    this.onRecord?.(record);
  }

  all(): ReadonlyArray<UsageRecord> {
    return [...this.records];
  }

  bySession(sessionId: string): UsageRecord[] {
    return this.records.filter((r) => r.sessionId === sessionId);
  }

  summary(): UsageSummary {
    return {
      sessions: new Set(this.records.map((r) => r.sessionId)).size,
      llmCalls: this.records.filter((r) => r.kind === 'llm').length,
      toolCalls: this.records.filter((r) => r.kind === 'tool').length,
      tokensEstimate: this.records.reduce((s, r) => s + r.tokensEstimate, 0),
      note: 'token 为字符数/4 的粗略估算，非厂商计费口径，不得作为成本金额',
    };
  }

  toJsonl(): string {
    return this.records.map((r) => JSON.stringify(r)).join('\n');
  }
}
