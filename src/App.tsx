import { useCallback, useEffect, useRef, useState } from 'react';
import CitationPanel from './components/CitationPanel';
import ContractPanel from './components/ContractPanel';
import PlatformPanel from './components/PlatformPanel';
import type { ChatMsg, Citation, Health, SSEEvent } from './types';

const SESSION = 'lexguard-demo';
const DISCLAIMER = 'AI 辅助生成，仅供参考，不构成法律意见';

const QUICK = [
  '这份合同有哪些风险？帮我指出依据法条',
  '格式条款未尽提示说明义务有什么后果？',
  '未签书面劳动合同的二倍工资依据是什么？',
  '违约金过高能否请求调整？',
  '帮我核验这段文本里的法条引用是否可靠',
];

let seq = 0;
const uid = () => `${Date.now()}-${seq++}`;

function AuditView() {
  const [report, setReport] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const res = await fetch('/api/audit');
      const json = await res.json();
      setReport(json.report ?? '');
      setCount(json.count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <h3>可审计执行链</h3>
      <p className="desc">
        记录 who / when / agent / tool / data_class / source / citation / verification / reviewer / export。
        追加写、可导出 JSONL；留存期默认按不少于 3 年配置。
      </p>
      <button className="btn primary" onClick={load}>刷新审计日志</button>
      {error && <div className="err">{error}</div>}
      {count !== null && <div className="ok">当前事件数：{count}</div>}
      {report && <details className="doc" open><summary>审计报告</summary><pre>{report}</pre></details>}
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'verify' | 'contract' | 'audit' | 'platform'>('verify');
  const [reviewer, setReviewer] = useState('张律师');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((j: Health) => setHealth(j))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const patchLast = useCallback((fn: (m: ChatMsg) => ChatMsg) => {
    setMessages((prev) => {
      const copy = [...prev];
      const idx = copy.map((m) => m.role).lastIndexOf('assistant');
      if (idx < 0) return prev;
      copy[idx] = fn(copy[idx]);
      return copy;
    });
  }, []);

  function applyEvent(ev: SSEEvent) {
    switch (ev.type) {
      case 'delta':
        patchLast((m) => ({ ...m, content: m.content + ev.text }));
        break;
      case 'tool_call':
        patchLast((m) => ({ ...m, tools: [...m.tools, { id: ev.id, name: ev.name, args: ev.args }] }));
        break;
      case 'tool_result':
        patchLast((m) => ({
          ...m,
          tools: m.tools.map((t) =>
            t.id === ev.id ? { ...t, result: ev.result, risks: ev.risks } : t,
          ),
        }));
        break;
      case 'verification':
        setCitations(ev.citations);
        break;
      case 'review_required':
        setNotice(ev.message);
        break;
      case 'done':
        patchLast((m) => ({ ...m, content: ev.content || m.content }));
        break;
      case 'error':
        setError(ev.message);
        break;
      default:
        break;
    }
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    setCitations([]);
    const history = messages
      .filter((m) => m.content.trim())
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: 'user', content: text, tools: [] },
      { id: uid(), role: 'assistant', content: '', tools: [] },
    ]);
    setInput('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, sessionId: SESSION, who: reviewer }),
      });
      if (!res.ok || !res.body) throw new Error(`服务不可用（${res.status}）`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          try {
            applyEvent(JSON.parse(line.slice(5).trim()) as SSEEvent);
          } catch {
            // 单个坏帧不中断整条流
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="mark" />LexGuard <small>可信法律智能体平台</small></div>
        <div className="chips">
          <span className="chip live">
            {health ? `LLM ${health.llm.provider} / ${health.llm.model}` : '连接中…'}
          </span>
          <span className="chip hide-sm">
            {health ? `数据源 ${health.datasource.demo ? 'DEMO' : health.datasource.name} · ${health.datasource.stats.laws} 法条` : '数据源载入中'}
          </span>
          <span className="chip hide-sm">{health ? `${health.ruleCount} 条审查规则` : '规则载入中'}</span>
        </div>
      </header>
      <div className="disclaimer">{DISCLAIMER}｜演示语料全部标注 DEMO，不构成权威核验；关键环节须人工复核签字</div>

      <div className="body">
        <aside className="side">
          <h3>快捷能力入口</h3>
          <div className="quick">
            {QUICK.map((q) => (
              <button key={q} disabled={busy} onClick={() => send(q)}>{q}</button>
            ))}
          </div>
          <div className="note">
            第一版闭环：粘贴合同 → 风险清单 → 引用逐条核验 → 律师逐条签字 → 导出四件套 → 全程留痕。<br /><br />
            无 API key 时自动使用内置 Mock LLM，断网也能完整演示。
          </div>
        </aside>

        <main className="main">
          <div className="msgs" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="empty">
                <h2>不比谁更会答，比谁敢签字</h2>
                <p>
                  每条回答都会经过引用核验、人工复核闸门与审计留痕。
                  从左侧选一个问题，或直接输入合同片段开始。
                </p>
              </div>
            )}
            {messages.map((m) => (
              <div className={`msg ${m.role}`} key={m.id}>
                <div className="role">{m.role === 'user' ? '你' : 'LexGuard'}</div>
                <div className="bubble">{m.content || (busy ? '思考中…' : '')}</div>
                {m.tools.map((t) => (
                  <div className="tool" key={t.id}>
                    <div className="th">工具调用 · {t.name}</div>
                    <div className="args">参数：{t.args.slice(0, 160)}</div>
                    {t.result && <div className="res">{t.result.slice(0, 1200)}</div>}
                    {t.risks && t.risks.length > 0 && (
                      <div className="res">识别到 {t.risks.length} 处风险，详情见右侧「合同审查」页。</div>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {error && <div className="err">{error}</div>}
          </div>

          <div className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(input);
              }}
              placeholder="输入法律问题或粘贴合同片段…（Ctrl / ⌘ + Enter 发送）"
            />
            <button disabled={busy || !input.trim()} onClick={() => send(input)}>
              {busy ? '运行中…' : '发送'}
            </button>
          </div>
          <div className="hintline" style={{ padding: '0 18px 10px' }}>
            事件协议：delta / tool_call / tool_result / verification / review_required / done
          </div>
        </main>

        <aside className="right">
          <div className="tabs">
            <button className={tab === 'verify' ? 'on' : ''} onClick={() => setTab('verify')}>引用核验</button>
            <button className={tab === 'contract' ? 'on' : ''} onClick={() => setTab('contract')}>合同审查</button>
            <button className={tab === 'audit' ? 'on' : ''} onClick={() => setTab('audit')}>审计日志</button>
            <button className={tab === 'platform' ? 'on' : ''} onClick={() => setTab('platform')}>平台能力</button>
          </div>
          <div className="panel">
            {tab === 'verify' && (
              <CitationPanel
                citations={citations}
                sessionId={SESSION}
                reviewer={reviewer}
                onReviewer={setReviewer}
                notice={notice}
              />
            )}
            {tab === 'contract' && <ContractPanel />}
            {tab === 'audit' && <AuditView />}
            {tab === 'platform' && <PlatformPanel />}
          </div>
        </aside>
      </div>
    </div>
  );
}
