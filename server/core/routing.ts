import type { DataClass } from './schema';

/**
 * A6 数据分级路由（用途路由，不靠人工逐条脱敏）
 * A 绝密：仅内网自建模型，禁止任何外部调用
 * B 高敏：条款达标的企业级 API / 本地模型
 * C 公开：可自由使用
 */

const A_PATTERNS: { label: string; re: RegExp }[] = [
  { label: '身份证号码', re: /\b\d{17}[\dXx]\b/g },
  { label: '银行账号', re: /\b\d{16,19}\b/g },
  { label: '绝密标识', re: /(绝密|机密级|涉密|国家秘密|未公开裁判文书)/g },
];

const B_PATTERNS: { label: string; re: RegExp }[] = [
  { label: '客户或当事人姓名', re: /(客户|委托人|当事人|原告|被告)[：:]\s*\S{2,10}/g },
  { label: '具体金额', re: /\d{4,}\s*(?:元|万元|亿元)/g },
  { label: '案卷材料', re: /(案卷|证据材料|庭审笔录|病历|银行流水)/g },
  { label: '手机号', re: /\b1[3-9]\d{9}\b/g },
];

export function detectSensitive(text: string): string[] {
  const hits: string[] = [];
  for (const p of [...A_PATTERNS, ...B_PATTERNS]) {
    if (new RegExp(p.re.source, p.re.flags).test(text)) hits.push(p.label);
  }
  return [...new Set(hits)];
}

export function classifyData(text: string): DataClass {
  if (A_PATTERNS.some((p) => new RegExp(p.re.source, p.re.flags).test(text))) return 'A';
  if (B_PATTERNS.some((p) => new RegExp(p.re.source, p.re.flags).test(text))) return 'B';
  return 'C';
}

export class DataRoutingError extends Error {
  constructor(public readonly dataClass: DataClass, message: string) {
    super(message);
    this.name = 'DataRoutingError';
  }
}

export function assertOutboundAllowed(
  dataClass: DataClass,
  target: 'local' | 'cloud',
): void {
  if (dataClass === 'A' && target === 'cloud') {
    throw new DataRoutingError('A', 'A 类绝密数据禁止发起外部模型调用，敏感数据必须不出域');
  }
}

export function maskSensitive(text: string): string {
  return text
    .replace(/\b(\d{17}[\dXx])\b/g, (_m, v: string) => `${v.slice(0, 4)}**********${v.slice(-4)}`)
    .replace(/\b(1[3-9]\d{9})\b/g, (_m, v: string) => `${v.slice(0, 3)}****${v.slice(-4)}`)
    .replace(/\b(\d{16,19})\b/g, '****（账号已遮蔽）');
}
