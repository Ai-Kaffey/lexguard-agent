import type { LawArticle, LegalCase, CompanyRecord } from './schema';

/**
 * F2 演示数据纪律（务必遵守，禁止为了「看起来真实」而破坏）：
 * 1. 只存法条编号 + 效力状态 + 条文主旨摘要，绝不冒充官方全文。
 * 2. 案号一律 DEMO-CASE-YYYY-NNN，绝不伪造真实裁判文书案号。
 * 3. 企业名称带「（演示）」，信用代码用 DEMO- 前缀。
 * 4. 全部 demo: true —— 核验引擎据此返回 demo_only，绝不把演示语料当作权威核验结果。
 *
 * 一个主打「防幻觉」的项目，如果自带伪造案号，本身就构成幻觉。
 */

const SRC = 'DEMO-LOCAL-FIXTURE';

function law(
  short: string,
  no: number,
  gist: string,
  tags: string[],
  extra: Partial<LawArticle> = {},
): LawArticle {
  return {
    id: `${short}-${no}`,
    law: `中华人民共和国${short}`,
    articleNo: no,
    article: `第${no}条`,
    gist,
    level: '法律',
    validity: '现行有效',
    source: SRC,
    demo: true,
    tags,
    ...extra,
  };
}

export const LAWS: LawArticle[] = [
  law('民法典', 465, '依法成立的合同受法律保护，对当事人具有法律约束力', ['合同', '效力']),
  law('民法典', 496, '格式条款的定义，以及提供方应尽提示与说明义务', ['格式条款', '提示义务']),
  law('民法典', 497, '格式条款无效的情形，含不合理免除己方责任、加重对方责任、排除对方主要权利', ['格式条款', '无效']),
  law('民法典', 500, '缔约过程中的过错责任（缔约过失责任）', ['缔约', '先合同义务']),
  law('民法典', 509, '当事人应全面履行义务并遵循诚信原则', ['履行', '诚信']),
  law('民法典', 563, '合同法定解除的情形', ['解除', '法定解除']),
  law('民法典', 577, '违约责任：不履行或履行不符合约定应承担继续履行、补救或赔偿等责任', ['违约', '责任']),
  law('民法典', 584, '损失赔偿范围包括可得利益，但不得超过违约方订立合同时可预见的损失', ['赔偿', '可预见规则']),
  law('民法典', 585, '违约金约定；过分高于或低于损失时，当事人可请求法院或仲裁机构适当调整', ['违约金', '调整']),
  law('民法典', 590, '不可抗力与部分或全部免责、及时通知义务', ['不可抗力', '免责']),
  law('民法典', 591, '守约方应采取适当措施防止损失扩大，否则不得就扩大损失请求赔偿', ['减损义务']),
  law('民法典', 1165, '行为人因过错侵害他人民事权益造成损害的，应承担侵权责任', ['侵权', '过错责任']),
  law('劳动合同法', 10, '建立劳动关系应当订立书面劳动合同', ['劳动关系', '书面合同']),
  law('劳动合同法', 39, '劳动者有法定过错情形时，用人单位可解除劳动合同', ['解除', '过失性辞退']),
  law('劳动合同法', 82, '用人单位未依法订立书面劳动合同的，应向劳动者支付二倍工资', ['二倍工资', '书面合同']),
  law('消费者权益保护法', 55, '经营者欺诈的惩罚性赔偿规则', ['欺诈', '惩罚性赔偿']),
  law('合同法', 52, '合同无效的情形（旧法条文，已被民法典替代）', ['合同无效', '已废止'], {
    validity: '已废止',
    effectiveNote: '《中华人民共和国民法典》自 2021-01-01 起施行，《合同法》同时废止；引用应改引民法典相应条文',
  }),
];

export const CASES: LegalCase[] = [
  {
    id: 'demo-case-001',
    caseNo: 'DEMO-CASE-2024-001',
    title: '格式条款未尽提示说明义务纠纷（模拟）',
    court: '演示法院',
    date: '2024-03-01',
    gist: '提供格式条款一方未以合理方式提示对方注意免除或减轻其责任等重大利害关系条款的，对方可主张该条款不成为合同内容。',
    keywords: ['格式条款', '提示义务', '民法典496'],
    demo: true,
  },
  {
    id: 'demo-case-002',
    caseNo: 'DEMO-CASE-2024-002',
    title: '未订立书面劳动合同二倍工资争议（模拟）',
    court: '演示法院',
    date: '2024-05-12',
    gist: '用人单位自用工之日起超过一个月未与劳动者订立书面劳动合同的，应依法支付二倍工资。',
    keywords: ['二倍工资', '劳动合同法82'],
    demo: true,
  },
  {
    id: 'demo-case-003',
    caseNo: 'DEMO-CASE-2023-001',
    title: '约定违约金过分高于实际损失的调整（模拟）',
    court: '演示法院',
    date: '2023-11-20',
    gist: '约定违约金过分高于造成的损失，当事人请求适当减少的，可结合损失、履行情况、过错程度综合衡量。',
    keywords: ['违约金', '调整', '民法典585'],
    demo: true,
  },
];

export const COMPANIES: CompanyRecord[] = [
  {
    id: 'demo-company-001',
    name: '杭州示例科技有限公司（演示）',
    creditCode: 'DEMO-91330100XXXXXXXX01',
    established: '2019-04-01',
    status: '存续',
    litigation: [{ count: 2, summary: '买卖合同纠纷（演示）' }],
    demo: true,
  },
  {
    id: 'demo-company-002',
    name: '宁波示例贸易有限公司（演示）',
    creditCode: 'DEMO-91330200XXXXXXXX02',
    established: '2021-08-15',
    status: '存续',
    litigation: [],
    demo: true,
  },
];

export const FIXTURE_STATS = {
  laws: LAWS.length,
  cases: CASES.length,
  companies: COMPANIES.length,
  repealed: LAWS.filter((l) => l.validity === '已废止').length,
  allDemo: true,
};
