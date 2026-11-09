import { useEffect, useState } from 'react';
import type { Citation, ExportBundle } from '../types';

const DOCUMENT_KEY = '__document__';
const LABEL: Record<string, string> = {
  verified: '已核验',
  repealed: '已废止',
  not_in_corpus: '库中不存在',
  demo_only: '演示语料',
  malformed: '格式异常',
  needs_human: '转人工',
};

interface Props {
  citations: Citation[];
  sessionId: string;
  reviewer: string;
  onReviewer: (value: string) => void;
  notice: string;
}

export default function CitationPanel({ citations, sessionId, reviewer, onReviewer, notice }: Props) {
  const [signed, setSigned] = useState<Set<string>>(new Set());
  const [bundle, setBundle] = useState<ExportBundle | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 新对话产生新引用时清空本地签字态，与后端闸门重置保持一致
  useEffect(() => {
    setSigned(new Set());
    setBundle(null);
  }, [citations]);

  async function sign(key: string) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, key, reviewer }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '签字失败');
      setSigned((prev) => new Set(prev).add(key));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    setBusy(true);
    setError('');
    setBundle(null);
    try {
      const res = await fetch(`/api/export/${encodeURIComponent(sessionId)}`);
      const json = await res.json();
      if (!res.ok) {
        const pending = Array.isArray(json.pendingKeys) ? `｜待签：${json.pendingKeys.join('、')}` : '';
        throw new Error(`${json.error ?? '导出失败'}${pending}`);
      }
      setBundle(json as ExportBundle);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3>引用核验与人工复核</h3>
      <p className="desc">
        存在性、条号与时效由结构化查库判定，模型不参与裁决。演示语料只返回 demo_only，
        不构成权威核验；逐条签字 + 文档整体签字后方可导出。
      </p>

      <div className="field">
        <span>复核人</span>
        <input value={reviewer} onChange={(e) => onReviewer(e.target.value)} placeholder="承办人员姓名" />
      </div>

      {notice && <div className="ok">{notice}</div>}
      {error && <div className="err">{error}</div>}

      <div className="btns">
        <button
          className={`btn ${signed.has(DOCUMENT_KEY) ? 'done' : 'primary'}`}
          disabled={busy || !reviewer.trim()}
          onClick={() => sign(DOCUMENT_KEY)}
        >
          {signed.has(DOCUMENT_KEY) ? '✓ 文档已整体签字' : '文档整体签字'}
        </button>
        <button className="btn primary" disabled={busy} onClick={doExport}>
          导出四件套
        </button>
      </div>

      {citations.length === 0 && (
        <p className="desc">尚无引用。发起对话后，回答中的法条与案号会自动进入这里。</p>
      )}

      {citations.map((c, i) => (
        <div className="cit" key={`${c.raw}-${i}`}>
          <div className="raw">
            {c.raw}
            <span className={`badge ${c.status}`}>{LABEL[c.status] ?? c.status}</span>
          </div>
          <div className="reason">{c.reason}</div>
          {c.matched && (
            <div className="gist">
              {c.matched.law} {c.matched.article}｜{c.matched.validity}｜{c.matched.gist}
              <br />
              出处：{c.matched.sourceUrl ?? c.matched.source}
              {c.matched.demo ? '（演示语料）' : ''}
            </div>
          )}
          <button
            className={`btn ${signed.has(c.raw) ? 'done' : ''}`}
            disabled={busy || signed.has(c.raw)}
            onClick={() => sign(c.raw)}
          >
            {signed.has(c.raw) ? '✓ 已逐条确认' : '逐条确认签字'}
          </button>
        </div>
      ))}

      {bundle && (
        <div style={{ marginTop: 14 }}>
          <h3>导出结果（四件套）</h3>
          {([
            ['风险报告 / 回答正文', bundle.riskReport],
            ['法条案例核验明细', bundle.verificationDetail],
            ['人工复核记录', bundle.reviewLog],
            ['人工智能使用声明', bundle.declaration],
          ] as [string, string][]).map(([title, body]) => (
            <details className="doc" key={title} open={title === '人工智能使用声明'}>
              <summary>{title}</summary>
              <pre>{body}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
