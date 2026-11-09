import { describe, expect, it } from 'vitest';
import {
  DISCLAIMER,
  DOCUMENT_KEY,
  ExportBlockedError,
  ReviewGate,
  buildAiUsageDeclaration,
  buildExportBundle,
  renderDeclaration,
  withDisclaimer,
} from '../server/core/review';
import { verifyText } from '../server/core/citations';
import { LocalFixtureProvider } from '../server/providers/datasource';

const ds = new LocalFixtureProvider();

describe('A4 人工复核闸门', () => {
  it('未签字禁止导出', async () => {
    const cs = await verifyText('依据《中华人民共和国民法典》第496条。', ds);
    const gate = new ReviewGate();
    gate.markVerification();
    expect(() => gate.assertExportable(cs)).toThrow(ExportBlockedError);
    expect(gate.getState()).toBe('pending_review');
  });

  it('只签文档不签引用仍禁止导出（必须逐条确认）', async () => {
    const cs = await verifyText('依据《中华人民共和国民法典》第496条。', ds);
    const gate = new ReviewGate();
    gate.markVerification();
    gate.approve(DOCUMENT_KEY, '张律师');
    expect(gate.isFullyApproved(cs)).toBe(false);
    expect(() => gate.assertExportable(cs)).toThrow(/逐条人工复核/);
  });

  it('逐条签字后可导出', async () => {
    const cs = await verifyText('依据《中华人民共和国民法典》第496条。', ds);
    const gate = new ReviewGate();
    gate.markVerification();
    gate.approve(DOCUMENT_KEY, '张律师');
    gate.approve(cs[0].raw, '张律师');
    expect(gate.isFullyApproved(cs)).toBe(true);
    gate.assertExportable(cs);
    expect(gate.getState()).toBe('approved');
  });

  it('含阻断引用时即使全部签字也禁止导出', async () => {
    const cs = await verifyText('依据《中华人民共和国合同法》第52条。', ds);
    const gate = new ReviewGate();
    gate.markVerification();
    gate.approve(DOCUMENT_KEY, '张律师');
    gate.approve(cs[0].raw, '张律师');
    expect(() => gate.assertExportable(cs)).toThrow(/须先修正/);
  });
});

describe('A7 / A8 声明与标识', () => {
  it('免责标识幂等且出现在每份导出物开头', () => {
    expect(withDisclaimer('正文')).toContain(DISCLAIMER);
    expect(withDisclaimer(withDisclaimer('正文'))).toBe(withDisclaimer('正文'));
  });

  it('AI 使用声明含工具、环节、核验清单与责任承诺', () => {
    const d = buildAiUsageDeclaration({
      toolName: 'LexGuard / mock',
      usedIn: ['合同审查', '法条引用核验'],
      reviewedBy: '张律师',
      citations: [],
      records: [],
    });
    const text = renderDeclaration(d);
    expect(text).toContain('人工智能使用声明');
    expect(text).toContain('LexGuard / mock');
    expect(text).toContain('张律师');
    expect(text).toContain('逐项核验');
    expect(text).toContain(DISCLAIMER);
  });

  it('四件套导出内容齐全', () => {
    const bundle = buildExportBundle({
      report: '风险分析正文',
      citations: [],
      records: [],
      toolName: 'LexGuard',
      reviewedBy: '张律师',
    });
    expect(Object.keys(bundle)).toEqual([
      'riskReport',
      'verificationDetail',
      'reviewLog',
      'declaration',
    ]);
    expect(bundle.riskReport.startsWith(DISCLAIMER)).toBe(true);
    expect(bundle.verificationDetail).toContain('核验明细');
    expect(bundle.reviewLog).toContain('复核记录');
  });
});
