import { useCallback, useEffect, useState, type CSSProperties } from 'react';

interface Skill {
  id: string;
  name: string;
  version: string;
  category: string;
  description: string;
  checklist: { id: string; label: string; required: boolean }[];
  steps: string[];
}
interface Fact {
  id: string; subject: string; predicate: string; value: string; source: string; demo: boolean; verified: boolean;
}
interface PlatformData {
  skills: Skill[];
  facts: Fact[];
  contradictions: { subject: string; predicate: string; values: string[]; sources: string[] }[];
  gaps: string[];
  usage: { sessions: number; llmCalls: number; toolCalls: number; tokensEstimate: number; note: string };
  datasource: { name: string; demo: boolean; degraded: boolean; stats: { laws: number; cases: number; companies: number } };
  tenancy: { tenantId: string; matters: { id: string; name: string; allowedUsers: string[] }[] };
  mcpTools: string[];
}

type Sub = 'skills' | 'facts' | 'usage' | 'source' | 'access' | 'mcp';
const SUBS: [Sub, string][] = [
  ['skills', 'Skill'], ['facts', '事实层'], ['usage', '用量'],
  ['source', '数据源'], ['access', '权限'], ['mcp', 'MCP'],
];

const SUBTAB_STYLE: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12,
};

export default function PlatformPanel() {
  const [data, setData] = useState<PlatformData | null>(null);
  const [sub, setSub] = useState<Sub>('skills');
  const [error, setError] = useState('');
  const [skillId, setSkillId] = useState('contract-review');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [checkResult, setCheckResult] = useState<string>('');
  const [fact, setFact] = useState({ subject: '甲公司', predicate: '', value: '', source: '' });
  const [health, setHealth] = useState('');
  const [userId, setUserId] = useState('张律师');
  const [matters, setMatters] = useState<string[]>([]);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/platform');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '加载失败');
      setData(json as PlatformData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function runChecklist() {
    setCheckResult('');
    try {
      const res = await fetch('/api/skills/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: skillId, answeredIds: [...checked] }),
      });
      const j = await res.json();
      setCheckResult(
        j.complete ? '清单已完成，可进入复核闸门' : `未完成：缺少 ${(j.missing ?? []).join('、')}`,
      );
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function addFact() {
    setError('');
    try {
      const res = await fetch('/api/facts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fact),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? '写入失败');
      setFact({ ...fact, predicate: '', value: '', source: '' });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function checkHealth() {
    setHealth('检查中…');
    try {
      const j = await (await fetch('/api/datasources/health', { method: 'POST' })).json();
      setHealth(j.ok ? `正常：${j.active}` : `已降级：${j.active}｜${j.detail ?? ''}`);
      await load();
    } catch (e) { setHealth(e instanceof Error ? e.message : String(e)); }
  }

  async function loadMatters() {
    setError('');
    try {
      const res = await fetch(`/api/tenants/tenant-demo/matters?userId=${encodeURIComponent(userId)}`);
      const j = await res.json();
      setMatters((j.matters ?? []).map((m: { name: string }) => m.name));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  const skill = data?.skills.find((s) => s.id === skillId);

  return (
    <div>
      <h3>平台能力（第 3 期）</h3>
      <p className="desc">Skill 中心 / 案件事实层 / 用量 / 数据源降级 / 伦理墙 / MCP Server，全部可运行可测试。</p>
      <div style={SUBTAB_STYLE}>
        {SUBS.map(([k, label]) => (
          <button key={k} className={`btn ${sub === k ? 'done' : ''}`} onClick={() => setSub(k)}>{label}</button>
        ))}
      </div>
      {error && <div className="err">{error}</div>}

      {data && sub === 'skills' && (
        <>
          <div className="field">
            <span>清单</span>
            <select value={skillId} onChange={(e) => { setSkillId(e.target.value); setChecked(new Set()); setCheckResult(''); }}>
              {data.skills.map((s) => <option key={s.id} value={s.id}>{s.name} v{s.version}</option>)}
            </select>
          </div>
          {skill && (
            <>
              <p className="desc">{skill.description}｜步骤：{skill.steps.join(' → ')}</p>
              {skill.checklist.map((i) => (
                <label key={i.id} className="cit" style={{ display: 'block' }}>
                  <input
                    type="checkbox" checked={checked.has(i.id)}
                    onChange={(e) => {
                      const next = new Set(checked);
                      if (e.target.checked) next.add(i.id); else next.delete(i.id);
                      setChecked(next);
                    }}
                  />{' '}
                  {i.label}{i.required ? '（必填）' : '（可选）'}
                </label>
              ))}
              <button className="btn primary" style={{ marginTop: 8 }} onClick={runChecklist}>校验清单</button>
              {checkResult && <div className={checkResult.startsWith('清单已完成') ? 'ok' : 'err'}>{checkResult}</div>}
            </>
          )}
        </>
      )}

      {data && sub === 'facts' && (
        <>
          <div className="ok">事实 {data.facts.length} 条｜矛盾 {data.contradictions.length} 处｜缺口 {data.gaps.length} 项</div>
          {data.contradictions.map((c) => (
            <div className="err" key={`${c.subject}-${c.predicate}`}>
              冲突：{c.subject} 的「{c.predicate}」出现 {c.values.join(' / ')}；来源 {c.sources.join(' / ')}。已挂起，不自动合并、不让模型裁决。
            </div>
          ))}
          <p className="desc">应存在但缺失：{data.gaps.length ? data.gaps.join('、') : '无'}</p>
          {data.facts.map((f) => (
            <div className="cit" key={f.id}>
              <div className="raw">{f.subject} · {f.predicate} = {f.value}</div>
              <div className="reason">出处：{f.source}｜{f.demo ? '演示数据' : '权威源'}｜{f.verified ? '已核验' : '待核验'}</div>
            </div>
          ))}
          <div className="field"><span>新增事实</span></div>
          <input className="txt" style={{ width: '100%', marginBottom: 6 }} placeholder="属性，如 重大合同" value={fact.predicate} onChange={(e) => setFact({ ...fact, predicate: e.target.value })} />
          <input className="txt" style={{ width: '100%', marginBottom: 6 }} placeholder="取值" value={fact.value} onChange={(e) => setFact({ ...fact, value: e.target.value })} />
          <input className="txt" style={{ width: '100%', marginBottom: 8 }} placeholder="出处（必填，无出处会被拒绝）" value={fact.source} onChange={(e) => setFact({ ...fact, source: e.target.value })} />
          <button className="btn primary" onClick={addFact}>写入事实</button>
        </>
      )}

      {data && sub === 'usage' && (
        <>
          <div className="ok">
            会话 {data.usage.sessions}｜模型调用 {data.usage.llmCalls}｜工具调用 {data.usage.toolCalls}｜估算 token {data.usage.tokensEstimate}
          </div>
          <p className="desc">{data.usage.note}</p>
          <p className="desc">明细见 <code>/api/usage</code>，可导出 JSONL 用于按量核算。</p>
        </>
      )}

      {data && sub === 'source' && (
        <>
          <div className={data.datasource.degraded ? 'err' : 'ok'}>
            当前：{data.datasource.name}｜{data.datasource.degraded ? '已降级到演示语料' : '主数据源正常'}
          </div>
          <p className="desc">
            语料 {data.datasource.stats.laws} 法条 / {data.datasource.stats.cases} 案例 / {data.datasource.stats.companies} 企业（全部 DEMO）。
            降级后核验结果会自动变为 demo_only，绝不伪装成权威核验通过。
          </p>
          <button className="btn primary" onClick={checkHealth}>立即健康检查</button>
          {health && <div className="ok">{health}</div>}
        </>
      )}

      {data && sub === 'access' && (
        <>
          <div className="field">
            <span>当前用户</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              {['张律师', '李律师', '赵律师', '王助理'].map((u) => <option key={u}>{u}</option>)}
            </select>
            <button className="btn" onClick={loadMatters}>查看可见项目</button>
          </div>
          <p className="desc">按项目级名单继承权限；被排除的项目根本不出现在列表里（伦理墙 / 利益冲突隔离）。</p>
          {matters.length > 0
            ? matters.map((m) => <div className="cit" key={m}><div className="raw">{m}</div></div>)
            : <p className="desc">点击「查看可见项目」加载。</p>}
          <p className="desc">全部项目：{data.tenancy.matters.map((m) => m.name).join('、')}</p>
        </>
      )}

      {data && sub === 'mcp' && (
        <>
          <p className="desc">
            D4 把核验 / 检索 / 审查能力暴露为标准 MCP 工具（stdio JSON-RPC），
            供 Claude、WorkBuddy 等宿主调用。启动：<code>npm run mcp</code>。
          </p>
          {data.mcpTools.map((t) => <div className="cit" key={t}><div className="raw">{t}</div></div>)}
          <details className="doc">
            <summary>宿主配置示例（.mcp.example.json）</summary>
            <pre>{JSON.stringify({ mcpServers: { lexguard: { command: 'npm', args: ['run', 'mcp'], cwd: '<本仓库绝对路径>' } } }, null, 2)}</pre>
          </details>
        </>
      )}
      {!data && <p className="desc">加载中…</p>}
    </div>
  );
}
