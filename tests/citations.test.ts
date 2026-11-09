import { describe, expect, it } from 'vitest';
import {
  cnToNumber,
  extractCitations,
  normalizeLawName,
  summarizeVerification,
  verifyText,
} from '../server/core/citations';
import type { CitationStatus } from '../server/core/schema';
import { CITATION_EVAL_SET, evaluateStatuses } from '../server/eval/dataset';
import { LocalFixtureProvider } from '../server/providers/datasource';

const ds = new LocalFixtureProvider();

describe('A1 引用抽取与归一化', () => {
  it('中文数字与阿拉伯数字都能转成条号', () => {
    expect(cnToNumber('496')).toBe(496);
    expect(cnToNumber('十一')).toBe(11);
    expect(cnToNumber('二十三')).toBe(23);
    expect(cnToNumber('一百零五')).toBe(105);
    expect(cnToNumber('第?条')).toBeUndefined();
  });

  it('法名别名归一到标准名称', () => {
    expect(normalizeLawName('民法典')).toBe('中华人民共和国民法典');
    expect(normalizeLawName(' 消保法 ')).toBe('中华人民共和国消费者权益保护法');
    expect(normalizeLawName('中华人民共和国民法典')).toBe('中华人民共和国民法典');
  });

  it('抽取法条、款项、案号与残缺引用', () => {
    const text =
      '依据《民法典》第496条第一款、《中华人民共和国劳动合同法》第82条，' +
      '参见（2024）京01民初123号与 DEMO-CASE-2024-001，另有《民法典》第条。';
    const raw = extractCitations(text);
    expect(raw.some((r) => r.kind === 'law' && r.articleNo === 496)).toBe(true);
    expect(raw.some((r) => r.paragraph === '第一款')).toBe(true);
    expect(raw.some((r) => r.kind === 'case' && r.caseNo === 'DEMO-CASE-2024-001')).toBe(true);
    expect(raw.some((r) => r.kind === 'unknown')).toBe(true);
  });
});

describe('A2 / A3 引用核验六态与负例拦截', () => {
  it('评测集八条样本的状态判定全部符合预期', async () => {
    const predicted: CitationStatus[] = [];
    for (const sample of CITATION_EVAL_SET) {
      const cs = await verifyText(sample.text, ds);
      predicted.push(cs[0]?.status ?? 'malformed');
    }
    const expected = CITATION_EVAL_SET.map((s) => s.expectedStatus);
    expect(predicted).toEqual(expected);
    const metrics = evaluateStatuses(predicted, expected);
    expect(metrics.samples).toBe(CITATION_EVAL_SET.length);
    expect(metrics.accuracy).toBe(1);
  });

  it('已废止法条明确给出替代说明', async () => {
    const cs = await verifyText('依据《中华人民共和国合同法》第52条。', ds);
    expect(cs[0].status).toBe('repealed');
    expect(cs[0].reason).toContain('民法典');
    expect(cs[0].matched?.validity).toBe('已废止');
  });

  it('演示语料绝不被判为权威核验通过', async () => {
    const cs = await verifyText('依据《中华人民共和国民法典》第496条。', ds);
    expect(cs[0].status).toBe('demo_only');
    expect(cs[0].reason).toContain('不构成权威库核验');
    expect(cs[0].matched?.sourceUrl).toBeUndefined();
  });

  it('汇总函数六态齐全', async () => {
    const cs = await verifyText(
      '依据《中华人民共和国民法典》第496条、《中华人民共和国合同法》第52条、《中华人民共和国民法典》第9999条。',
      ds,
    );
    const sum = summarizeVerification(cs);
    expect(sum.demo_only).toBe(1);
    expect(sum.repealed).toBe(1);
    expect(sum.not_in_corpus).toBe(1);
    expect(Object.keys(sum)).toHaveLength(6);
  });
});
