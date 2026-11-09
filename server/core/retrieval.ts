import type { LawDataSource } from './schema';

/**
 * B3 RAG 问答：轻量 BM25，零外部依赖，不需要向量库即可跑通。
 * 检索片段必须带出处；回答生成后所有引用会由 A1/A2 自动进入核验队列。
 */

export interface RagDoc {
  id: string;
  text: string;
  source: string;
  demo: boolean;
}

export interface RagHit {
  doc: RagDoc;
  score: number;
}

export function tokenize(input: string): string[] {
  const out: string[] = [];
  const re = /[a-zA-Z0-9]+|[\u4e00-\u9fa5]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) out.push(m[0].toLowerCase());
  return out;
}

export function bm25Search(query: string, docs: RagDoc[], k = 3): RagHit[] {
  if (docs.length === 0) return [];
  const qTerms = Array.from(new Set(tokenize(query)));
  const tokenized = docs.map((d) => tokenize(`${d.text} ${d.id}`));
  const avgdl = tokenized.reduce((s, t) => s + t.length, 0) / tokenized.length || 1;
  const N = docs.length;
  const k1 = 1.5;
  const b = 0.75;

  const df = new Map<string, number>();
  for (const term of qTerms) {
    df.set(term, tokenized.filter((t) => t.includes(term)).length);
  }

  const scored = docs.map((doc, idx) => {
    const terms = tokenized[idx];
    const dl = terms.length || 1;
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of qTerms) {
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const f = tf.get(term) ?? 0;
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / avgdl)));
    }
    return { doc, score };
  });

  return scored
    .filter((h) => h.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k);
}

export async function buildRagDocs(ds: LawDataSource): Promise<RagDoc[]> {
  const [laws, cases] = await Promise.all([ds.allLaws(), ds.allCases()]);
  return [
    ...laws.map((l) => ({
      id: `${l.law}第${l.articleNo}条`,
      text: `${l.law} ${l.article}：${l.gist}【${l.validity}｜${l.level}】`,
      source: l.sourceUrl ?? l.source,
      demo: l.demo,
    })),
    ...cases.map((c) => ({
      id: c.caseNo,
      text: `${c.title}：${c.gist}（${c.keywords.join('、')}）`,
      source: c.sourceUrl ?? 'DEMO-LOCAL-FIXTURE',
      demo: c.demo,
    })),
  ];
}

export async function buildRagContext(
  query: string,
  ds: LawDataSource,
  k = 3,
): Promise<{ hits: RagHit[]; context: string }> {
  const docs = await buildRagDocs(ds);
  const hits = bm25Search(query, docs, k);
  const context = hits
    .map((h, i) => `[${i + 1}] ${h.doc.id}\n${h.doc.text}\n来源：${h.doc.source}${h.doc.demo ? '（演示语料）' : ''}`)
    .join('\n\n');
  return { hits, context };
}
