import type { Citation, Declaration, ReviewRecord, ReviewState } from './schema';
import { hasBlockingCitation } from './citations';

/**
 * A4 人工复核闸门 / A7《AI 使用声明》 / A8 输出标识
 * 状态机：draft → verification → pending_review → approved → exported
 * 「approved」之前禁止导出，且复核必须按引用逐条确认，不允许整体一键勾选。
 */

export const DISCLAIMER = 'AI 辅助生成，仅供参考，不构成法律意见';
export const DOCUMENT_KEY = '__document__';

export class ExportBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportBlockedError';
  }
}

export function withDisclaimer(text: string): string {
  if (text.trimStart().startsWith(DISCLAIMER)) return text;
  return `${DISCLAIMER}\n\n${text}`;
}

export class ReviewGate {
  private state: ReviewState = 'draft';
  private records = new Map<string, ReviewRecord>();

  getState(): ReviewState {
    return this.state;
  }

  reset(): void {
    this.state = 'draft';
    this.records.clear();
  }

  markVerification(): void {
    this.state = 'pending_review';
  }

  approve(
    key: string,
    reviewer: string,
    decision: ReviewRecord['decision'] = 'approved',
    note?: string,
  ): ReviewRecord {
    if (!reviewer.trim()) throw new Error('复核人不能为空');
    const record: ReviewRecord = {
      citationRaw: key,
      reviewer,
      decision,
      at: new Date().toISOString(),
      ...(note ? { note } : {}),
    };
    this.records.set(key, record);
    return record;
  }

  list(): ReviewRecord[] {
    return [...this.records.values()];
  }

  /** 逐条确认 + 文档整体确认，二者缺一不可 */
  isFullyApproved(citations: Citation[]): boolean {
    if (!this.records.has(DOCUMENT_KEY)) return false;
    const doc = this.records.get(DOCUMENT_KEY)!;
    if (doc.decision === 'rejected') return false;
    return citations.every((c) => {
      const r = this.records.get(c.raw);
      return !!r && r.decision !== 'rejected';
    });
  }

  assertExportable(citations: Citation[]): void {
    if (this.state === 'exported') return;
    if (hasBlockingCitation(citations)) {
      throw new ExportBlockedError('存在已废止 / 库中不存在 / 格式异常的引用，须先修正再导出');
    }
    if (!this.isFullyApproved(citations)) {
      throw new ExportBlockedError('未完成逐条人工复核签字，按《指引》要求禁止导出');
    }
    this.state = 'approved';
  }

  markExported(): void {
    this.state = 'exported';
  }
}

export interface DeclarationInput {
  toolName: string;
  usedIn: string[];
  reviewedBy: string;
  citations: Citation[];
  records: ReviewRecord[];
}

export function buildAiUsageDeclaration(input: DeclarationInput): Declaration {
  return {
    toolName: input.toolName,
    usedIn: input.usedIn,
    reviewedBy: input.reviewedBy,
    generatedAt: new Date().toISOString(),
    items: input.citations.map((c) => ({ citation: c.raw, status: c.status })),
    statement:
      '本人承诺：已对本文书所涉事实、证据、法条与参考案例逐项核验；' +
      '已采取合理措施识别并防范生成式人工智能产生的失实内容；' +
      '文书由承办人员实质审核并签字确认，依法对内容真实性、准确性承担责任。',
  };
}

export function renderDeclaration(d: Declaration): string {
  const lines = [
    '# 人工智能使用声明',
    '',
    `- 工具名称：${d.toolName}`,
    `- 使用环节：${d.usedIn.join('、')}`,
    `- 人工核验人：${d.reviewedBy}`,
    `- 生成时间：${d.generatedAt}`,
    '',
    '## 逐项核验清单',
    ...(d.items.length
      ? d.items.map((i, n) => `${n + 1}. ${i.citation} —— ${i.status}`)
      : ['（本回答未引用法条或案例）']),
    '',
    d.statement,
    '',
    DISCLAIMER,
  ];
  return lines.join('\n');
}

export function buildExportBundle(opts: {
  report: string;
  citations: Citation[];
  records: ReviewRecord[];
  toolName: string;
  reviewedBy: string;
}): { riskReport: string; verificationDetail: string; reviewLog: string; declaration: string } {
  const d = buildAiUsageDeclaration({
    toolName: opts.toolName,
    usedIn: ['合同审查', '法条引用核验', '法律文书起草'],
    reviewedBy: opts.reviewedBy,
    citations: opts.citations,
    records: opts.records,
  });
  const statusLabel: Record<string, string> = {
    verified: '已核验（现行有效）',
    repealed: '已废止，禁止引用',
    not_in_corpus: '库中不存在，疑似编造',
    demo_only: '演示语料，不构成权威核验',
    malformed: '格式异常，转人工',
    needs_human: '缺少权威原文链接，转人工',
  };
  return {
    riskReport: withDisclaimer(opts.report),
    verificationDetail:
      `# 法条 / 案例引用核验明细\n\n` +
      (opts.citations.length
        ? opts.citations
            .map(
              (c) =>
                `- ${c.raw}\n  状态：${statusLabel[c.status] ?? c.status}\n  说明：${c.reason}` +
                (c.matched ? `\n  效力级别：${c.matched.level}｜${c.matched.validity}\n  出处：${c.matched.sourceUrl ?? c.matched.source}` : ''),
            )
            .join('\n')
        : '（未检出法条或案例引用）'),
    reviewLog:
      `# 人工复核记录\n\n` +
      (opts.records.length
        ? opts.records
            .map((r) => `- ${r.citationRaw}｜${r.decision}｜复核人：${r.reviewer}｜时间：${r.at}${r.note ? `｜备注：${r.note}` : ''}`)
            .join('\n')
        : '（无复核记录）'),
    declaration: renderDeclaration(d),
  };
}
