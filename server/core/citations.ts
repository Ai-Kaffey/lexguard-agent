import type {
  Citation,
  CitationStatus,
  LawArticle,
  LawDataSource,
  RawCitation,
} from './schema';

/**
 * A1 引用抽取与归一化 / A2 引用结构化查库核验 / A3 六类幻觉负例拦截
 *
 * ⭐ 技术红线：语义相似 ≠ 法条命中。
 * 存在性、条号、时效一律走「法名 + 条号」精确查库，模型不参与裁决。
 * 演示语料（demo: true）只能得到 demo_only，绝不伪装成权威库核验通过。
 */

const LAW_ALIASES: Record<string, string> = {
  民法典: '中华人民共和国民法典',
  劳动合同法: '中华人民共和国劳动合同法',
  消费者权益保护法: '中华人民共和国消费者权益保护法',
  消保法: '中华人民共和国消费者权益保护法',
  合同法: '中华人民共和国合同法',
};

export function normalizeLawName(name: string): string {
  const s = name.replace(/\s+/g, '').replace(/^《|》$/g, '');
  return LAW_ALIASES[s] ?? s;
}

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

export function cnToNumber(raw: string): number | undefined {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (!/^[零〇一二两三四五六七八九十百千]+$/.test(s)) return undefined;
  let section = 0;
  let num = 0;
  for (const ch of s) {
    if (ch === '千') {
      section += (num || 1) * 1000;
      num = 0;
    } else if (ch === '百') {
      section += (num || 1) * 100;
      num = 0;
    } else if (ch === '十') {
      section += (num || 1) * 10;
      num = 0;
    } else {
      num = CN_DIGIT[ch] ?? 0;
    }
  }
  return section + num;
}

const LAW_RE =
  /《([^》]{1,40})》\s*第\s*([零〇一二两三四五六七八九十百千\d]{1,8})\s*条(?:\s*第\s*([零〇一二两三四五六七八九十百千\d]{1,8})\s*款)?/g;
const CASE_RE =
  /[（(]?\d{4}[）)]?[^\s，。；：、]{0,24}?(?:民初|民终|民申|刑初|刑终|行初|民特|执异|执)\s*\d+\s*号/g;
const DEMO_CASE_RE = /DEMO-CASE-\d{4}-\d{3}/g;
/** 残缺引用不得静默丢弃：A1 要求显式转人工 */
const BROKEN_LAW_RE = /《([^》]{1,40})》\s*第\s*条/g;

export function extractCitations(text: string): RawCitation[] {
  const out: RawCitation[] = [];
  const seen = new Set<string>();

  const push = (c: RawCitation) => {
    const key = `${c.kind}:${c.raw}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  };

  for (const m of text.matchAll(LAW_RE)) {
    const articleNo = cnToNumber(m[2]);
    if (articleNo === undefined) {
      push({ raw: m[0], kind: 'unknown' });
      continue;
    }
    push({
      raw: m[0],
      kind: 'law',
      law: normalizeLawName(m[1]),
      articleNo,
      paragraph: m[3] ? `第${m[3]}款` : undefined,
    });
  }

  for (const m of text.matchAll(DEMO_CASE_RE)) {
    push({ raw: m[0], kind: 'case', caseNo: m[0] });
  }
  for (const m of text.matchAll(CASE_RE)) {
    push({ raw: m[0], kind: 'case', caseNo: m[0] });
  }
  for (const m of text.matchAll(BROKEN_LAW_RE)) {
    push({ raw: m[0], kind: 'unknown' });
  }

  return out;
}

function matchedOf(a: LawArticle): Citation['matched'] {
  return {
    law: a.law,
    article: a.article,
    gist: a.gist,
    validity: a.validity,
    level: a.level,
    source: a.source,
    sourceUrl: a.sourceUrl,
    demo: a.demo,
  };
}

function make(raw: RawCitation, status: CitationStatus, reason: string, matched?: Citation['matched']): Citation {
  return { ...raw, status, reason, ...(matched ? { matched } : {}) };
}

export async function verifyCitations(
  raw: RawCitation[],
  ds: LawDataSource,
): Promise<Citation[]> {
  const result: Citation[] = [];

  for (const r of raw) {
    if (r.kind === 'law' && r.law && r.articleNo !== undefined) {
      const hit = await ds.getLaw(r.law, r.articleNo);
      if (!hit) {
        result.push(make(r, 'not_in_corpus', `在数据源「${ds.name}」中未找到《${r.law}》第${r.articleNo}条，疑似编造条号`));
      } else if (hit.validity === '已废止') {
        result.push(make(r, 'repealed', hit.effectiveNote ?? '该法条已废止，不得作为现行依据', matchedOf(hit)));
      } else if (r.paragraph) {
        result.push(make(r, 'needs_human', '已命中条号，但引用含款项定位；结构化核验不裁决款项是否存在，须回权威原文人工核对', matchedOf(hit)));
      } else if (hit.demo || ds.demo) {
        result.push(make(r, 'demo_only', '命中演示语料，不构成权威库核验；正式使用须接入已授权权威数据源并调取全文', matchedOf(hit)));
      } else if (!hit.sourceUrl) {
        result.push(make(r, 'needs_human', '缺少权威原文链接，按律协要求不得以检索摘要作为核验依据，转人工', matchedOf(hit)));
      } else {
        result.push(make(r, 'verified', `现行有效，已附权威原文链接（${hit.level}）`, matchedOf(hit)));
      }
      continue;
    }

    if (r.kind === 'case' && r.caseNo) {
      if (r.caseNo.startsWith('DEMO-CASE')) {
        result.push(make(r, 'demo_only', '演示案例编号，非真实裁判文书案号；不得用于正式文书'));
      } else {
        const hit = await ds.getCase(r.caseNo);
        if (!hit) {
          result.push(make(r, 'not_in_corpus', '案号在权威案例库中不存在，疑似虚构案例'));
        } else if (hit.demo || ds.demo) {
          result.push(make(r, 'demo_only', '命中演示案例，须回权威库核对案号、法院、日期与裁判要旨'));
        } else {
          result.push(make(r, 'verified', '案号已在权威案例库命中；仍须人工核对要旨与判例状态'));
        }
      }
      continue;
    }

    result.push(make(r, 'malformed', '引用格式无法解析，不静默丢弃，转人工确认'));
  }

  return result;
}

export async function verifyText(text: string, ds: LawDataSource): Promise<Citation[]> {
  return verifyCitations(extractCitations(text), ds);
}

export function summarizeVerification(cs: Citation[]): Record<CitationStatus, number> {
  const out: Record<CitationStatus, number> = {
    verified: 0,
    repealed: 0,
    not_in_corpus: 0,
    demo_only: 0,
    malformed: 0,
    needs_human: 0,
  };
  for (const c of cs) out[c.status] += 1;
  return out;
}

export const BLOCKING_STATUSES: CitationStatus[] = ['repealed', 'not_in_corpus', 'malformed'];

export function hasBlockingCitation(cs: Citation[]): boolean {
  return cs.some((c) => BLOCKING_STATUSES.includes(c.status));
}
