'use client';

/**
 * JudgeChat — 매수·매도 심판엔진 채팅 (Gemini 스타일, 2026-06-18)
 * 전체화면 모달. LLM + RAG + 실시간 금융 API + 리포트(/api/judge-chat).
 * per-user 대화 히스토리(사이드바) — 로그인(fv_member)/익명(fv_chat_uid) 소유자별 저장.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Scale, Plus, Send, Loader2, X, ChevronDown, SquarePen, TrendingUp, TrendingDown, Briefcase, FileText, Menu, Trash2, MessageSquare, Home } from 'lucide-react';

type Mode = 'aits' | 'aits-rag' | 'aits-deep';
interface Msg { role: 'user' | 'assistant'; content: string; source?: string; grounding?: Grounding }
interface RagSource { source: string; year: number | string | null; score: number }
interface Grounding { tickers?: Array<{ ticker: string; name: string; price: number | null; rsi: number | null }>; usedRules?: boolean; usedReport?: boolean; usedRag?: boolean; usedMacro?: boolean; ragSources?: RagSource[] }
interface ConvMeta { id: string; title: string; updatedAt: number }

function renderInline(text: string, keyBase: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={`${keyBase}-${i}`} className="font-semibold text-gray-900">{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={`${keyBase}-${i}`} className="px-1 py-0.5 rounded bg-gray-100 text-[0.85em] font-mono text-rose-700">{p.slice(1, -1)}</code>;
    return <span key={`${keyBase}-${i}`}>{p}</span>;
  });
}
function Markdownish({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length) { blocks.push(<ul key={`ul-${k}`} className="list-disc pl-5 space-y-1 my-2">{list.map((it, j) => <li key={j}>{renderInline(it, `li-${k}-${j}`)}</li>)}</ul>); list = []; }
  };
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (/^[-*•]\s+/.test(t)) { list.push(t.replace(/^[-*•]\s+/, '')); return; }
    flush(i);
    if (!t) { blocks.push(<div key={`sp-${i}`} className="h-2" />); return; }
    if (/^#{1,3}\s+/.test(t)) { blocks.push(<p key={`h-${i}`} className="font-bold text-gray-900 mt-3 mb-1">{renderInline(t.replace(/^#{1,3}\s+/, ''), `h-${i}`)}</p>); return; }
    blocks.push(<p key={`p-${i}`} className="leading-relaxed">{renderInline(t, `p-${i}`)}</p>);
  });
  flush(lines.length);
  return <div className="text-[15px] text-gray-800 space-y-0.5">{blocks}</div>;
}

export default function JudgeChat({ onClose }: { onClose: () => void }) {
  const t = useTranslations('judge');
  const locale = useLocale();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>('aits-rag');
  const [modeOpen, setModeOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const [convs, setConvs] = useState<ConvMeta[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 2026-06-18: 채팅 진입에 로그인 필수 (사용자 "채팅창 들어가려면 로그인"). null=확인중.
  const [member, setMember] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConvs = useCallback(async () => {
    try { const r = await fetch('/api/judge-chat?action=list'); const d = await r.json(); if (Array.isArray(d.conversations)) setConvs(d.conversations); } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetch('/api/member').then(r => r.json()).then(d => setMember(!!d.member)).catch(() => setMember(false)); }, []);
  useEffect(() => { if (member) loadConvs(); }, [member, loadConvs]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const newChat = () => { setMessages([]); setConvId(null); setSidebarOpen(false); };
  const openConv = async (id: string) => {
    setSidebarOpen(false);
    try {
      const r = await fetch(`/api/judge-chat?action=get&id=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (d.conversation?.messages) { setMessages(d.conversation.messages); setConvId(id); }
    } catch { /* ignore */ }
  };
  const deleteConv = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await fetch(`/api/judge-chat?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* ignore */ }
    setConvs(prev => prev.filter(c => c.id !== id));
    if (convId === id) newChat();
  };

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput(''); setToolsOpen(false);
    const next: Msg[] = [...messages, { role: 'user', content }];
    const asstIndex = next.length;  // assistant 자리 (아래에서 빈 메시지 append)
    setMessages([...next, { role: 'assistant', content: '' }]);
    setLoading(true);
    const patch = (fn: (m: Msg) => Msg) => setMessages(prev => { const c = [...prev]; if (c[asstIndex]) c[asstIndex] = fn(c[asstIndex]); return c; });
    try {
      const res = await fetch('/api/judge-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })), mode, locale, convId, stream: true }),
      });
      if (!res.ok || !res.body) throw new Error('no stream');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const line = p.split('\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          let obj: { type?: string; text?: string; grounding?: Grounding; convId?: string; source?: string };
          try { obj = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (obj.type === 'meta') {
            if (obj.grounding) patch(m => ({ ...m, grounding: obj.grounding }));
            if (obj.convId && !convId) setConvId(obj.convId);
          } else if (obj.type === 'delta') {
            acc += obj.text ?? '';
            patch(m => ({ ...m, content: acc }));
          } else if (obj.type === 'done') {
            patch(m => ({ ...m, source: obj.source }));
            loadConvs();
          }
        }
      }
      if (!acc.trim()) patch(() => ({ role: 'assistant', content: t('errorGeneric') }));
    } catch {
      patch(() => ({ role: 'assistant', content: t('errorGeneric') }));
    } finally { setLoading(false); }
  }, [input, loading, messages, mode, locale, t, convId, loadConvs]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  const MODES: { id: Mode; label: string; desc: string }[] = [
    { id: 'aits', label: t('modeAits'), desc: t('modeAitsDesc') },
    { id: 'aits-rag', label: t('modeAitsRag'), desc: t('modeAitsRagDesc') },
    { id: 'aits-deep', label: t('modeDeep'), desc: t('modeDeepDesc') },
  ];
  const QUICK: { icon: React.ReactNode; label: string; prompt: string }[] = [
    { icon: <TrendingUp className="w-5 h-5 text-emerald-600" />, label: t('quickBuy'), prompt: t('quickBuyPrompt') },
    { icon: <TrendingDown className="w-5 h-5 text-rose-600" />, label: t('quickSell'), prompt: t('quickSellPrompt') },
    { icon: <Briefcase className="w-5 h-5 text-indigo-600" />, label: t('quickPortfolio'), prompt: t('quickPortfolioPrompt') },
    { icon: <FileText className="w-5 h-5 text-amber-600" />, label: t('quickReport'), prompt: t('quickReportPrompt') },
  ];

  const Sidebar = (
    <div className="flex flex-col h-full w-64 bg-gray-50 border-r border-gray-100">
      <div className="p-3">
        <button onClick={newChat} className="w-full flex items-center gap-2 rounded-full bg-white border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 shadow-sm transition-colors">
          <SquarePen className="w-4 h-4" /> {t('newChat')}
        </button>
      </div>
      <div className="px-3 pb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{t('historyTitle')}</div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {convs.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-400">{t('emptyHistory')}</p>
        ) : convs.map(c => (
          <button key={c.id} onClick={() => openConv(c.id)}
            className={`group w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${convId === c.id ? 'bg-rose-50 text-rose-700' : 'text-gray-700 hover:bg-gray-100'}`}>
            <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
            <span className="flex-1 truncate">{c.title}</span>
            <span onClick={(e) => deleteConv(c.id, e)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-500 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></span>
          </button>
        ))}
      </div>
    </div>
  );

  // 로그인 확인 중 / 비로그인 → 게이트 (채팅 진입 차단)
  if (member === null) {
    return (
      <div className="fixed inset-0 z-[70] bg-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-rose-500 animate-spin" />
      </div>
    );
  }
  if (member === false) {
    return <JudgeLoginGate onClose={onClose} onLogin={() => setMember(true)} t={t} />;
  }

  return (
    <div className="fixed inset-0 z-[70] bg-white flex">
      {/* 데스크톱 사이드바 */}
      <aside className="hidden md:flex flex-shrink-0">{Sidebar}</aside>
      {/* 모바일 드로어 */}
      {sidebarOpen && (
        <>
          <div className="md:hidden fixed inset-0 z-10 bg-black/30" onClick={() => setSidebarOpen(false)} />
          <aside className="md:hidden fixed left-0 top-0 bottom-0 z-20">{Sidebar}</aside>
        </>
      )}

      {/* 메인 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-1">
            <button onClick={() => setSidebarOpen(true)} className="md:hidden p-2 rounded-full hover:bg-gray-100 text-gray-500"><Menu className="w-5 h-5" /></button>
            <button onClick={onClose} title={t('backHome')} className="flex items-center gap-1 p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors"><Home className="w-5 h-5" /><span className="hidden sm:inline text-xs font-medium">{t('backHome')}</span></button>
            <div className="relative">
              <button onClick={() => setModeOpen(o => !o)} className="flex items-center gap-1.5 text-base sm:text-lg font-semibold text-gray-900 hover:bg-gray-50 rounded-lg px-2 py-1 transition-colors">
                <Scale className="w-5 h-5 text-rose-500" />
                <span className="hidden sm:inline">{t('title')}</span>
                <span className="text-xs font-normal text-gray-400">· {MODES.find(m => m.id === mode)?.label}</span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${modeOpen ? 'rotate-180' : ''}`} />
              </button>
              {modeOpen && (
                <div className="absolute left-0 top-full mt-1 w-64 bg-white rounded-2xl shadow-xl border border-gray-100 p-2 z-10">
                  {MODES.map(m => (
                    <button key={m.id} onClick={() => { setMode(m.id); setModeOpen(false); }}
                      className={`w-full text-left rounded-xl px-3 py-2.5 hover:bg-gray-50 transition-colors ${mode === m.id ? 'bg-rose-50' : ''}`}>
                      <div className="flex items-center gap-2"><span className="font-medium text-gray-900">{m.label}</span>{mode === m.id && <span className="text-rose-500 text-sm">✓</span>}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{m.desc}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && <button onClick={newChat} title={t('newChat')} className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors"><SquarePen className="w-5 h-5" /></button>}
            <button onClick={onClose} title={t('backHome')} className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center px-6 -mt-10">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-400 via-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30 mb-5"><Scale className="w-7 h-7 text-white" /></div>
              <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-orange-500 via-rose-500 to-pink-600 bg-clip-text text-transparent text-center mb-2">{t('greeting')}</h2>
              <p className="text-sm text-gray-400 text-center mb-8 max-w-md">{t('greetingSub')}</p>
              <div className="grid grid-cols-2 gap-2.5 w-full max-w-lg">
                {QUICK.map((q, i) => (
                  <button key={i} onClick={() => send(q.prompt)} className="flex items-center gap-2.5 text-left rounded-2xl border border-gray-200 px-4 py-3 hover:bg-gray-50 hover:border-gray-300 transition-colors">
                    {q.icon}<span className="text-sm font-medium text-gray-700">{q.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
              {messages.map((m, i) => (
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-3xl rounded-br-md bg-gray-100 px-4 py-2.5 text-[15px] text-gray-900 whitespace-pre-wrap">{m.content}</div></div>
                ) : (
                  <div key={i} className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 via-rose-500 to-pink-600 flex items-center justify-center mt-0.5"><Scale className="w-4 h-4 text-white" /></div>
                    <div className="flex-1 min-w-0">
                      {m.content
                        ? <Markdownish text={m.content} />
                        : <div className="flex items-center gap-2 text-gray-400 text-sm py-1.5"><Loader2 className="w-4 h-4 animate-spin" />{t('thinking')}</div>}
                      {(m.grounding?.tickers?.length || m.grounding?.usedReport || m.grounding?.usedRag || m.grounding?.usedMacro || m.source) && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          {m.grounding?.tickers?.filter(tk => tk.price != null).map(tk => (
                            <span key={tk.ticker} className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">{tk.name} {tk.price}{tk.rsi != null ? ` · RSI ${tk.rsi}` : ''}</span>
                          ))}
                          {m.grounding?.usedMacro && <span className="text-[11px] text-sky-700 bg-sky-50 border border-sky-200 rounded-full px-2 py-0.5">🌐 F&G·VIX·FedWatch·FRED</span>}
                          {m.grounding?.usedReport && <span className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">📋 {t('groundReport')}</span>}
                          {m.grounding?.usedRules && <span className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">⚖️ {t('groundRules')}</span>}
                          {m.grounding?.ragSources?.map((rs, ri) => (
                            <span key={`rag-${ri}`} className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">📚 {rs.source}{rs.year ? ` ${rs.year}` : ''}</span>
                          ))}
                          {m.source && <span className="text-[11px] text-gray-400">· {m.source}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                )
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="px-4 pb-5 pt-2">
          <div className="max-w-3xl mx-auto">
            {toolsOpen && (
              <div className="mb-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {QUICK.map((q, i) => (
                  <button key={i} onClick={() => send(q.prompt)} className="flex items-center gap-2 rounded-2xl bg-gray-50 border border-gray-200 px-3 py-2 hover:bg-gray-100 transition-colors">{q.icon}<span className="text-xs font-medium text-gray-700">{q.label}</span></button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-3xl border border-gray-300 bg-white px-2 py-1.5 shadow-sm focus-within:border-gray-400 transition-colors">
              <button onClick={() => setToolsOpen(o => !o)} className="flex-shrink-0 w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-colors" title={t('tools')}><Plus className={`w-5 h-5 transition-transform ${toolsOpen ? 'rotate-45' : ''}`} /></button>
              <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown} placeholder={t('placeholder')} rows={1} className="flex-1 resize-none bg-transparent py-2.5 text-[15px] text-gray-900 placeholder:text-gray-400 focus:outline-none max-h-32" />
              <button onClick={() => send()} disabled={!input.trim() || loading} className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 disabled:bg-gray-200 bg-gradient-to-br from-orange-500 to-pink-600 text-white">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</button>
            </div>
            <p className="text-[11px] text-gray-400 text-center mt-2">{t('disclaimer')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 로그인 게이트 (2026-06-18) — 채팅 진입에 회원 필수. 이메일 등록 = 즉시 해제(/api/member). ──
function JudgeLoginGate({ onClose, onLogin, t }: { onClose: () => void; onLogin: () => void; t: ReturnType<typeof useTranslations> }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const submit = async () => {
    if (busy || !email.trim()) return;
    setBusy(true); setErr(false);
    try {
      const r = await fetch('/api/member', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      if (r.ok) onLogin(); else setErr(true);
    } catch { setErr(true); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-[70] bg-white flex items-center justify-center p-4">
      <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500"><X className="w-5 h-5" /></button>
      <div className="w-full max-w-md rounded-2xl border-2 border-rose-200 bg-gradient-to-b from-rose-50 to-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-gradient-to-br from-orange-400 via-rose-500 to-pink-600 flex items-center justify-center"><Scale className="w-6 h-6 text-white" /></div>
        <h2 className="text-lg font-bold text-gray-900 mb-1.5">{t('loginTitle')}</h2>
        <p className="text-sm text-gray-600 mb-5 leading-relaxed">{t('loginBody')}</p>
        <div className="flex gap-2">
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder={t('loginPlaceholder')}
            className="flex-1 px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
          />
          <button onClick={submit} disabled={busy}
            className="px-4 py-2.5 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-50 whitespace-nowrap">
            {busy ? '…' : t('loginSubmit')}
          </button>
        </div>
        {err && <p className="text-xs text-red-500 mt-2">{t('loginError')}</p>}
        <p className="text-[10px] text-gray-400 mt-4">{t('loginFreeNote')}</p>
      </div>
    </div>
  );
}
