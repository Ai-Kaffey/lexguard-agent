import { describe, expect, it } from 'vitest';
import { countByLevel, reviewContract, RISK_RULES } from '../server/core/contract';
import { verifyText } from '../server/core/citations';
import { LocalFixtureProvider } from '../server/providers/datasource';

const ds = new LocalFixtureProvider();

const SAMPLE_CONTRACT = [
  '甲方：XX，乙方：待填。',
  '本公司有权自行决定合同解释，并保留最终解释权。',
  '因故意或重大过失造成对方损失的，本公司概不负责。',
  '违约金按未付款金额每日 30% 计算。',
  '甲方有权随时解除本协议，无需理由。',
  '保密义务永久有效，不得终止。',
  '争议仅由甲方所在地法院管辖。',
  '付款期限另行通知。',
  '入职后暂不订立书面劳动合同。',
].join('\n');

describe('B1 合同审查规则引擎', () => {
  it('规则库共 14 条且编号唯一', () => {
    expect(RISK_RULES).toHaveLength(14);
    expect(new Set(RISK_RULES.map((r) => r.id)).size).toBe(14);
  });

  it('命中多类风险且分级可统计', () => {
    const risks = reviewContract(SAMPLE_CONTRACT);
    expect(risks.length).toBeGreaterThan(4);
    const c = countByLevel(risks);
    expect(c.high + c.medium + c.low).toBe(risks.length);
    expect(c.high).toBeGreaterThan(0);
    expect(risks.every((r) => r.basis.length > 0 && r.suggestion.length > 0)).toBe(true);
  });

  it('空文本不产生风险', () => {
    expect(reviewContract('')).toEqual([]);
  });

  it('规则结果可复现', () => {
    expect(reviewContract(SAMPLE_CONTRACT)).toEqual(reviewContract(SAMPLE_CONTRACT));
  });

  it('所有依据法条都能在语料中命中，系统不自己制造幻觉', async () => {
    const risks = reviewContract(SAMPLE_CONTRACT);
    const allBasis = [...new Set(risks.flatMap((r) => r.basis))];
    const citations = await verifyText(allBasis.join('；'), ds);
    expect(citations.length).toBe(allBasis.length);
    expect(citations.every((c) => c.status === 'demo_only')).toBe(true);
    expect(citations.some((c) => c.status === 'not_in_corpus')).toBe(false);
  });
});
