import type { ContractRisk, RiskLevel } from './schema';

/**
 * B1 合同审查：规则引擎为主、模型补充为辅。
 * 规则结果完全可复现、可脱离 LLM 单测；每条风险的依据法条会自动送 A2 核验。
 * 依据只使用 fixtures 中确实存在的条号，避免系统自己产生「引用不存在」的噪声。
 */

export interface RiskRule {
  id: string;
  category: string;
  level: RiskLevel;
  pattern: RegExp;
  reason: string;
  basis: string[];
  suggestion: string;
}

const B = {
  c465: '《中华人民共和国民法典》第465条',
  c496: '《中华人民共和国民法典》第496条',
  c497: '《中华人民共和国民法典》第497条',
  c500: '《中华人民共和国民法典》第500条',
  c509: '《中华人民共和国民法典》第509条',
  c563: '《中华人民共和国民法典》第563条',
  c577: '《中华人民共和国民法典》第577条',
  c584: '《中华人民共和国民法典》第584条',
  c585: '《中华人民共和国民法典》第585条',
  c82: '《中华人民共和国劳动合同法》第82条',
};

export const RISK_RULES: RiskRule[] = [
  {
    id: 'R01', category: '格式条款', level: 'high',
    pattern: /(?:本公司|甲方|提供方)[^。；\n]{0,30}(?:无需通知|有权自行|单方决定|最终解释权)/g,
    reason: '疑似单方决定权或最终解释权条款，可能构成不合理免除己方责任、排除对方主要权利',
    basis: [B.c496, B.c497],
    suggestion: '删除「最终解释权」类表述，改为双方协商机制，并对重大利害关系条款加粗提示',
  },
  {
    id: 'R02', category: '免责条款', level: 'high',
    pattern: /(?:故意|重大过失)[^。；\n]{0,20}(?:概不负责|免责|不承担责任)|(?:无论[^。；\n]{0,20})(?:均不负责|一律免责)/g,
    reason: '造成对方人身损害或因故意、重大过失造成财产损失的免责条款依法无效',
    basis: [B.c497, B.c577],
    suggestion: '删除对故意 / 重大过失的免责约定，改为按实际损失依法承担',
  },
  {
    id: 'R03', category: '违约金', level: 'high',
    pattern: /违约金[^。；\n]{0,40}?(?:\d{2,}|百分之[三四五六七八九]?十)[^。；\n]{0,10}?(?:%|倍|日)/g,
    reason: '违约金计算方式可能过分高于实际损失，存在被请求调减风险；需结合损失举证评估',
    basis: [B.c585, B.c584],
    suggestion: '约定以实际损失为基础的计算方式，并设置合理上限，保留请求调整的空间',
  },
  {
    id: 'R04', category: '解除权不对等', level: 'high',
    pattern: /(?:仅|只有)?(?:甲方|本公司)[^。；\n]{0,20}(?:有权随时|可单方|无需理由)[^。；\n]{0,12}(?:解除|终止)/g,
    reason: '单方任意解除权与法定解除情形不符，且权利义务显著不对等',
    basis: [B.c563, B.c497],
    suggestion: '列明具体解除情形与通知期限，赋予对等解除权',
  },
  {
    id: 'R05', category: '无限连带责任', level: 'high',
    pattern: /(?:承担|负)[^。；\n]{0,10}(?:无限|全部及一切|不分份额)[^。；\n]{0,6}(?:连带)?责任/g,
    reason: '无限或不限范围的责任承担，风险敞口不可控',
    basis: [B.c584, B.c577],
    suggestion: '限定责任范围与上限，约定以可预见损失为限',
  },
  {
    id: 'R06', category: '争议解决', level: 'medium',
    pattern: /(?:争议|纠纷)[^。；\n]{0,30}(?:仅由|只能向|必须提交)[^。；\n]{0,20}(?:所在地)?(?:法院|仲裁|委员会)/g,
    reason: '单方指定管辖且排除对方选择权，可能因格式条款而无效或引发管辖异议',
    basis: [B.c496, B.c497],
    suggestion: '改为双方协商确定管辖法院，或明确仲裁机构名称',
  },
  {
    id: 'R07', category: '保密义务', level: 'medium',
    pattern: /保密[^。；\n]{0,20}(?:永久|无限期| forever|永不终止)/g,
    reason: '保密义务无期限，履行成本与边界不清',
    basis: [B.c509],
    suggestion: '约定保密期限（如合同终止后 3 年）与例外情形',
  },
  {
    id: 'R08', category: '验收标准', level: 'medium',
    pattern: /(?:验收|交付)[^。；\n]{0,20}(?:由甲方|由本公司)[^。；\n]{0,10}(?:自行|单方|全权)(?:决定|认定)/g,
    reason: '验收标准由单方认定，缺少客观可检验的指标',
    basis: [B.c509, B.c577],
    suggestion: '列明可量化验收指标、验收期限与异议复核机制',
  },
  {
    id: 'R09', category: '付款条款', level: 'medium',
    pattern: /付款[^。；\n]{0,20}(?:另行通知|视情况|待定|另行协商)|(?:账期|付款期限)[^。；\n]{0,10}未(?:约定|明确)/g,
    reason: '付款节点或金额不明确，易引发履行争议',
    basis: [B.c509, B.c577],
    suggestion: '明确金额、节点、发票与逾期责任',
  },
  {
    id: 'R10', category: '知识产权', level: 'medium',
    pattern: /(?:成果|知识产权|著作权|专利)[^。；\n]{0,30}(?:归甲方|归本公司|全部归)[^。；\n]{0,20}(?:所有|享有)/g,
    reason: '成果权属单方归属，未区分背景知识产权与新增成果',
    basis: [B.c509],
    suggestion: '区分背景知识产权与交付成果，明确许可范围与署名',
  },
  {
    id: 'R11', category: '自动续约', level: 'medium',
    pattern: /(?:自动|默认)[^。；\n]{0,10}(?:续约|续签|延期)[^。；\n]{0,20}(?:无需|不必)[^。；\n]{0,10}通知/g,
    reason: '自动续约且无需提示，属于与对方有重大利害关系的条款，须尽提示说明义务',
    basis: [B.c496, B.c497],
    suggestion: '增加到期前书面提醒与任意一方不续约的通知机制',
  },
  {
    id: 'R12', category: '违约责任缺失', level: 'medium',
    pattern: /(?:违约|违反本合同)[^。；\n]{0,20}(?:不承担|无责任|友好协商解决)/g,
    reason: '排除违约责任或仅写友好协商，缺少可执行的救济路径',
    basis: [B.c577, B.c584],
    suggestion: '补充继续履行、补救措施、损失赔偿与违约金条款',
  },
  {
    id: 'R13', category: '主体信息', level: 'low',
    pattern: /(?:甲方|乙方)[：:]\s*(?:待填|XX|xxx|\/|未填写)/g,
    reason: '合同主体信息未填，影响合同成立与相对方识别',
    basis: [B.c465],
    suggestion: '补全全称、统一社会信用代码、住所与授权代表',
  },
  {
    id: 'R14', category: '劳动关系', level: 'medium',
    pattern: /(?:入职|用工)[^。；\n]{0,20}(?:不签|无需签订|暂不订立)[^。；\n]{0,10}(?:书面)?劳动合同/g,
    reason: '建立劳动关系应订立书面劳动合同，否则存在二倍工资风险',
    basis: [B.c82, B.c509],
    suggestion: '自用工之日起一个月内订立书面劳动合同',
  },
];

export function reviewContract(text: string): ContractRisk[] {
  const risks: ContractRisk[] = [];
  for (const rule of RISK_RULES) {
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
    const re = new RegExp(rule.pattern.source, flags);
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(text)) !== null && i < 3) {
      risks.push({
        id: `${rule.id}-${i + 1}`,
        level: rule.level,
        category: rule.category,
        quote: m[0].slice(0, 80),
        reason: rule.reason,
        basis: [...rule.basis],
        suggestion: rule.suggestion,
      });
      i += 1;
    }
  }
  return risks;
}

export function countByLevel(risks: ContractRisk[]): Record<RiskLevel, number> {
  return {
    high: risks.filter((r) => r.level === 'high').length,
    medium: risks.filter((r) => r.level === 'medium').length,
    low: risks.filter((r) => r.level === 'low').length,
  };
}
