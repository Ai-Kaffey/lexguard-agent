import type { AuditEvent } from './schema';

/**
 * A5 可审计执行链：append-only，可导出 JSONL 与人类可读报告。
 * 字段覆盖：who / when / agent / tool / data_class / source / citation /
 * verification / reviewer / export —— 对齐《指引》「日志留存不少于 3 年」要求。
 */
export class AuditLog {
  private events: AuditEvent[] = [];

  record(event: Omit<AuditEvent, 'ts'>): AuditEvent {
    const full: AuditEvent = { ...event, ts: new Date().toISOString() };
    this.events.push(full);
    return full;
  }

  all(): ReadonlyArray<AuditEvent> {
    return [...this.events];
  }

  size(): number {
    return this.events.length;
  }

  toJsonl(): string {
    return this.events.map((e) => JSON.stringify(e)).join('\n');
  }

  toReport(): string {
    const lines = [
      '# 执行链审计报告',
      '',
      `事件数：${this.events.length}`,
      `生成时间：${new Date().toISOString()}`,
      `留存要求：默认按不少于 3 年配置，具体期限由部署方设置`,
      '',
      ...this.events.map(
        (e) =>
          `- ${e.ts}｜${e.who}｜${e.action}` +
          (e.tool ? `｜工具 ${e.tool}` : '') +
          `｜数据分级 ${e.dataClass}` +
          (e.source ? `｜来源 ${e.source}` : '') +
          (e.citation ? `｜引用 ${e.citation}` : '') +
          (e.verification ? `｜核验 ${e.verification}` : '') +
          (e.reviewer ? `｜复核 ${e.reviewer}` : '') +
          (e.exported ? '｜已导出' : '') +
          (e.detail ? `｜${e.detail}` : ''),
      ),
    ];
    return lines.join('\n');
  }
}
