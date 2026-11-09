import { useState } from 'react';
import type { Citation, ContractRisk } from '../types';

const SAMPLE = [
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

const LV: Record<string, string> = { high: '高', medium: '中', low: '低' };

interface ReviewResponse {
  disclaimer: string;
  dataClass: string;
  risks: ContractRisk[];
  counts: { high: number; medium: number; low: number };
  citations: Citation[];
  note: string;
}

export default function ContractPanel() {
  const [text, setText] = useState(SAMPLE);
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setBusy(true);
    setError('');
    setData(null);
    try {
      const res = await fetch('/api/contract/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '审查失败');
      setData(json as ReviewResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3>合同审查（规则引擎）</h3>
      <p className="desc">
        14 条可解释风险规则，结果可复现、可单测、不依赖模型。依据法条自动送引用核验；
        未命中不代表合同无风险。
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', height: 150, border: '1px solid var(--line-2)', borderRadius: 9, padding: 10, background: 'var(--surface-2)', color: 'var(--ink)', resize: 'vertical' }}
      />
      <div className="btns">
        <button className="btn primary" disabled={busy || !text.trim()} onClick={run}>
          {busy ? '审查中…' : '开始审查'}
        </button>
        <button className="btn" onClick={() => { setText(SAMPLE); setData(null); }}>
          恢复示例
        </button>
      </div>
      {error && <div className="err">{error}</div>}

      {data && (
        <>
          <div className="ok">
            数据分级 {data.dataClass}｜共 {data.risks.length} 处风险：
            高 {data.counts.high} / 中 {data.counts.medium} / 低 {data.counts.low}；
            依据引用 {data.citations.length} 条（{data.citations[0]?.status ?? '无'}）
          </div>
          <p className="desc">{data.note}</p>
          {data.risks.length === 0 && <p className="desc">未命中演示规则库中的风险模式。</p>}
          {data.risks.map((r) => (
            <div className="risk" key={r.id}>
              <div className="q">
                <span className={`lv ${r.level}`}>{LV[r.level]}</span>
                {r.category}｜{r.quote}
              </div>
              <div className="r">{r.reason}</div>
              <div className="r">依据：{r.basis.join('、')}</div>
              <div className="s">建议：{r.suggestion}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
