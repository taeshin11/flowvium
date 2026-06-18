'use client';

/**
 * JudgeChat — 매수·매도 심판엔진 채팅 (Gemini 스타일, 2026-06-18)
 * 전체화면 모달. LLM + RAG + 실시간 금융 API + 리포트(/api/judge-chat).
 * per-user 대화 히스토리(사이드바) — 로그인(fv_member)/익명(fv_chat_uid) 소유자별 저장.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Scale, Plus, Send, Loader2, X, ChevronDown, SquarePen, TrendingUp, TrendingDown, Briefcase, FileText, Menu, Trash2, MessageSquare } from 'lucide-react';

type Mode = 'aits' | 'aits-rag';
interface Msg { role: 'user' | 'assistant'; content: string; source?: string; grounding?: Grounding }
interface RagSource { source: string; year: number | string | null; score: number }
interface Grounding { tickers?: Array<{ ticker: string; name: string; price: number | null; rsi: number | null }>; usedRules?: boolean; usedReport?: boolean; usedRag?: boolean; ragSources?: RagSource[] }
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
  const [mode, setMode] = useState<Mode>('aits');
  const [modeOpen, setModeOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const [convs, setConvs] = useState<ConvMeta[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConvs = useCallback(async () => {
    try { const r = await fetch('/api/judge-chat?action=list'); const d = await r.json(); if (Array.isArray(d.conversations)) setConvs(d.conversations); } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadConvs(); }, [loadConvs]);
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
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch('/api/judge-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })), mode, locale, convId }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply ?? t('errorGeneric'), source: data.source, grounding: data.grounding }]);
      if (data.convId) { if (!convId) setConvId(data.convId); loadConvs(); }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: t('errorGeneric') }]);
    } finally { setLoading(false); }
  }, [input, loading, messages, mode, locale, t, convId, loadConvs]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  const MODES: { id: Mode; label: string; desc: string }[] = [
    { id: 'aits', label: t('modeAits'), desc: t('modeAitsDesc') },
    { id: 'aits-rag', label: t('modeAitsRag'), desc: t('modeAitsRagDesc') },
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
            <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors"><X className="w-5 h-5" /></button>
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
                      <Markdownish text={m.content} />
                      {(m.grounding?.tickers?.length || m.grounding?.usedReport || m.grounding?.usedRag || m.source) && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          {m.grounding?.tickers?.filter(tk => tk.price != null).map(tk => (
                            <span key={tk.ticker} className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">{tk.name} {tk.price}{tk.rsi != null ? ` · RSI ${tk.rsi}` : ''}</span>
                          ))}
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
              {loading && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 via-rose-500 to-pink-600 flex items-center justify-center"><Scale className="w-4 h-4 text-white" /></div>
                  <div className="flex items-center gap-2 text-gray-400 text-sm pt-1.5"><Loader2 className="w-4 h-4 animate-spin" />{t('thinking')}</div>
                </div>
              )}
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
