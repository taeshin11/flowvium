'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { macroNarratives, type MacroNarrative } from '@/data/macro-narratives';
import {
  fearGreedByCountry,
  fearGreedByAsset,
  moneyFlowSectors,
  getLevel,
  levelLabels,
  type FearGreedEntry,
  type MoneyFlowSector,
} from '@/data/fear-greed';
import {
  Brain,
  Send,
  Loader2,
  BookOpen,
  Tag,
  ArrowRight,
  Scale,
  TrendingUp,
  TrendingDown,
  Eye,
  RefreshCw,
  Shield,
  Radar,
  Globe,
  Zap,
  Activity,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  GitMerge,
} from 'lucide-react';

// ── Icon map for narratives ───────────────────────────────────────────────────
const iconMap: Record<string, React.ReactNode> = {
  Scale: <Scale className="w-5 h-5" />,
  TrendingUp: <TrendingUp className="w-5 h-5" />,
  Eye: <Eye className="w-5 h-5" />,
  RefreshCw: <RefreshCw className="w-5 h-5" />,
  Shield: <Shield className="w-5 h-5" />,
  Radar: <Radar className="w-5 h-5" />,
  Globe: <Globe className="w-5 h-5" />,
  Zap: <Zap className="w-5 h-5" />,
};

const categoryColorMap: Record<string, string> = {
  'power-structure': 'bg-red-50 text-red-700 border-red-200',
  monetary: 'bg-blue-50 text-blue-700 border-blue-200',
  geopolitical: 'bg-teal-50 text-teal-700 border-teal-200',
  information: 'bg-purple-50 text-purple-700 border-purple-200',
  regulatory: 'bg-amber-50 text-amber-700 border-amber-200',
};

function categoryLabel(cat: MacroNarrative['category'], t: ReturnType<typeof useTranslations<'intelligence'>>): string {
  const map: Record<MacroNarrative['category'], string> = {
    'power-structure': t('categoryPower'),
    monetary: t('categoryMonetary'),
    geopolitical: t('categoryGeopolitical'),
    information: t('categoryInformation'),
    regulatory: t('categoryRegulatory'),
  };
  return map[cat];
}

// ── Fear & Greed Gauge ────────────────────────────────────────────────────────
function FearGreedGauge({ score }: { score: number }) {
  const pct = score / 100;
  // Standard math angle: 180° = left (fear=0), 0° = right (greed=100)
  const angleDeg = 180 - pct * 180;
  const rad = (angleDeg * Math.PI) / 180;
  const cx = 60, cy = 60, r = 44;
  // cos for x (right is positive), sin for y (up is positive, so subtract in SVG)
  const needleX = cx + r * Math.cos(rad);
  const needleY = cy - r * Math.sin(rad);

  const gradColors = ['#dc2626', '#f97316', '#eab308', '#22c55e', '#059669'];
  const segCount = gradColors.length;

  return (
    <svg viewBox="0 0 120 72" className="w-full max-w-[100px]">
      {gradColors.map((color, i) => {
        const startAngle = (i / segCount) * Math.PI;
        const endAngle = ((i + 1) / segCount) * Math.PI;
        const x1 = cx + r * Math.cos(Math.PI + startAngle);
        const y1 = cy + r * Math.sin(Math.PI + startAngle);
        const x2 = cx + r * Math.cos(Math.PI + endAngle);
        const y2 = cy + r * Math.sin(Math.PI + endAngle);
        return (
          <path
            key={i}
            d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="butt"
            opacity={0.85}
          />
        );
      })}
      <line x1={cx} y1={cy} x2={needleX} y2={needleY}
        stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="3.5" fill="#1e293b" />
    </svg>
  );
}

interface FearGreedEntryExtended extends FearGreedEntry {
  factors?: { rsi: number; momentum: number; volatility: number };
  detail?: { factors: string[]; macro: string; risk: string } | null;
  // 'cnn' = CNN 공식 API, 'composite' = FlowVium 3요소 자체계산
  source?: 'cnn' | 'composite';
}

function FactorBar({ label, score, weight }: { label: string; score: number; weight: string }) {
  const color = score >= 75 ? 'bg-green-500' : score >= 55 ? 'bg-lime-400' : score >= 45 ? 'bg-yellow-400' : score >= 25 ? 'bg-orange-400' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-cf-text-secondary w-14 flex-shrink-0">{label}</span>
      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] font-bold w-8 text-right tabular-nums text-cf-text-primary">{score}</span>
      <span className="text-[9px] text-gray-400 w-8">{weight}</span>
    </div>
  );
}

function FearGreedCard({ entry }: { entry: FearGreedEntryExtended }) {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations('intelligence');
  const level = getLevel(entry.score);
  const meta = levelLabels[level];
  const delta = entry.prevScore !== undefined ? entry.score - entry.prevScore : 0;
  const hasDetail = !!(entry.factors || entry.detail);

  return (
    <div className={`cf-card border ${meta.border} flex flex-col overflow-hidden`}>
      {/* Main row — clickable */}
      <button
        className="p-4 flex flex-col gap-2 text-left w-full"
        onClick={() => hasDetail && setExpanded(e => !e)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl leading-none">{entry.flag}</span>
            <span className="text-sm font-bold text-cf-text-primary leading-tight truncate">{entry.label}</span>
            {/* 출처 뱃지: CNN 공식 vs FlowVium 합성 — 같은 숫자라도 계산법 다름을 명시 */}
            {entry.source === 'cnn' && (
              <span
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 flex-shrink-0"
                title="CNN 공식 Fear & Greed Index (edition.cnn.com/markets/fear-and-greed)"
              >
                CNN
              </span>
            )}
            {entry.source === 'composite' && (
              <span
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200 flex-shrink-0"
                title="FlowVium 합성 지수: RSI-14 × 40% + 125일 SMA 모멘텀 × 35% + 변동성 × 25%"
              >
                합성
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.bg} ${meta.color} ${meta.border}`}>
              {meta.ko}
            </span>
            {hasDetail && (
              <span className="text-[10px] text-cf-text-secondary">
                {expanded ? '▲' : '▼'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FearGreedGauge score={entry.score} />
          <div className="flex flex-col items-center justify-center w-12 flex-shrink-0">
            <span className={`text-3xl font-extrabold leading-none ${meta.color}`}>{entry.score}</span>
            <span className="text-[10px] text-cf-text-secondary mt-0.5">/100</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 mb-1">
              {entry.trend === 'up' && <ArrowUpRight className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
              {entry.trend === 'down' && <ArrowDownRight className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
              {entry.trend === 'neutral' && <Minus className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
              <span className={`text-xs font-semibold ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                {delta > 0 ? `+${delta}` : delta !== 0 ? delta : '±0'} (7d)
              </span>
            </div>
            <p className="text-[11px] text-cf-text-secondary leading-relaxed">{entry.driver}</p>
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-cf-border bg-gray-50/60 px-4 py-3 space-y-3">
          {/* Factor breakdown */}
          {entry.factors && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-cf-text-secondary uppercase tracking-wide mb-1.5">📊 심리 구성 요소</p>
              <FactorBar label={t('rsiMomentum')} score={entry.factors.rsi} weight="40%" />
              <FactorBar label={t('trendStrength')} score={entry.factors.momentum} weight="35%" />
              <FactorBar label={t('volatility')} score={entry.factors.volatility} weight="25%" />
              <p className="text-[9px] text-gray-400 mt-1">0=극단공포 · 50=중립 · 100=극단탐욕</p>
            </div>
          )}

          {/* Macro context */}
          {entry.detail && (
            <>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-cf-text-secondary uppercase tracking-wide">🔍 측정 요인</p>
                {entry.detail.factors.map((f, i) => (
                  <p key={i} className="text-[11px] text-cf-text-secondary leading-relaxed flex gap-1.5">
                    <span className="text-gray-400 flex-shrink-0">•</span>{f}
                  </p>
                ))}
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-2.5">
                <p className="text-[10px] font-bold text-blue-700 mb-1">📈 현재 심리 배경</p>
                <p className="text-[11px] text-blue-700 leading-relaxed">{entry.detail.macro}</p>
              </div>
              <div className="rounded-lg bg-red-50 border border-red-100 p-2.5">
                <p className="text-[10px] font-bold text-red-600 mb-1">⚠ 주요 리스크</p>
                <p className="text-[11px] text-red-600 leading-relaxed">{entry.detail.risk}</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Money Flow ────────────────────────────────────────────────────────────────
function weeksAgo(dateStr: string): string {
  const start = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const dateLabel = `${start.getFullYear()}년 ${start.getMonth() + 1}월`;
  if (diffDays < 7) return `${diffDays}일 전 시작 (${dateLabel})`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전 시작 (${dateLabel})`;
  const months = Math.floor(diffDays / 30);
  return `${months}개월 전 시작 (${dateLabel})`;
}

const signalBadgeCls: Record<string, string> = {
  accelerating: 'bg-amber-100 text-amber-700 border border-amber-200',
  holding:      'bg-slate-100 text-slate-600 border border-slate-200',
  fading:       'bg-gray-100 text-gray-500 border border-gray-200',
};

function MoneyFlowRow({ flow }: { flow: MoneyFlowSector }) {
  const t = useTranslations('intelligence');
  const isInflow = flow.direction === 'inflow';
  const signalLabel = flow.signal === 'accelerating' ? t('accelerating') : flow.signal === 'fading' ? t('weakening') : t('maintaining');
  const sigCls = signalBadgeCls[flow.signal] ?? signalBadgeCls['holding'];
  return (
    <div className={`rounded-xl border p-4 ${isInflow ? 'border-green-200 bg-green-50/40' : 'border-red-200 bg-red-50/40'}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isInflow ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {isInflow ? t('inflow') : t('outflow')}
            </span>
            <span className="text-sm font-bold text-cf-text-primary">{flow.sector}</span>
            <span className="text-xs text-cf-text-secondary">({flow.sectorKo})</span>
          </div>
          <p className="text-xs text-cf-text-secondary leading-relaxed mb-2">{flow.reason}</p>
          {/* Timing row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-cf-text-secondary flex items-center gap-1">
              🕐 {weeksAgo(flow.sinceDate)}
            </span>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${sigCls}`}>
              {signalLabel}
            </span>
          </div>
        </div>
        {/* Magnitude bars */}
        <div className="flex gap-0.5 flex-shrink-0 mt-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-4 rounded-sm ${i < flow.magnitude
                ? isInflow ? 'bg-green-500' : 'bg-red-500'
                : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {flow.topMovers.map((m) => (
          <Link
            key={m.ticker}
            href={`/company/${m.ticker}`}
            className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded flex items-center gap-0.5 ${
              isInflow
                ? 'bg-green-100 text-green-800 hover:bg-green-200'
                : 'bg-red-100 text-red-800 hover:bg-red-200'
            } transition-colors`}
          >
            {m.action} {m.ticker}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Narrative Card ────────────────────────────────────────────────────────────
function NarrativeCard({ n, t }: { n: MacroNarrative; t: ReturnType<typeof useTranslations<'intelligence'>> }) {
  return (
    <div className={`cf-card p-5 border ${n.color.split(' ').filter(c => c.startsWith('border')).join(' ')} hover:shadow-md transition-shadow`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`flex-shrink-0 p-2 rounded-lg ${n.color}`}>
          {iconMap[n.icon] ?? <Brain className="w-5 h-5" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${categoryColorMap[n.category]}`}>
              {categoryLabel(n.category, t)}
            </span>
          </div>
          <h3 className="text-base font-heading font-bold text-cf-text-primary leading-tight">{n.title}</h3>
          <p className="text-xs text-cf-text-secondary mt-0.5">{n.titleKo}</p>
        </div>
      </div>
      <p className="text-sm text-cf-text-secondary leading-relaxed mb-3">{n.summary}</p>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {n.keyConceptsEn.slice(0, 4).map((kc) => (
          <span key={kc} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Tag className="w-2.5 h-2.5" />{kc}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {n.relatedTickers.slice(0, 5).map((tk) => (
          <Link key={tk} href={`/company/${tk}`}
            className="text-[10px] font-mono font-bold text-cf-primary bg-cf-primary/10 px-2 py-0.5 rounded hover:bg-cf-primary/20 transition-colors">
            {tk}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-3 border-t border-cf-border">
        {n.blogSlug ? (
          <Link href={`/blog/${n.blogSlug}`} className="flex items-center gap-1.5 text-xs font-medium text-cf-primary hover:underline">
            <BookOpen className="w-3.5 h-3.5" />
            {t('readDeepDive')}
            <ArrowRight className="w-3 h-3" />
          </Link>
        ) : (
          <span className="text-xs text-cf-text-secondary/50 italic">{t('learnMore')}</span>
        )}
      </div>
    </div>
  );
}

// ── AI Chat ───────────────────────────────────────────────────────────────────
interface Message { role: 'user' | 'assistant'; content: string; }

function AiChat({ t }: { t: ReturnType<typeof useTranslations<'intelligence'>> }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Only scroll on new messages, not on initial mount
  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const narrativeContext = macroNarratives
        .map((n) => `${n.title}: ${n.summary}`)
        .join('\n');
      const flowContext = moneyFlowSectors
        .map((f) => `${f.direction === 'inflow' ? 'INFLOW' : 'OUTFLOW'} — ${f.sector}: ${f.reason}`)
        .join('\n');
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `You are Flowvium Macro Intelligence. You understand hidden structural forces: regulatory capture, Cantillon effect, dark pools, revolving door, military-industrial complex, sovereign wealth, crisis-as-wealth-transfer.

Current macro narratives:
${narrativeContext}

Current institutional money flows (today):
${flowContext}

User question: ${text}

Answer concisely (3–5 paragraphs). Be specific — name tickers, mechanisms, and investment implications. No generic platitudes.`,
          type: 'macro_intelligence',
        }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', content: data.analysis }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Analysis temporarily unavailable. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="cf-card overflow-hidden">
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-6 py-4 flex items-center gap-3">
        <Brain className="w-5 h-5 text-amber-400" />
        <span className="text-white font-heading font-bold">{t('askQuestion')}</span>
        <span className="ml-auto text-xs text-slate-400">Powered by Gemini 2.5</span>
      </div>
      <div className="p-4 space-y-4 min-h-[100px] max-h-[360px] overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-cf-text-secondary text-center py-6 italic">{t('askPlaceholder')}</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-cf-primary text-white rounded-br-sm'
                : 'bg-gray-50 text-cf-text-primary border border-cf-border rounded-bl-sm'
            }`}>{msg.content}</div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-50 border border-cf-border rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2 text-sm text-cf-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin" />{t('analyzing')}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="px-4 pb-4 border-t border-cf-border pt-3">
        <div className="flex gap-2 items-end">
          <textarea
            value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={t('askPlaceholder')} rows={2}
            className="flex-1 resize-none rounded-xl border border-cf-border bg-gray-50 px-4 py-3 text-sm text-cf-text-primary placeholder:text-cf-text-secondary/60 focus:outline-none focus:border-cf-primary focus:bg-white transition-colors"
          />
          <button onClick={sendMessage} disabled={!input.trim() || loading}
            className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-cf-primary text-white disabled:opacity-40 hover:bg-cf-primary/90 transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Flow Intensity + Cascade Panel ───────────────────────────────────────────
// Cascade rules: asset/country → what it implies for other assets/sectors
const CASCADE_RULES: Record<string, { up: string[]; down: string[] }> = {
  // Country inflows
  '미국':   { up: ['기술주(QQQ)', 'S&P500(SPY)', '달러(UUP)'], down: ['EM주식', '채권(TLT)'] },
  '한국':   { up: ['반도체(SOXX)', 'HBM·AI메모리', 'KOSPI'], down: ['엔화(FXY)'] },
  '중국':   { up: ['원자재(DJP)', '구리', '철광석', 'EM ETF'], down: ['달러(UUP)', '미국 제조주'] },
  '인도':   { up: ['IT서비스주', 'EM채권', '인프라·시멘트'], down: [] },
  '대만':   { up: ['반도체(SOXX)', 'TSMC 공급망', 'AI가속기'], down: [] },
  '유럽':   { up: ['방산(ITA)', '유로화', '명품·소비주'], down: ['에너지주(XLE)'] },
  '일본':   { up: ['자동차·수출주', '닛케이'], down: ['엔화 캐리청산 리스크'] },
  '브라질': { up: ['철광석', '대두·농산물(DBA)', '원유'], down: [] },
  // Asset inflows
  '금':     { up: ['은(SLV)', '귀금속 채굴주', '인플레 헤지'], down: ['달러(UUP)', '단기채(SHY)'] },
  '미 장기채': { up: ['부동산(VNQ)', '배당주', '유틸리티'], down: ['달러', '은행주(XLF)'] },
  '비트코인': { up: ['암호화폐 관련주', '위험선호', '기술주'], down: ['금', '채권'] },
  '원유':   { up: ['에너지주(XLE)', '산유국 통화', '인플레'], down: ['항공·해운주', '소비재'] },
  '미국 테크': { up: ['AI 인프라', 'Mag7', '데이터센터REIT'], down: ['전통금융', '에너지'] },
  '달러':   { up: ['단기채(SHY)', '미국채'], down: ['금', 'EM주식', '원자재'] },
  '에너지': { up: ['원유', '가스', '배당주'], down: ['항공·물류', '소비재'] },
};

function FlowIntensityPanel({ data }: { data: FlowData }) {
  const [activeView, setActiveView] = useState<'compare' | 'cascade'>('compare');

  // Build comparison across all 3 timeframes
  const allItems = [
    ...data.assets.map(a => ({ id: a.id, label: a.label, flag: a.flag, type: 'asset' as const, ret1w: a.ret1w, ret4w: a.ret4w, ret13w: a.ret13w })),
    ...data.countryFlow.countries.map(c => ({ id: c.id, label: c.label, flag: c.flag, type: 'country' as const, ret1w: c.ret1w, ret4w: c.ret4w, ret13w: c.ret13w })),
  ];

  // Top movers per timeframe
  const top4 = (key: 'ret1w' | 'ret4w' | 'ret13w', dir: 'up' | 'down') =>
    [...allItems].sort((a, b) => dir === 'up' ? b[key] - a[key] : a[key] - b[key]).slice(0, 4);

  // Detect "timeframe divergence" — 1w vs 13w trend reversal
  const divergent = allItems.filter(a => Math.sign(a.ret1w) !== Math.sign(a.ret13w) && Math.abs(a.ret1w) > 1.5 && Math.abs(a.ret13w) > 1.5);

  // Build cascade from top inflows
  const topInflowItems = [...allItems].sort((a, b) => b.ret4w - a.ret4w).slice(0, 5);
  const cascadeChains = topInflowItems
    .filter(item => CASCADE_RULES[item.label])
    .map(item => {
      const rule = CASCADE_RULES[item.label]!;
      return { item, up: rule.up, down: rule.down };
    });

  const TF_COLS: Array<{ key: 'ret1w' | 'ret4w' | 'ret13w'; label: string; color: string }> = [
    { key: 'ret1w',  label: '1주',  color: 'bg-blue-400' },
    { key: 'ret4w',  label: '4주',  color: 'bg-cf-primary' },
    { key: 'ret13w', label: '13주', color: 'bg-purple-500' },
  ];

  return (
    <div className="cf-card overflow-hidden">
      <div className="p-4 border-b border-cf-border">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-cf-primary" />
            <span className="text-sm font-bold text-cf-text-primary">수급 강도 & Cascade 영향</span>
          </div>
          <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
            <button onClick={() => setActiveView('compare')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${activeView === 'compare' ? 'bg-white text-cf-primary shadow-sm' : 'text-cf-text-secondary'}`}>
              1w·4w·13w 비교
            </button>
            <button onClick={() => setActiveView('cascade')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${activeView === 'cascade' ? 'bg-white text-cf-primary shadow-sm' : 'text-cf-text-secondary'}`}>
              Cascade 연쇄
            </button>
          </div>
        </div>
      </div>

      {activeView === 'compare' && (
        <div className="p-4 space-y-4">
          {/* Top inflow comparison */}
          <div>
            <p className="text-xs font-bold text-green-700 mb-2 flex items-center gap-1.5">
              <ArrowUpRight className="w-3.5 h-3.5" /> 수급 유입 상위 (기간별)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-cf-text-secondary">
                    <th className="text-left pb-1.5 font-medium">자산/국가</th>
                    {TF_COLS.map(c => <th key={c.key} className="text-right pb-1.5 font-medium w-14">{c.label}</th>)}
                    <th className="text-right pb-1.5 font-medium w-16">방향성</th>
                  </tr>
                </thead>
                <tbody>
                  {top4('ret4w', 'up').map(item => {
                    const trend = item.ret1w > item.ret4w ? '가속▲' : item.ret1w < 0 ? '반전⚡' : '유지→';
                    const trendColor = item.ret1w > item.ret4w ? 'text-green-600' : item.ret1w < 0 ? 'text-amber-600' : 'text-gray-400';
                    return (
                      <tr key={item.id} className="border-t border-cf-border/40">
                        <td className="py-1.5 flex items-center gap-1.5">
                          <span>{item.flag}</span>
                          <span className="font-medium text-cf-text-primary">{item.label}</span>
                        </td>
                        {TF_COLS.map(c => (
                          <td key={c.key} className={`text-right py-1.5 font-bold tabular-nums ${item[c.key] >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {item[c.key] > 0 ? '+' : ''}{item[c.key].toFixed(1)}%
                          </td>
                        ))}
                        <td className={`text-right py-1.5 text-[10px] font-bold ${trendColor}`}>{trend}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top outflow comparison */}
          <div>
            <p className="text-xs font-bold text-red-600 mb-2 flex items-center gap-1.5">
              <ArrowDownRight className="w-3.5 h-3.5" /> 수급 유출 상위 (기간별)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-cf-text-secondary">
                    <th className="text-left pb-1.5 font-medium">자산/국가</th>
                    {TF_COLS.map(c => <th key={c.key} className="text-right pb-1.5 font-medium w-14">{c.label}</th>)}
                    <th className="text-right pb-1.5 font-medium w-16">방향성</th>
                  </tr>
                </thead>
                <tbody>
                  {top4('ret4w', 'down').map(item => {
                    const trend = item.ret1w < item.ret4w ? '가속▼' : item.ret1w > 0 ? '반전⚡' : '유지→';
                    const trendColor = item.ret1w < item.ret4w ? 'text-red-600' : item.ret1w > 0 ? 'text-amber-600' : 'text-gray-400';
                    return (
                      <tr key={item.id} className="border-t border-cf-border/40">
                        <td className="py-1.5 flex items-center gap-1.5">
                          <span>{item.flag}</span>
                          <span className="font-medium text-cf-text-primary">{item.label}</span>
                        </td>
                        {TF_COLS.map(c => (
                          <td key={c.key} className={`text-right py-1.5 font-bold tabular-nums ${item[c.key] >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {item[c.key] > 0 ? '+' : ''}{item[c.key].toFixed(1)}%
                          </td>
                        ))}
                        <td className={`text-right py-1.5 text-[10px] font-bold ${trendColor}`}>{trend}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Trend reversal alerts */}
          {divergent.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
              <p className="text-[10px] font-bold text-amber-700 mb-2 flex items-center gap-1">
                ⚡ 추세 전환 감지 — 1주 vs 13주 방향 불일치
              </p>
              <div className="flex flex-wrap gap-1.5">
                {divergent.slice(0, 6).map(item => (
                  <div key={item.id} className="flex items-center gap-1.5 bg-white border border-amber-200 rounded-lg px-2 py-1">
                    <span className="text-sm leading-none">{item.flag}</span>
                    <span className="text-[10px] font-bold text-cf-text-primary">{item.label}</span>
                    <span className={`text-[10px] font-bold ${item.ret1w >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      1w {item.ret1w > 0 ? '+' : ''}{item.ret1w.toFixed(1)}%
                    </span>
                    <span className="text-gray-300">vs</span>
                    <span className={`text-[10px] font-bold ${item.ret13w >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      13w {item.ret13w > 0 ? '+' : ''}{item.ret13w.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeView === 'cascade' && (
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-cf-text-secondary">4주 기준 상위 유입 자산/국가의 연쇄 영향</p>
          {cascadeChains.length > 0 ? cascadeChains.map(({ item, up, down }) => (
            <div key={item.id} className="rounded-xl border border-cf-border overflow-hidden">
              {/* Source */}
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border-b border-green-100">
                <span className="text-base leading-none">{item.flag}</span>
                <span className="text-xs font-bold text-green-700">{item.label}</span>
                <span className="text-xs font-bold text-green-600 ml-auto tabular-nums">
                  4w {item.ret4w > 0 ? '+' : ''}{item.ret4w.toFixed(1)}%
                </span>
                <span className={`text-[10px] tabular-nums ${item.ret1w >= 0 ? 'text-green-500' : 'text-orange-500'}`}>
                  1w {item.ret1w > 0 ? '+' : ''}{item.ret1w.toFixed(1)}%
                </span>
              </div>
              {/* Cascade */}
              <div className="px-3 py-2 flex gap-4">
                {up.length > 0 && (
                  <div className="flex-1">
                    <p className="text-[9px] font-bold text-green-600 uppercase tracking-wide mb-1">수혜 ↑</p>
                    <div className="space-y-0.5">
                      {up.map((u, i) => (
                        <div key={i} className="flex items-center gap-1 text-[11px] text-green-700">
                          <span className="text-green-400 font-bold">+</span>{u}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {down.length > 0 && (
                  <div className="flex-1">
                    <p className="text-[9px] font-bold text-red-500 uppercase tracking-wide mb-1">피해 ↓</p>
                    <div className="space-y-0.5">
                      {down.map((d, i) => (
                        <div key={i} className="flex items-center gap-1 text-[11px] text-red-600">
                          <span className="text-red-400 font-bold">−</span>{d}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )) : (
            <p className="text-xs text-cf-text-secondary text-center py-4">Cascade 데이터를 구성 중입니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Capital Flows Component ──────────────────────────────────────────────────
interface AssetReturn { id: string; label: string; flag: string; group: string; ticker: string; ret1w: number; ret4w: number; ret13w: number; }
interface CountryReturn { id: string; label: string; flag: string; ticker: string; ret1w: number; ret4w: number; ret13w: number; }
interface FactorReturn { id: string; label: string; flag: string; ticker: string; desc: string; ret1w: number; ret4w: number; ret13w: number; }
interface SectorReturn { id: string; label: string; flag: string; ticker: string; ret1w: number; ret4w: number; ret13w: number; }
type RotEntry = { from:string; to:string; magnitude:number; weeksAgo?:number; startDate?:string; momentum?:string };
type CountryRotEntry = { from:string; fromFlag:string; to:string; toFlag:string; magnitude:number; momentum:'accelerating'|'holding'|'fading' };
interface CurvePoint { ticker: string; label: string; price: number; }
interface CommodityCurveData { id: 'oil'|'gold'; name: string; unit: string; curve: CurvePoint[]; structure: 'contango'|'backwardation'|'flat'; slope: number; updatedAt: string; }
interface FlowData {
  assets: AssetReturn[];
  flow: {
    topInflows: AssetReturn[]; topOutflows: AssetReturn[];
    groupAvg: {group:string;avg4w:number}[];
    rotations1w: RotEntry[]; rotations4w: RotEntry[]; rotations13w: RotEntry[];
  };
  goldVsDollar: {
    goldRet1w:number; dollarRet1w:number; signal1w:string;
    goldRet4w:number; dollarRet4w:number; signal4w:string;
    goldRet13w:number; dollarRet13w:number; signal13w:string;
  };
  countryFlow: {
    countries: CountryReturn[];
    rotations1w: CountryRotEntry[]; rotations4w: CountryRotEntry[]; rotations13w: CountryRotEntry[];
  };
  factorPerformance?: FactorReturn[];
  sectorPerformance?: SectorReturn[];
  dataSource?: string;
  updatedAt: string;
}

const GROUP_LABELS: Record<string, string> = { equity: '주식', bonds: '채권', alts: '대안자산', commodities: '원자재', currency: '통화' };
const GROUP_COLORS: Record<string, string> = { equity: 'bg-blue-500', bonds: 'bg-amber-500', alts: 'bg-yellow-400', commodities: 'bg-orange-500', currency: 'bg-purple-500' };
const GROUP_LIGHT: Record<string, string> = { equity: 'bg-blue-50 text-blue-700 border-blue-200', bonds: 'bg-amber-50 text-amber-700 border-amber-200', alts: 'bg-yellow-50 text-yellow-700 border-yellow-200', commodities: 'bg-orange-50 text-orange-700 border-orange-200', currency: 'bg-purple-50 text-purple-700 border-purple-200' };

function ReturnBar({ val, max }: { val: number; max: number }) {
  const pct = Math.min(Math.abs(val) / max * 100, 100);
  const positive = val >= 0;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="w-24 bg-gray-100 rounded-full h-2 overflow-hidden flex-shrink-0">
        <div
          className={`h-2 rounded-full ${positive ? 'bg-green-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%`, marginLeft: positive ? 0 : 'auto' }}
        />
      </div>
      <span className={`text-xs font-bold tabular-nums ${positive ? 'text-green-600' : 'text-red-500'}`}>
        {val > 0 ? '+' : ''}{val.toFixed(1)}%
      </span>
    </div>
  );
}

type Timeframe = '1w' | '4w' | '13w';
const TF_LABELS: Record<Timeframe, string> = { '1w': '1주', '4w': '4주', '13w': '3개월' };
const TF_RET_KEY: Record<Timeframe, 'ret1w' | 'ret4w' | 'ret13w'> = { '1w': 'ret1w', '4w': 'ret4w', '13w': 'ret13w' };

// ── Flow Analysis Panel (EXAONE 자금흐름 원인 분석) ──────────────────────────
interface FlowCause {
  country: string; ret: string; direction: string;
  causes: string[]; risk: string;
}
interface RotationCause { from: string; to: string; reason: string; }
interface FlowAnalysis {
  summary: string; mainTheme: string;
  countries: FlowCause[]; rotations: RotationCause[];
  keyWatchpoints: string[];
}

function FlowAnalysisPanel({ tf }: { tf: Timeframe }) {
  const t = useTranslations('intelligence');
  const [analysis, setAnalysis] = useState<FlowAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [genTime, setGenTime] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(false);
    fetch(`/api/flow-analysis?tf=${tf}`)
      .then(r => r.json())
      .then(d => {
        setAnalysis(d.analysis ?? null);
        setGenTime(d.generatedAt ?? null);
        setLoaded(true);
        if (!d.analysis) setError(true);
      })
      .catch(() => { setError(true); setLoaded(true); })
      .finally(() => setLoading(false));
  };

  // Reset when timeframe changes
  useEffect(() => { setLoaded(false); setAnalysis(null); setError(false); }, [tf]);

  if (!loaded && !loading) {
    return (
      <div className="cf-card p-4 border-dashed border-cf-primary/30 bg-cf-primary/3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-cf-primary/10 flex items-center justify-center text-base flex-shrink-0">🤖</div>
            <div>
              <p className="text-sm font-bold text-cf-text-primary">AI 자금흐름 원인 분석</p>
              <p className="text-xs text-cf-text-secondary">EXAONE이 각 국가의 자금흐름 원인과 로테이션 이유를 분석합니다</p>
            </div>
          </div>
          <button
            onClick={load}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-cf-primary text-white rounded-xl text-xs font-bold hover:bg-cf-primary/90 transition-colors shadow-sm"
          >
            <Zap className="w-3.5 h-3.5" />
            원인 분석 시작
          </button>
        </div>
      </div>
    );
  }

  if (loading) return (
    <div className="cf-card p-6 flex items-center justify-center gap-3 text-cf-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin text-cf-primary" />
      <div>
        <p className="text-sm font-medium">EXAONE이 자금흐름 원인 분석 중...</p>
        <p className="text-xs text-cf-text-secondary/70 mt-0.5">국가별 ETF 수익률과 글로벌 이벤트 데이터를 분석하고 있어요</p>
      </div>
    </div>
  );

  if (error || !analysis) return (
    <div className="cf-card p-4 text-center">
      <p className="text-xs text-cf-text-secondary mb-2">분석을 불러오지 못했습니다. AI 서버 연결을 확인해주세요.</p>
      <button onClick={load} className="text-xs text-cf-primary hover:underline">다시 시도</button>
    </div>
  );

  return (
    <div className="cf-card overflow-hidden">
      {/* Header */}
      <div className="p-4 pb-3 border-b border-cf-border bg-gradient-to-r from-cf-primary/5 to-transparent">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-cf-primary/10 flex items-center justify-center text-sm flex-shrink-0">🤖</div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-cf-text-primary">AI 자금흐름 원인 분석</span>
                <span className="text-[10px] bg-cf-primary/10 text-cf-primary px-2 py-0.5 rounded-full font-semibold">EXAONE</span>
              </div>
              {genTime && (
                <p className="text-[10px] text-cf-text-secondary mt-0.5">
                  {new Date(genTime).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 생성 · 4시간 캐시
                </p>
              )}
            </div>
          </div>
          <button onClick={load} className="flex-shrink-0 flex items-center gap-1 text-[11px] text-cf-text-secondary hover:text-cf-primary transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> {t('refresh')}
          </button>
        </div>
        {/* Main theme badge */}
        {analysis.mainTheme && (
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200">
            <span className="text-amber-500">⚡</span>
            <span className="text-xs font-bold text-amber-700">현재 핵심 테마: {analysis.mainTheme}</span>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Summary */}
        <div className="p-3 rounded-xl bg-blue-50 border border-blue-100">
          <p className="text-xs font-bold text-blue-700 mb-1">📋 전체 요약</p>
          <p className="text-xs text-blue-700 leading-relaxed">{analysis.summary}</p>
        </div>

        {/* Country causes */}
        {analysis.countries && analysis.countries.length > 0 && (
          <div>
            <p className="text-xs font-bold text-cf-text-primary mb-2 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-cf-primary" /> 국가별 원인 분석
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {analysis.countries.map((c, i) => (
                <div key={i} className={`p-3 rounded-xl border text-xs ${
                  c.direction === 'inflow' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`font-bold ${c.direction === 'inflow' ? 'text-green-700' : 'text-red-700'}`}>
                      {c.direction === 'inflow' ? '↑' : '↓'} {c.country}
                    </span>
                    <span className={`font-bold tabular-nums ${c.direction === 'inflow' ? 'text-green-600' : 'text-red-600'}`}>{c.ret}</span>
                  </div>
                  <ul className="space-y-0.5 mb-1.5">
                    {c.causes?.map((cause, j) => (
                      <li key={j} className={`flex items-start gap-1 ${c.direction === 'inflow' ? 'text-green-700' : 'text-red-700'}`}>
                        <span className="flex-shrink-0 mt-0.5">•</span>
                        <span className="leading-snug">{cause}</span>
                      </li>
                    ))}
                  </ul>
                  {c.risk && (
                    <div className="flex items-start gap-1 text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
                      <span className="flex-shrink-0">⚠</span>
                      <span className="leading-snug">{c.risk}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rotation causes */}
        {analysis.rotations && analysis.rotations.length > 0 && (
          <div>
            <p className="text-xs font-bold text-cf-text-primary mb-2 flex items-center gap-1.5">
              <ArrowRight className="w-3.5 h-3.5 text-cf-primary" /> 로테이션 원인
            </p>
            <div className="space-y-1.5">
              {analysis.rotations.map((r, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-xl bg-violet-50 border border-violet-100 text-xs">
                  <div className="flex items-center gap-1 flex-shrink-0 font-bold text-violet-700 min-w-[100px]">
                    <span>{r.from}</span>
                    <ArrowRight className="w-3 h-3" />
                    <span>{r.to}</span>
                  </div>
                  <span className="text-violet-700 leading-snug">{r.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Key watchpoints */}
        {analysis.keyWatchpoints && analysis.keyWatchpoints.length > 0 && (
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-xs font-bold text-slate-700 mb-2">👀 지금 주목해야 할 포인트</p>
            <ul className="space-y-1">
              {analysis.keyWatchpoints.map((pt, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                  <span className="font-bold text-slate-400 flex-shrink-0">{i + 1}.</span>
                  <span className="leading-snug">{pt}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function CapitalFlowsTab() {
  const t = useTranslations('intelligence');
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tf, setTf] = useState<Timeframe>('4w');
  const [commCurves, setCommCurves] = useState<CommodityCurveData[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.allSettled([
      fetch('/api/capital-flows', { signal }).then(r => r.json()),
      fetch('/api/commodity-curve', { signal }).then(r => r.json()),
    ]).then(([flowRes, curveRes]) => {
      if (signal.aborted) return;
      if (flowRes.status === 'fulfilled') setData(flowRes.value);
      if (curveRes.status === 'fulfilled') setCommCurves(curveRes.value.curves ?? null);
    }).finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-cf-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">글로벌 자금흐름 분석 중...</span>
    </div>
  );
  if (!data) return <p className="text-center text-cf-text-secondary py-8 text-sm">데이터를 불러올 수 없습니다</p>;

  const retKey = TF_RET_KEY[tf];
  const maxAbs = Math.max(...data.assets.map((a) => Math.abs(a[retKey])), 1);
  const activeRotations = tf === '1w' ? data.flow.rotations1w : tf === '13w' ? data.flow.rotations13w : data.flow.rotations4w;

  return (
    <div className="space-y-6">
      {/* Timeframe toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-cf-text-secondary font-medium">기준:</span>
        <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
          {(['1w', '4w', '13w'] as Timeframe[]).map((t) => (
            <button key={t} onClick={() => setTf(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${tf === t ? 'bg-white text-cf-primary shadow-sm' : 'text-cf-text-secondary hover:text-cf-text-primary'}`}>
              {TF_LABELS[t]}
            </button>
          ))}
        </div>
        {data.dataSource && <span className="ml-auto text-[11px] text-cf-text-secondary">{data.dataSource}</span>}
      </div>

      {/* 주요 로테이션 */}
      {activeRotations.length > 0 && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-cf-primary" />
            자금 로테이션 ({TF_LABELS[tf]} 기준)
          </h3>
          <div className="space-y-3">
            {activeRotations.map((r, i) => {
              const momentumBadge = r.momentum === 'accelerating'
                ? { label: t('accelerating'), cls: 'bg-amber-100 text-amber-700' }
                : r.momentum === 'fading'
                ? { label: t('weakening'), cls: 'bg-gray-100 text-gray-500' }
                : { label: t('maintaining'), cls: 'bg-slate-100 text-slate-600' };
              return (
                <div key={i} className="p-3 rounded-lg bg-cf-bg border border-cf-border space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-red-500 bg-red-50 px-2.5 py-1 rounded-full">{r.from}</span>
                    <ArrowRight className="w-4 h-4 text-cf-primary flex-shrink-0" />
                    <span className="text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full">{r.to}</span>
                    <span className="ml-auto text-sm font-extrabold text-cf-primary">+{r.magnitude}%p</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.startDate && (
                      <span className="text-[11px] text-cf-text-secondary flex items-center gap-1">
                        🕐 {r.weeksAgo === 1 ? '이번 주 시작' : `${r.weeksAgo}주 전 시작`} ({r.startDate})
                      </span>
                    )}
                    {r.momentum && (
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${momentumBadge.cls}`}>
                        {momentumBadge.label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 국가별 시장 자금 흐름 */}
      {data.countryFlow && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
            <Globe className="w-4 h-4 text-cf-primary" />
            국가별 시장 자금 흐름 ({TF_LABELS[tf]} 기준)
          </h3>

          {/* Country rotation arrows */}
          {(() => {
            const cr = tf === '1w' ? data.countryFlow.rotations1w : tf === '13w' ? data.countryFlow.rotations13w : data.countryFlow.rotations4w;
            return cr.length > 0 ? (
              <div className="space-y-2 mb-4">
                {cr.map((r, i) => {
                  const mb = r.momentum === 'accelerating'
                    ? { label: t('accelerating'), cls: 'bg-amber-100 text-amber-700' }
                    : r.momentum === 'fading'
                    ? { label: t('weakening'), cls: 'bg-gray-100 text-gray-500' }
                    : { label: t('maintaining'), cls: 'bg-slate-100 text-slate-600' };
                  return (
                    <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-cf-bg border border-cf-border">
                      <span className="text-base leading-none flex-shrink-0">{r.fromFlag}</span>
                      <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">{r.from}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-cf-primary flex-shrink-0" />
                      <span className="text-base leading-none flex-shrink-0">{r.toFlag}</span>
                      <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">{r.to}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-1 ${mb.cls}`}>{mb.label}</span>
                      <span className="ml-auto text-sm font-extrabold text-cf-primary">+{r.magnitude}%p</span>
                    </div>
                  );
                })}
              </div>
            ) : null;
          })()}

          {/* Country returns grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[...data.countryFlow.countries]
              .sort((a, b) => b[retKey] - a[retKey])
              .map((c) => {
                const val = c[retKey];
                const positive = val >= 0;
                return (
                  <div key={c.id} className={`rounded-lg border p-2.5 ${positive ? 'border-green-200 bg-green-50/40' : 'border-red-200 bg-red-50/40'}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-base leading-none">{c.flag}</span>
                      <span className="text-xs font-bold text-cf-text-primary">{c.label}</span>
                    </div>
                    <div className={`text-base font-extrabold tabular-nums ${positive ? 'text-green-600' : 'text-red-500'}`}>
                      {val > 0 ? '+' : ''}{val.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono">{c.ticker}</div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 스마트베타 팩터 성과 */}
      {data.factorPerformance && data.factorPerformance.length > 0 && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
            <span>🧮</span> 스마트베타 팩터 성과 ({TF_LABELS[tf]} 기준)
          </h3>
          {(() => {
            const sorted = [...data.factorPerformance].sort((a, b) => b[retKey] - a[retKey]);
            const maxAbs = Math.max(...sorted.map(f => Math.abs(f[retKey])), 1);
            return (
              <div className="space-y-2">
                {sorted.map((f) => {
                  const val = f[retKey];
                  return (
                    <div key={f.id} className="flex items-center gap-3">
                      <span className="text-base leading-none flex-shrink-0">{f.flag}</span>
                      <span className="text-xs font-bold text-cf-text-primary w-16 flex-shrink-0">{f.label}</span>
                      <span className="text-[10px] text-gray-400 font-mono w-10 flex-shrink-0">{f.ticker}</span>
                      <ReturnBar val={val} max={maxAbs} />
                    </div>
                  );
                })}
                <p className="text-[10px] text-cf-text-secondary/60 pt-1">
                  MTUM · QUAL · VLUE · USMV · IVW · IVE — iShares/MSCI 팩터 ETF 기반
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {/* 미국 섹터 성과 */}
      {data.sectorPerformance && data.sectorPerformance.length > 0 && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
            <span>🏭</span> 미국 섹터 로테이션 ({TF_LABELS[tf]} 기준)
          </h3>
          {(() => {
            const sorted = [...data.sectorPerformance].sort((a, b) => b[retKey] - a[retKey]);
            const maxAbs = Math.max(...sorted.map(s => Math.abs(s[retKey])), 1);
            const best = sorted[0];
            const worst = sorted[sorted.length - 1];
            return (
              <>
                {(best && worst) && (
                  <div className="flex gap-2 mb-3">
                    <div className="flex-1 p-2 rounded-lg bg-green-50 border border-green-200 text-center">
                      <div className="text-base">{best.flag}</div>
                      <div className="text-xs font-bold text-green-700">{best.label}</div>
                      <div className="text-sm font-extrabold text-green-600">+{best[retKey].toFixed(1)}%</div>
                    </div>
                    <div className="flex items-center text-xs text-gray-400">→</div>
                    <div className="flex-1 p-2 rounded-lg bg-red-50 border border-red-200 text-center">
                      <div className="text-base">{worst.flag}</div>
                      <div className="text-xs font-bold text-red-700">{worst.label}</div>
                      <div className="text-sm font-extrabold text-red-500">{worst[retKey].toFixed(1)}%</div>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  {sorted.map((s) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <span className="text-sm leading-none flex-shrink-0">{s.flag}</span>
                      <span className="text-xs font-medium text-cf-text-primary w-16 flex-shrink-0 truncate">{s.label}</span>
                      <span className="text-[10px] text-gray-400 font-mono w-10 flex-shrink-0">{s.ticker}</span>
                      <ReturnBar val={s[retKey]} max={maxAbs} />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-cf-text-secondary/60 pt-1">
                  SPDR Sector ETFs (XLK·XLF·XLE·XLV·XLI·XLB·XLY·XLP·XLU·XLRE·XLC)
                </p>
              </>
            );
          })()}
        </div>
      )}

      {/* 금 vs 달러 */}
      {(() => {
        const gvd = data.goldVsDollar;
        const goldRet = tf === '1w' ? gvd.goldRet1w : tf === '13w' ? gvd.goldRet13w : gvd.goldRet4w;
        const dollarRet = tf === '1w' ? gvd.dollarRet1w : tf === '13w' ? gvd.dollarRet13w : gvd.dollarRet4w;
        const signal = tf === '1w' ? gvd.signal1w : tf === '13w' ? gvd.signal13w : gvd.signal4w;
        return (
          <div className="cf-card p-4">
            <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
              <span>⚖️</span> 금 vs 달러 ({TF_LABELS[tf]} 기준)
            </h3>
            <div className="flex gap-4 mb-3">
              <div className="flex-1 text-center p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                <div className="text-2xl mb-1">🥇</div>
                <div className={`text-xl font-extrabold ${goldRet >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {goldRet > 0 ? '+' : ''}{goldRet.toFixed(1)}%
                </div>
                <div className="text-[11px] text-gray-500">금 ({TF_LABELS[tf]})</div>
              </div>
              <div className="flex items-center text-gray-400 font-bold">vs</div>
              <div className="flex-1 text-center p-3 rounded-lg bg-blue-50 border border-blue-200">
                <div className="text-2xl mb-1">💵</div>
                <div className={`text-xl font-extrabold ${dollarRet >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {dollarRet > 0 ? '+' : ''}{dollarRet.toFixed(1)}%
                </div>
                <div className="text-[11px] text-gray-500">달러 ({TF_LABELS[tf]})</div>
              </div>
            </div>
            <div className="text-center text-xs font-semibold text-cf-primary bg-cf-primary/5 rounded-lg py-2 px-3">
              📌 {signal}
            </div>
          </div>
        );
      })()}

      {/* 원자재 선물 커브 (컨탱고/백워데이션) */}
      {commCurves && commCurves.length > 0 && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
            <span>🛢️</span> 원자재 선물 커브 — 컨탱고 / 백워데이션
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {commCurves.map((c) => {
              const structColor = c.structure === 'contango' ? 'text-blue-600 bg-blue-50 border-blue-200'
                : c.structure === 'backwardation' ? 'text-orange-600 bg-orange-50 border-orange-200'
                : 'text-gray-600 bg-gray-50 border-gray-200';
              const structLabel = c.structure === 'contango' ? '컨탱고 (정상상승)' : c.structure === 'backwardation' ? '백워데이션 (공급부족)' : '플랫';
              const maxP = Math.max(...c.curve.map(p => p.price));
              const minP = Math.min(...c.curve.map(p => p.price));
              const range = maxP - minP || 1;
              return (
                <div key={c.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-cf-text-primary">{c.name}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${structColor}`}>
                      {structLabel} {c.slope > 0 ? '+' : ''}{c.slope.toFixed(1)}%
                    </span>
                  </div>
                  {c.curve.length > 0 && (
                    <div className="flex items-end gap-1 h-12">
                      {c.curve.map((pt) => {
                        const h = ((pt.price - minP) / range * 36 + 12);
                        const isFirst = pt === c.curve[0];
                        return (
                          <div key={pt.ticker} className="flex flex-col items-center flex-1 min-w-0">
                            <div
                              className={`w-full rounded-t-sm ${isFirst ? 'bg-cf-primary' : c.structure === 'contango' ? 'bg-blue-400' : 'bg-orange-400'}`}
                              style={{ height: `${h}px` }}
                              title={`${pt.label}: ${c.unit.startsWith('USD/bbl') ? '$' : '$'}${pt.price.toFixed(2)} ${c.unit}`}
                            />
                            <span className="text-[8px] text-cf-text-secondary mt-0.5 truncate w-full text-center leading-tight">{pt.label.replace(' 2', "'")}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="text-[10px] text-cf-text-secondary">
                    {c.id === 'oil'
                      ? (c.structure === 'backwardation' ? '⚠️ 공급 타이트 — 현물 프리미엄' : '📉 공급 여유 — 선도 프리미엄')
                      : (c.structure === 'contango' ? '📈 금 보유 비용 정상 반영' : '⚠️ 금 현물 수요 급증 신호')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 자산군별 성과 */}
      <div className="cf-card p-4">
        <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-cf-primary" />
          자산군별 {TF_LABELS[tf]} 수익률 (자금 유입 방향)
        </h3>
        {(() => {
          // Compute group avg from assets for the selected timeframe
          const groupPerf: Record<string, number[]> = {};
          for (const a of data.assets) {
            if (!groupPerf[a.group]) groupPerf[a.group] = [];
            groupPerf[a.group].push(a[retKey]);
          }
          const groupAvgTf = Object.entries(groupPerf)
            .map(([group, vals]) => ({ group, avg: parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2)) }))
            .sort((a, b) => b.avg - a.avg);
          const maxG = Math.max(...groupAvgTf.map(g => Math.abs(g.avg)), 1);
          return (
            <div className="space-y-1">
              {groupAvgTf.map((g) => (
                <div key={g.group} className="flex items-center gap-3 py-2 border-b border-cf-border last:border-0">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${GROUP_LIGHT[g.group] ?? 'bg-gray-100 text-gray-600 border-gray-200'} w-20 text-center flex-shrink-0`}>
                    {GROUP_LABELS[g.group] ?? g.group}
                  </span>
                  <ReturnBar val={g.avg} max={maxG} />
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* 상위 유입/유출 개별 자산 */}
      {(() => {
        const sorted = [...data.assets].sort((a, b) => b[retKey] - a[retKey]);
        const topIn = sorted.slice(0, 5);
        const topOut = sorted.slice(-5).reverse();
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="cf-card p-4">
              <h3 className="text-sm font-bold text-green-700 mb-3 flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4" /> 자금 유입 TOP 5 ({TF_LABELS[tf]})
              </h3>
              <div className="space-y-2">
                {topIn.map((a, i) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-4 flex-shrink-0">{i + 1}</span>
                    <span className="text-base leading-none flex-shrink-0">{a.flag}</span>
                    <span className="text-xs font-medium text-cf-text-primary truncate flex-1">{a.label}</span>
                    <span className="text-xs font-bold text-green-600 flex-shrink-0">+{a[retKey].toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="cf-card p-4">
              <h3 className="text-sm font-bold text-red-600 mb-3 flex items-center gap-2">
                <ArrowDownRight className="w-4 h-4" /> 자금 이탈 TOP 5 ({TF_LABELS[tf]})
              </h3>
              <div className="space-y-2">
                {topOut.map((a, i) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-4 flex-shrink-0">{i + 1}</span>
                    <span className="text-base leading-none flex-shrink-0">{a.flag}</span>
                    <span className="text-xs font-medium text-cf-text-primary truncate flex-1">{a.label}</span>
                    <span className="text-xs font-bold text-red-500 flex-shrink-0">{a[retKey].toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 전체 테이블 */}
      <div className="cf-card p-4">
        <h3 className="text-sm font-bold text-cf-text-primary mb-3">전체 자산 수익률</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-cf-border text-cf-text-secondary">
                <th className="text-left pb-2 font-medium">자산</th>
                <th className="text-right pb-2 font-medium">1주</th>
                <th className="text-right pb-2 font-medium">4주</th>
                <th className="text-right pb-2 font-medium">13주</th>
              </tr>
            </thead>
            <tbody>
              {[...data.assets].sort((a, b) => b.ret4w - a.ret4w).map((a) => (
                <tr key={a.id} className="border-b border-cf-border/50 last:border-0">
                  <td className="py-2 flex items-center gap-1.5">
                    <span>{a.flag}</span>
                    <span className="font-medium text-cf-text-primary">{a.label}</span>
                    <span className="text-gray-400 font-mono">{a.ticker}</span>
                  </td>
                  <td className={`py-2 text-right font-bold tabular-nums ${a.ret1w >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {a.ret1w > 0 ? '+' : ''}{a.ret1w.toFixed(1)}%
                  </td>
                  <td className={`py-2 text-right font-bold tabular-nums ${a.ret4w >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {a.ret4w > 0 ? '+' : ''}{a.ret4w.toFixed(1)}%
                  </td>
                  <td className={`py-2 text-right font-bold tabular-nums ${a.ret13w >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {a.ret13w > 0 ? '+' : ''}{a.ret13w.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 수급 강도 & Cascade */}
      <FlowIntensityPanel data={data} />

      {/* AI 자금흐름 원인 분석 */}
      <FlowAnalysisPanel tf={tf} />

      <p className="text-xs text-cf-text-secondary text-center">
        Yahoo Finance (15분 지연) · ETF 기반 자산군별 수익률 분석 · 4시간 캐시
        {data.updatedAt && ` · ${new Date(data.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 업데이트`}
      </p>
    </div>
  );
}

// ── FedWatch ──────────────────────────────────────────────────────────────────
interface FomcMeeting {
  date: string; label: string;
  targetLow: number; targetHigh: number;
  probHike: number; probHold: number; probCut25: number; probCut50: number; probCut75: number;
  impliedRate: number; cumulativeCuts: number;
}
interface FedWatchData {
  currentTargetLow: number; currentTargetHigh: number; currentRateMid: number;
  meetings: FomcMeeting[];
  yearEndImpliedRate: number; totalImpliedCuts: number;
  updatedAt: string; source: string;
}

function FedWatchSection() {
  const [data, setData] = useState<FedWatchData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/fedwatch')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="cf-card p-4 flex items-center gap-2 text-cf-text-secondary">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-xs">FedWatch 로딩중...</span>
    </div>
  );
  if (!data) return null;

  const today = new Date();

  return (
    <div className="cf-card p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🏛️</span>
            <h3 className="text-sm font-bold text-cf-text-primary">CME FedWatch — FOMC 금리 전망</h3>
          </div>
          <p className="text-xs text-cf-text-secondary">각 회의별 시장이 예상하는 금리 결정 확률</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-cf-text-secondary">현재 기준금리</span>
            <span className="text-base font-extrabold text-cf-text-primary tabular-nums">
              {data.currentTargetLow}–{data.currentTargetHigh}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-cf-text-secondary">연말 예상</span>
            <span className="text-sm font-bold text-blue-600 tabular-nums">{data.yearEndImpliedRate.toFixed(2)}%</span>
            <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-semibold">
              -{data.totalImpliedCuts}bp 인하
            </span>
          </div>
        </div>
      </div>

      {/* Meeting probability bars */}
      <div className="space-y-3">
        {data.meetings.map((m) => {
          const isPast = new Date(m.date) < today;
          const isNext = !isPast && data.meetings.findIndex(x => new Date(x.date) >= today) === data.meetings.indexOf(m);
          const dominantCut = m.probCut25 + m.probCut50 + m.probCut75;

          return (
            <div key={m.date} className={`rounded-xl border p-3 ${isNext ? 'border-cf-primary/40 bg-cf-primary/5' : 'border-cf-border bg-white'} ${isPast ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                <div className="flex items-center gap-2">
                  {isNext && <span className="text-[9px] font-bold bg-cf-primary text-white px-1.5 py-0.5 rounded-full">NEXT</span>}
                  <span className="text-xs font-bold text-cf-text-primary">{m.label}</span>
                  <span className="text-[10px] text-cf-text-secondary">{m.date}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-cf-text-secondary">예상금리</span>
                  <span className="text-xs font-bold tabular-nums text-cf-text-primary">{m.impliedRate.toFixed(2)}%</span>
                  {m.cumulativeCuts > 0 && (
                    <span className="text-[10px] text-blue-600 font-semibold">-{m.cumulativeCuts}bp</span>
                  )}
                </div>
              </div>

              {/* Probability bars */}
              <div className="space-y-1">
                {/* Hold */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-16 flex-shrink-0">동결</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gray-400 rounded-full transition-all"
                      style={{ width: `${m.probHold}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-gray-600 w-10 text-right tabular-nums">{m.probHold.toFixed(1)}%</span>
                </div>
                {/* Cut 25bp */}
                {m.probCut25 > 0.5 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-blue-600 w-16 flex-shrink-0">-25bp</span>
                    <div className="flex-1 h-4 bg-blue-50 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-400 rounded-full transition-all"
                        style={{ width: `${m.probCut25}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-blue-600 w-10 text-right tabular-nums">{m.probCut25.toFixed(1)}%</span>
                  </div>
                )}
                {/* Cut 50bp */}
                {m.probCut50 > 0.5 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-indigo-600 w-16 flex-shrink-0">-50bp</span>
                    <div className="flex-1 h-4 bg-indigo-50 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-400 rounded-full transition-all"
                        style={{ width: `${m.probCut50}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-indigo-600 w-10 text-right tabular-nums">{m.probCut50.toFixed(1)}%</span>
                  </div>
                )}
                {/* Cut 75bp+ */}
                {m.probCut75 > 0.5 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-purple-600 w-16 flex-shrink-0">-75bp+</span>
                    <div className="flex-1 h-4 bg-purple-50 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-400 rounded-full transition-all"
                        style={{ width: `${m.probCut75}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-purple-600 w-10 text-right tabular-nums">{m.probCut75.toFixed(1)}%</span>
                  </div>
                )}
                {/* Hike */}
                {m.probHike > 0.5 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-red-600 w-16 flex-shrink-0">+25bp</span>
                    <div className="flex-1 h-4 bg-red-50 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-400 rounded-full transition-all"
                        style={{ width: `${m.probHike}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-red-600 w-10 text-right tabular-nums">{m.probHike.toFixed(1)}%</span>
                  </div>
                )}
              </div>

              {/* Summary label */}
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  dominantCut > 60 ? 'bg-blue-100 text-blue-700' :
                  m.probHold > 60 ? 'bg-gray-100 text-gray-600' :
                  'bg-amber-50 text-amber-700'
                }`}>
                  {dominantCut > 60 ? `인하 우세 (${dominantCut.toFixed(0)}%)` :
                   m.probHold > 60 ? `동결 우세 (${m.probHold.toFixed(0)}%)` :
                   '혼재'}
                </span>
                {m.targetLow !== data.currentTargetLow && (
                  <span className="text-[10px] text-cf-text-secondary">
                    → {m.targetLow}–{m.targetHigh}% 예상
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[10px] text-cf-text-secondary">
          💡 확률은 Fed Funds 선물 가격 기반 시장 컨센서스 (CME FedWatch 스타일)
        </p>
        <span className="text-[10px] text-gray-400">기준: {data.updatedAt}</span>
      </div>
    </div>
  );
}

// ── Macro Indicators Tab ──────────────────────────────────────────────────────
interface CascadeStep { asset: string; direction: 'up' | 'down' | 'mixed'; reason: string; magnitude: 'strong' | 'moderate' | 'weak'; }
interface MacroIndicator {
  id: string; name: string; nameKo: string; category: string;
  actual: number | null; forecast: number | null; previous: number | null; unit: string;
  releaseDate: string; nextRelease?: string;
  liveData?: boolean;
  surprise: 'beat' | 'miss' | 'inline' | 'pending';
  rateImpact: 'hawkish' | 'dovish' | 'neutral';
  rateImpactKo: string; cascade: CascadeStep[]; summary: string;
}

const SURPRISE_BADGE: Record<string, { label: string; cls: string }> = {
  beat:    { label: '예상 상회 ▲', cls: 'bg-red-50 text-red-700 border border-red-200' },
  miss:    { label: '예상 하회 ▼', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  inline:  { label: '예상 부합 →', cls: 'bg-gray-50 text-gray-600 border border-gray-200' },
  pending: { label: '발표 대기', cls: 'bg-amber-50 text-amber-600 border border-amber-200' },
};
const RATE_BADGE: Record<string, { label: string; cls: string }> = {
  hawkish: { label: '🦅 매파 (긴축)', cls: 'bg-red-100 text-red-700' },
  dovish:  { label: '🕊️ 비둘기파 (완화)', cls: 'bg-blue-100 text-blue-700' },
  neutral: { label: '⚖️ 중립', cls: 'bg-gray-100 text-gray-600' },
};
const CASCADE_COLORS: Record<string, string> = {
  up: 'text-green-600', down: 'text-red-500', mixed: 'text-amber-600',
};
const CASCADE_ICONS: Record<string, string> = { up: '▲', down: '▼', mixed: '↕' };
const MAG_OPACITY: Record<string, string> = { strong: 'opacity-100', moderate: 'opacity-70', weak: 'opacity-40' };
const CAT_LABELS: Record<string, string> = { inflation: '물가', employment: '고용', growth: '경기', monetary: '통화정책', trade: '무역' };
const CAT_COLORS: Record<string, string> = { inflation: 'bg-orange-50 text-orange-700', employment: 'bg-green-50 text-green-700', growth: 'bg-blue-50 text-blue-700', monetary: 'bg-purple-50 text-purple-700', trade: 'bg-teal-50 text-teal-700' };

interface YieldPoint { label: string; value: number | null; }
interface YieldCurve { points: YieldPoint[]; inverted: boolean; spread10y2y: number | null; }

// ── Layman explanations per indicator ────────────────────────────────────────
const LAYMAN: Record<string, { what: string; why: string; good: string; bad: string }> = {
  cpi:    { what: '마트·식당 등 우리가 매일 사는 물건들의 가격이 1년 전보다 얼마나 올랐는지 보여줍니다.', why: 'Fed(미국 중앙은행)가 금리를 올릴지 내릴지 결정하는 핵심 지표예요.', good: '예상보다 낮으면 → 물가가 안정 → 금리 인하 기대 → 주식 상승 가능성', bad: '예상보다 높으면 → 물가 과열 → 금리 인상 → 주식·채권 동반 하락 위험' },
  pce:    { what: 'CPI와 비슷하지만 Fed가 더 중요하게 보는 물가 지표예요. 사람들이 실제로 얼마나 쓰고 있는지 더 정확히 잡아냅니다.', why: 'Fed 의장이 공개적으로 "가장 선호하는 인플레 지표"라고 언급했어요.', good: '예상보다 낮으면 → 금리 인하 시기 앞당겨질 수 있음', bad: '예상보다 높으면 → 금리 인하 늦어짐 → 성장주 불리' },
  nfp:    { what: '지난 한 달 동안 미국에서 일자리가 몇 개 생겼는지 세는 지표예요. (농업 제외)', why: '일자리 = 경기의 온도계. 많이 늘면 경기 좋다는 신호. Fed도 이 숫자 보고 금리 결정해요.', good: '예상보다 낮으면 → 경기 둔화 → Fed 인하 압박 → 채권 상승', bad: '예상보다 높으면 → 경기 과열 → Fed 인하 어려워짐 → 성장주 단기 압박' },
  fomc:   { what: 'Fed(미국 중앙은행)가 기준금리를 올릴지·내릴지·유지할지 결정하는 회의예요. 1년에 8번 열려요.', why: '전 세계 모든 자산 가격에 직접 영향을 미치는 가장 중요한 이벤트예요.', good: '예상보다 비둘기(인하/동결) → 주식·암호화폐·금 일제히 상승', bad: '예상보다 매파(인상/강경) → 주식 급락, 달러 급등, EM 자금 이탈' },
  gdp:    { what: '미국 경제 전체가 한 분기에 얼마나 성장했는지 보여주는 숫자예요. 연율로 환산해서 발표돼요.', why: '경제의 건강상태 성적표. 2% 이상이면 건강, 마이너스 두 분기 연속이면 공식 침체예요.', good: '예상보다 높으면 → 기업 실적 기대↑ → 주식 긍정', bad: '예상보다 낮으면 → 침체 우려 → 안전자산(금·채권) 매수' },
  ism:    { what: '제조업체 구매 담당자들에게 "지금 경기 좋아요?"라고 물어본 설문 지표예요. 50 이상이면 성장, 이하면 수축이에요.', why: '실제 경기보다 약 2~3개월 앞서 움직이는 선행 지표로 유명해요.', good: '50 이상 + 예상 상회 → 제조업 회복 → 산업주·원자재 상승', bad: '50 이하 + 예상 하회 → 제조업 침체 → 경기민감주 하락' },
  retail: { what: '미국 소비자들이 지난 한 달 동안 쇼핑에 얼마나 썼는지 집계한 지표예요. 미국 GDP의 70%가 소비예요.', why: '소비가 줄면 기업 매출 → 실적 → 주가에 직접 영향을 미쳐요.', good: '예상보다 높으면 → 소비 강세 → 리테일·소비재 주식 상승', bad: '예상보다 낮으면 → 소비 둔화 → 경기침체 우려' },
  ppi:    { what: '기업이 물건을 만들 때 드는 원재료·부품 비용이 얼마나 올랐는지 보여줘요. CPI보다 1~2개월 앞서서 나와요.', why: 'PPI가 오르면 → 기업이 가격 올림 → 나중에 CPI도 오를 수 있어요. CPI 예측 지표로 활용해요.', good: '예상보다 낮으면 → 원가 부담 완화 → 기업 마진 개선 기대', bad: '예상보다 높으면 → 향후 CPI 상승 예고 → 긴축 우려' },
  unrate: { what: '일하고 싶은데 일자리를 못 찾은 사람이 전체 노동자의 몇 %인지 보여줘요.', why: 'Fed의 두 가지 임무 중 하나가 "완전 고용"이에요. 실업률이 너무 낮으면 임금 인플레 우려.', good: '높아지면 → 경기 둔화 → Fed 인하 압박', bad: '너무 낮으면 → 임금 상승 → 인플레 → 금리 인상 위험' },
};

function LaymanBox({ id }: { id: string }) {
  const info = LAYMAN[id];
  if (!info) return null;
  return (
    <div className="mt-3 rounded-xl bg-blue-50 border border-blue-100 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none">💡</span>
        <div>
          <p className="text-xs font-bold text-blue-800 mb-0.5">이 지표가 뭔가요?</p>
          <p className="text-xs text-blue-700 leading-relaxed">{info.what}</p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none">🎯</span>
        <div>
          <p className="text-xs font-bold text-blue-800 mb-0.5">왜 중요한가요?</p>
          <p className="text-xs text-blue-700 leading-relaxed">{info.why}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
        <div className="flex items-start gap-1.5 text-xs bg-green-50 border border-green-100 rounded-lg p-2">
          <span>✅</span>
          <span className="text-green-700 leading-relaxed">{info.good}</span>
        </div>
        <div className="flex items-start gap-1.5 text-xs bg-red-50 border border-red-100 rounded-lg p-2">
          <span>⚠️</span>
          <span className="text-red-700 leading-relaxed">{info.bad}</span>
        </div>
      </div>
    </div>
  );
}

function MacroIndicatorsTab() {
  const [indicators, setIndicators] = useState<MacroIndicator[]>([]);
  const [yieldCurve, setYieldCurve] = useState<YieldCurve | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showLayman, setShowLayman] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/macro-indicators')
      .then(r => r.json())
      .then(d => { setIndicators(d.indicators ?? []); setYieldCurve(d.yieldCurve ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-cf-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">경제지표 로딩중...</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Intro banner */}
      <div className="cf-card p-4 bg-gradient-to-r from-slate-50 to-blue-50 border-blue-100">
        <div className="flex items-start gap-3">
          <div className="text-2xl leading-none">📊</div>
          <div>
            <h3 className="text-sm font-bold text-cf-text-primary mb-1">금리·시장을 움직이는 핵심 경제지표</h3>
            <p className="text-xs text-cf-text-secondary leading-relaxed">
              각 지표 발표가 주식·채권·달러·금에 어떤 연쇄 영향(cascade)을 미치는지 보여줍니다.
              <span className="font-semibold text-cf-primary ml-1">💡 버튼을 누르면 쉬운 설명을 볼 수 있어요.</span>
            </p>
          </div>
        </div>
      </div>

      {/* Yield Curve */}
      {yieldCurve && (
        <div className={`cf-card p-4 ${yieldCurve.inverted ? 'border-red-300 bg-red-50/30' : ''}`}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold text-cf-text-primary flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cf-primary" />
              미 국채 수익률 곡선 (Yield Curve)
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              {yieldCurve.spread10y2y !== null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${yieldCurve.inverted ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                  10Y-2Y: {yieldCurve.spread10y2y > 0 ? '+' : ''}{yieldCurve.spread10y2y}%p
                </span>
              )}
              {yieldCurve.inverted && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white animate-pulse">⚠ 역전 경고</span>
              )}
            </div>
          </div>

          {/* Bar chart */}
          {(() => {
            const pts = yieldCurve.points.filter(p => p.value !== null);
            const maxVal = Math.max(...pts.map(p => p.value!), 0.1);
            return (
              <div className="flex items-end gap-1.5 h-28">
                {yieldCurve.points.map((pt, i) => {
                  if (pt.value === null) return null;
                  const heightPct = (pt.value / maxVal) * 100;
                  const prev = i > 0 ? yieldCurve.points[i - 1].value : null;
                  const isDown = prev !== null && pt.value < prev;
                  const isShort = ['1M','3M','6M','1Y'].includes(pt.label);
                  return (
                    <div key={pt.label} className="flex flex-col items-center gap-0.5 flex-1">
                      <span className={`text-[9px] font-bold tabular-nums ${isDown && yieldCurve.inverted ? 'text-red-500' : 'text-slate-600'}`}>
                        {pt.value.toFixed(2)}
                      </span>
                      <div
                        className={`w-full rounded-t-sm transition-all ${
                          yieldCurve.inverted && !isShort ? 'bg-red-400' :
                          isShort ? 'bg-slate-400' : 'bg-blue-500'
                        }`}
                        style={{ height: `${Math.max(heightPct, 4)}%` }}
                      />
                      <span className={`text-[9px] font-medium ${isShort ? 'text-slate-400' : 'text-blue-600'}`}>{pt.label}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Yield curve explanation */}
          <div className="mt-3 p-3 rounded-xl bg-white border border-gray-100 space-y-2">
            <p className="text-xs font-bold text-gray-700">📖 수익률 곡선이 뭔가요?</p>
            <p className="text-xs text-gray-600 leading-relaxed">
              국채를 <span className="font-semibold">1개월~30년</span>짜리 만기별로 빌려줄 때 받는 이자율이에요.
              보통은 오래 빌려줄수록 이자를 더 받으니까 <span className="font-semibold text-blue-600">오른쪽으로 갈수록 높아야 정상</span>이에요.
            </p>
            {yieldCurve.inverted ? (
              <div className="p-2.5 rounded-lg bg-red-50 border border-red-200">
                <p className="text-xs font-bold text-red-700 mb-1">⚠ 지금 역전 상태! — 무슨 의미인가요?</p>
                <p className="text-xs text-red-600 leading-relaxed">
                  단기 금리가 장기 금리보다 높아진 상태예요. 투자자들이 <span className="font-semibold">"곧 경기가 나빠져서 금리가 내려갈 것"</span>이라고 예상한다는 신호예요.
                  역사적으로 수익률 곡선 역전 후 <span className="font-semibold">6~18개월 내 경기침체</span>가 온 경우가 많았어요. 은행들도 단기로 돈을 빌려 장기로 빌려줘서 돈을 버는데, 역전되면 수익이 줄어 <span className="font-semibold">대출이 까다로워져요.</span>
                </p>
              </div>
            ) : (
              <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg p-2">
                ✅ 정상 우상향 — 경제 전망이 비교적 건전한 상태예요.
              </p>
            )}
          </div>
        </div>
      )}

      {/* FedWatch */}
      <FedWatchSection />

      {/* Section header */}
      <div className="flex items-center gap-2 px-1">
        <Activity className="w-4 h-4 text-cf-primary" />
        <h3 className="text-sm font-bold text-cf-text-primary">주요 경제지표 발표 결과 & Cascade 분석</h3>
        <span className="text-xs text-cf-text-secondary">클릭 → cascade · 💡 클릭 → 쉬운 설명</span>
      </div>

      <div className="space-y-3">
        {indicators.map((ind) => {
          const sb = SURPRISE_BADGE[ind.surprise];
          const rb = RATE_BADGE[ind.rateImpact];
          const isOpen = expanded === ind.id;
          const isLayman = showLayman === ind.id;
          return (
            <div key={ind.id} className="cf-card overflow-hidden">
              <div className="p-4">
                {/* Top row */}
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CAT_COLORS[ind.category] ?? 'bg-gray-50 text-gray-600'}`}>
                        {CAT_LABELS[ind.category] ?? ind.category}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${sb.cls}`}>{sb.label}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${rb.cls}`}>{rb.label}</span>
                      {ind.liveData && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 flex items-center gap-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                          LIVE
                        </span>
                      )}
                    </div>
                    <div className="font-bold text-cf-text-primary text-sm">{ind.nameKo}</div>
                    <div className="text-xs text-cf-text-secondary">{ind.name}</div>
                  </div>
                  {/* Numbers */}
                  <div className="flex items-end gap-3 flex-shrink-0 text-right">
                    {ind.actual !== null && (
                      <div>
                        <div className={`text-xl font-extrabold tabular-nums leading-tight ${ind.surprise === 'beat' ? 'text-red-600' : ind.surprise === 'miss' ? 'text-blue-600' : 'text-cf-text-primary'}`}>
                          {ind.actual.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-gray-400">{ind.unit} 실제</div>
                      </div>
                    )}
                    {ind.forecast !== null && (
                      <div>
                        <div className="text-sm font-bold text-gray-400 tabular-nums">{ind.forecast.toLocaleString()}</div>
                        <div className="text-[10px] text-gray-400">예상</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary */}
                <p className="text-xs text-cf-text-secondary mt-2 leading-relaxed">{ind.summary}</p>

                {/* Action buttons */}
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => setExpanded(isOpen ? null : ind.id)}
                    className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                      isOpen ? 'bg-cf-primary/10 border-cf-primary/30 text-cf-primary' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <GitMerge className="w-3 h-3" />
                    Cascade 영향 {isOpen ? '접기' : '보기'}
                  </button>
                  {LAYMAN[ind.id] && (
                    <button
                      onClick={() => setShowLayman(isLayman ? null : ind.id)}
                      className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                        isLayman ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-100'
                      }`}
                    >
                      💡 쉬운 설명 {isLayman ? '접기' : '보기'}
                    </button>
                  )}
                  <div className="ml-auto flex flex-col items-end gap-0.5">
                    {ind.releaseDate && (
                      <span className="text-[10px] font-semibold text-cf-text-secondary">
                        📅 발표일: <span className="text-cf-text-primary">{ind.releaseDate}</span>
                      </span>
                    )}
                    {ind.nextRelease && (
                      <span className="text-[10px] text-gray-400">다음 발표: {ind.nextRelease}</span>
                    )}
                  </div>
                </div>

                {/* Layman explanation */}
                {isLayman && <LaymanBox id={ind.id} />}
              </div>

              {/* Cascade detail */}
              {isOpen && ind.cascade.length > 0 && (
                <div className="border-t border-cf-border bg-gray-50/50 px-4 py-3">
                  <div className="text-xs font-bold text-cf-text-secondary mb-2 flex items-center gap-1.5">
                    <GitMerge className="w-3 h-3" />
                    이 발표가 시장에 미치는 연쇄 영향
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {ind.cascade.map((step, i) => (
                      <div key={i} className={`flex items-center gap-2 text-xs p-2.5 rounded-xl bg-white border ${MAG_OPACITY[step.magnitude]} ${
                        step.direction === 'up' ? 'border-green-100' : step.direction === 'down' ? 'border-red-100' : 'border-gray-100'
                      }`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                          step.direction === 'up' ? 'bg-green-50 text-green-600' : step.direction === 'down' ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-500'
                        }`}>
                          {CASCADE_ICONS[step.direction]}
                        </div>
                        <div>
                          <div className="font-bold text-cf-text-primary leading-tight">{step.asset}</div>
                          <div className="text-cf-text-secondary leading-tight mt-0.5">{step.reason}</div>
                        </div>
                        <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                          step.magnitude === 'strong' ? 'bg-red-50 text-red-500' : step.magnitude === 'moderate' ? 'bg-amber-50 text-amber-500' : 'bg-gray-50 text-gray-400'
                        }`}>
                          {step.magnitude === 'strong' ? '강' : step.magnitude === 'moderate' ? '중' : '약'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {isOpen && ind.cascade.length === 0 && (
                <div className="border-t border-cf-border bg-gray-50/50 px-4 py-3">
                  <p className="text-xs text-cf-text-secondary">
                    예상에 부합한 결과 — 시장이 이미 예상했던 내용이라 큰 변동이 없어요.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Credit Balance Tab ────────────────────────────────────────────────────────
interface CreditHistPoint { period: string; balance: number; gdpRatio: number; }
interface CountryCreditData {
  id: string; country: string; flag: string;
  currentBalance: number; currentBalanceLocal: string;
  gdp: number; gdpRatio: number;
  changeYoY: number; changeQoQ: number;
  historical: CreditHistPoint[];
  peakBalance: number; peakPeriod: string;
  troughBalance: number; troughPeriod: string;
  histPercentile: number;
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  riskReason: string; source: string; sourceUrl: string;
  lastUpdated: string; laymanSummary: string;
}
interface GlobalSnapshot {
  totalBalance: number; globalGdpRatio: number;
  riskCounts: Record<string, number>;
  mostLeveraged: CountryCreditData[];
  fastestGrowing: CountryCreditData[];
}

const RISK_COLORS = {
  low:     { bar: 'bg-emerald-400', text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', label: '안전', dot: 'bg-emerald-400' },
  medium:  { bar: 'bg-amber-400',   text: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     label: '주의', dot: 'bg-amber-400' },
  high:    { bar: 'bg-orange-500',  text: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200',   label: '경계', dot: 'bg-orange-500' },
  extreme: { bar: 'bg-red-600',     text: 'text-red-700',     bg: 'bg-red-50 border-red-200',         label: '위험', dot: 'bg-red-600' },
};

function MiniSparkline({ data, color = 'bg-blue-400' }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  return (
    <div className="flex items-end gap-px h-8 w-20">
      {data.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-t-sm ${color} opacity-80 transition-all`}
          style={{ height: `${Math.max(((v - min) / range) * 100, 8)}%` }}
        />
      ))}
    </div>
  );
}

function GdpRatioGauge({ ratio, peak, trough, percentile }: { ratio: number; peak: number; trough: number; percentile: number }) {
  const range = peak - trough || 1;
  const posPct = Math.min(((ratio - trough) / range) * 100, 100);
  const riskColor = percentile >= 90 ? 'bg-red-500' : percentile >= 70 ? 'bg-orange-400' : percentile >= 40 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[10px] text-cf-text-secondary mb-1">
        <span>최저 {trough.toFixed(1)}%</span>
        <span className="font-bold text-cf-text-primary">현재 {ratio.toFixed(2)}%</span>
        <span>최고 {peak.toFixed(1)}%</span>
      </div>
      <div className="relative h-3 rounded-full bg-gray-100 overflow-hidden">
        {/* Gradient track */}
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-200 via-amber-200 to-red-300 opacity-40 rounded-full" />
        {/* Position marker */}
        <div
          className={`absolute top-0 h-full w-2 rounded-full ${riskColor} shadow-sm transition-all`}
          style={{ left: `calc(${posPct}% - 4px)` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
        <span>안전</span><span>주의</span><span>경계</span><span>위험</span>
      </div>
    </div>
  );
}

function CreditBalanceTab() {
  const [countries, setCountries] = useState<CountryCreditData[]>([]);
  const [usLongHistory, setUsLongHistory] = useState<CountryCreditData | null>(null);
  const [globalSnapshot, setGlobalSnapshot] = useState<GlobalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>('us');
  const [viewMode, setViewMode] = useState<'balance' | 'gdpRatio'>('gdpRatio');
  const [showLayman, setShowLayman] = useState(false);

  useEffect(() => {
    fetch('/api/credit-balance')
      .then(r => r.json())
      .then(d => {
        setCountries(d.countries ?? []);
        setUsLongHistory(d.usLongHistory ?? null);
        setGlobalSnapshot(d.globalSnapshot ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-cf-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">신용잔고 데이터 로딩중...</span>
    </div>
  );

  const activeCountry = countries.find(c => c.id === selected) ?? countries[0];
  if (!activeCountry) return null;

  const rc = RISK_COLORS[activeCountry.riskLevel];
  const histValues = activeCountry.historical.map(h => viewMode === 'balance' ? h.balance : h.gdpRatio);
  const maxHist = Math.max(...histValues, 0.1);

  // GDP ratio historical trough/peak for gauge
  const gdpRatioHistory = activeCountry.historical.map(h => h.gdpRatio);
  const gdpRatioPeak = Math.max(...gdpRatioHistory);
  const gdpRatioTrough = Math.min(...gdpRatioHistory);

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div className="cf-card p-4 bg-gradient-to-r from-slate-50 to-indigo-50 border-indigo-100">
        <div className="flex items-start gap-3">
          <div className="text-2xl leading-none">📉</div>
          <div>
            <h3 className="text-sm font-bold text-cf-text-primary mb-1">국가별 신용잔고 — 시장 레버리지 지도</h3>
            <p className="text-xs text-cf-text-secondary leading-relaxed">
              투자자들이 주식을 사기 위해 빌린 돈의 총합이에요. <span className="font-semibold text-indigo-600">GDP 대비 비율과 역대 비교</span>로
              현재 시장이 얼마나 과열됐는지, 조정 리스크가 얼마나 큰지 볼 수 있어요.
            </p>
          </div>
        </div>
      </div>

      {/* Global snapshot */}
      {globalSnapshot && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="cf-card p-3 text-center">
            <div className="text-lg font-extrabold text-cf-text-primary tabular-nums">${globalSnapshot.totalBalance.toFixed(0)}B</div>
            <div className="text-[10px] text-cf-text-secondary mt-0.5">글로벌 신용잔고 합산</div>
          </div>
          <div className="cf-card p-3 text-center">
            <div className="text-lg font-extrabold text-amber-600 tabular-nums">{globalSnapshot.globalGdpRatio.toFixed(2)}%</div>
            <div className="text-[10px] text-cf-text-secondary mt-0.5">합산 GDP 대비</div>
          </div>
          <div className="cf-card p-3 text-center">
            <div className="text-lg font-extrabold text-orange-600 tabular-nums">
              {(globalSnapshot.riskCounts['high'] ?? 0) + (globalSnapshot.riskCounts['extreme'] ?? 0)}
            </div>
            <div className="text-[10px] text-cf-text-secondary mt-0.5">경계/위험 국가 수</div>
          </div>
          <div className="cf-card p-3 text-center">
            <div className="text-base font-extrabold text-red-600 truncate">
              {globalSnapshot.fastestGrowing[0]?.flag} {globalSnapshot.fastestGrowing[0]?.country}
            </div>
            <div className="text-[10px] text-cf-text-secondary mt-0.5">가장 빠른 증가</div>
            <div className="text-[11px] font-bold text-red-500">+{globalSnapshot.fastestGrowing[0]?.changeYoY.toFixed(1)}% YoY</div>
          </div>
        </div>
      )}

      {/* Country selector + view toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {countries.map(c => {
            const rc2 = RISK_COLORS[c.riskLevel];
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                  selected === c.id
                    ? `${rc2.bg} ${rc2.text} shadow-sm`
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span>{c.flag}</span>
                <span>{c.country}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${rc2.dot}`} />
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => setViewMode('gdpRatio')} className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${viewMode === 'gdpRatio' ? 'bg-white shadow-sm text-cf-text-primary' : 'text-gray-500'}`}>GDP 비율</button>
          <button onClick={() => setViewMode('balance')} className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${viewMode === 'balance' ? 'bg-white shadow-sm text-cf-text-primary' : 'text-gray-500'}`}>금액(USD)</button>
        </div>
      </div>

      {/* Country detail */}
      <div className="cf-card p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">{activeCountry.flag}</span>
              <span className="text-lg font-extrabold text-cf-text-primary">{activeCountry.country}</span>
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${rc.bg} ${rc.text}`}>
                {rc.label} (역대 {activeCountry.histPercentile}th)
              </span>
            </div>
            <p className="text-xs text-cf-text-secondary">{activeCountry.source} · {activeCountry.lastUpdated}</p>
          </div>
          <button
            onClick={() => setShowLayman(p => !p)}
            className={`flex-shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${showLayman ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-blue-50 border-blue-100 text-blue-600'}`}
          >
            💡 쉬운 설명
          </button>
        </div>

        {showLayman && (
          <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-700 leading-relaxed">
            {activeCountry.laymanSummary}
          </div>
        )}

        {/* Key numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-[10px] text-cf-text-secondary mb-1">현재 신용잔고</div>
            <div className="text-base font-extrabold text-cf-text-primary">{activeCountry.currentBalanceLocal}</div>
            <div className="text-[10px] text-gray-400">${activeCountry.currentBalance.toFixed(1)}B USD</div>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-[10px] text-cf-text-secondary mb-1">GDP 대비</div>
            <div className={`text-base font-extrabold tabular-nums ${rc.text}`}>{activeCountry.gdpRatio.toFixed(2)}%</div>
            <GdpRatioGauge
              ratio={activeCountry.gdpRatio}
              peak={gdpRatioPeak}
              trough={gdpRatioTrough}
              percentile={activeCountry.histPercentile}
            />
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-[10px] text-cf-text-secondary mb-1">전년 대비 (YoY)</div>
            <div className={`text-base font-extrabold tabular-nums ${activeCountry.changeYoY >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
              {activeCountry.changeYoY >= 0 ? '+' : ''}{activeCountry.changeYoY.toFixed(1)}%
            </div>
            <div className="text-[10px] text-gray-400">전분기: {activeCountry.changeQoQ >= 0 ? '+' : ''}{activeCountry.changeQoQ.toFixed(1)}%</div>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-[10px] text-cf-text-secondary mb-1">역대 최고</div>
            <div className="text-sm font-extrabold text-cf-text-primary">
              {viewMode === 'gdpRatio' ? `${gdpRatioPeak.toFixed(2)}%` : `$${activeCountry.peakBalance}B`}
            </div>
            <div className="text-[10px] text-gray-400">{activeCountry.peakPeriod}</div>
          </div>
        </div>

        {/* Historical bar chart */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-cf-text-primary">
              {viewMode === 'gdpRatio' ? 'GDP 대비 신용잔고 (%)' : '신용잔고 절대 금액 (USD Billions)'}
            </span>
            <span className="text-[10px] text-cf-text-secondary">역대 비교</span>
          </div>
          <div className="flex items-end gap-1 h-32">
            {activeCountry.historical.map((pt, i) => {
              const val = viewMode === 'balance' ? pt.balance : pt.gdpRatio;
              const heightPct = (val / maxHist) * 100;
              const isCurrentOrRecent = i === activeCountry.historical.length - 1;
              const isPeak = val === maxHist;
              return (
                <div key={pt.period} className="flex flex-col items-center gap-0.5 flex-1 min-w-0 group relative">
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                    <div className="bg-slate-800 text-white text-[10px] px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
                      <div className="font-bold">{pt.period}</div>
                      <div>{viewMode === 'gdpRatio' ? `${val.toFixed(2)}% (GDP비)` : `$${val}B`}</div>
                    </div>
                    <div className="w-1.5 h-1.5 bg-slate-800 rotate-45 -mt-0.5" />
                  </div>
                  <div
                    className={`w-full rounded-t transition-all ${
                      isPeak ? 'bg-red-400' :
                      isCurrentOrRecent ? rc.bar :
                      'bg-blue-300'
                    } ${isPeak ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  />
                  <span className={`text-[8px] truncate max-w-full text-center ${isCurrentOrRecent ? 'font-bold text-cf-text-primary' : 'text-gray-400'}`}>
                    {pt.period.replace('-Q1', '').replace('-Q2', '').replace('-Q3', '').replace('-Q4', '')}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 mt-2 text-[10px]">
            <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-red-400" /><span className="text-cf-text-secondary">역대 최고</span></div>
            <div className="flex items-center gap-1"><div className={`w-2.5 h-2.5 rounded-sm ${rc.bar}`} /><span className="text-cf-text-secondary">현재</span></div>
            <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-blue-300" /><span className="text-cf-text-secondary">과거</span></div>
          </div>
        </div>

        {/* Risk reason */}
        <div className={`p-3 rounded-xl border text-xs leading-relaxed ${rc.bg} ${rc.text}`}>
          <span className="font-bold">리스크 분석: </span>{activeCountry.riskReason}
        </div>
      </div>

      {/* US long-term history (닷컴버블~현재) */}
      {usLongHistory && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-1 flex items-center gap-2">
            🇺🇸 미국 신용잔고 장기 역사 — 닷컴버블부터 현재까지
          </h3>
          <p className="text-xs text-cf-text-secondary mb-3">
            역대 시장 버블·붕괴와 신용잔고의 관계. 현재 위치를 역사적 맥락에서 봐요.
          </p>
          <div className="flex items-end gap-1 h-28">
            {usLongHistory.historical.map((pt, i) => {
              const val = pt.gdpRatio;
              const maxV = Math.max(...usLongHistory.historical.map(h => h.gdpRatio));
              const heightPct = (val / maxV) * 100;
              const isCurrent = i === usLongHistory.historical.length - 1;
              const isPeak = val === maxV; // 2021
              const isCrash = pt.period === '2002' || pt.period === '2009';
              return (
                <div key={pt.period} className="flex flex-col items-center gap-0.5 flex-1 min-w-0 group relative">
                  <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                    <div className="bg-slate-800 text-white text-[10px] px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
                      <div className="font-bold">{pt.period}</div>
                      <div>GDP비 {val.toFixed(1)}% · ${pt.balance}B</div>
                    </div>
                    <div className="w-1.5 h-1.5 bg-slate-800 rotate-45 -mt-0.5" />
                  </div>
                  <div
                    className={`w-full rounded-t transition-all ${
                      isPeak ? 'bg-red-500' :
                      isCrash ? 'bg-blue-300' :
                      isCurrent ? 'bg-amber-400' :
                      'bg-slate-300'
                    }`}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  />
                  <span className={`text-[8px] truncate max-w-full ${isCurrent ? 'font-bold text-cf-text-primary' : 'text-gray-400'}`}>
                    {pt.period}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
            {[
              { period: '2000-2002', color: 'bg-red-50 border-red-100 text-red-700', label: '닷컴버블', desc: 'GDP비 2.7% → 1.3% 급락. 나스닥 -78% 동반.' },
              { period: '2007-2009', color: 'bg-orange-50 border-orange-100 text-orange-700', label: '금융위기', desc: 'GDP비 2.6% → 1.6%. S&P500 -57% 동반.' },
              { period: '2021-2022', color: 'bg-amber-50 border-amber-100 text-amber-700', label: '팬데믹 버블', desc: 'GDP비 4.1%(최고) → 2.5%. 연준 긴축에 급락.' },
            ].map(e => (
              <div key={e.period} className={`p-2.5 rounded-lg border text-xs leading-relaxed ${e.color}`}>
                <div className="font-bold mb-0.5">{e.period} {e.label}</div>
                {e.desc}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Country comparison table */}
      <div className="cf-card overflow-hidden">
        <div className="p-4 pb-2">
          <h3 className="text-sm font-bold text-cf-text-primary">국가별 비교 요약</h3>
          <p className="text-xs text-cf-text-secondary">GDP 대비 신용잔고 비율 기준 정렬</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-cf-border bg-gray-50/50">
                <th className="text-left px-4 py-2 font-semibold text-cf-text-secondary">국가</th>
                <th className="text-right px-3 py-2 font-semibold text-cf-text-secondary">신용잔고</th>
                <th className="text-right px-3 py-2 font-semibold text-cf-text-secondary">GDP비</th>
                <th className="text-right px-3 py-2 font-semibold text-cf-text-secondary">YoY</th>
                <th className="text-center px-3 py-2 font-semibold text-cf-text-secondary">역대위치</th>
                <th className="text-center px-3 py-2 font-semibold text-cf-text-secondary">추세</th>
                <th className="text-center px-3 py-2 font-semibold text-cf-text-secondary">리스크</th>
              </tr>
            </thead>
            <tbody>
              {[...countries].sort((a, b) => b.gdpRatio - a.gdpRatio).map((c, i) => {
                const rc2 = RISK_COLORS[c.riskLevel];
                const spark = c.historical.slice(-6).map(h => h.gdpRatio);
                return (
                  <tr
                    key={c.id}
                    className={`border-b border-cf-border/50 transition-colors cursor-pointer hover:bg-gray-50/50 ${selected === c.id ? 'bg-cf-primary/5' : ''}`}
                    onClick={() => setSelected(c.id)}
                  >
                    <td className="px-4 py-2.5 font-medium text-cf-text-primary">
                      <span className="mr-1.5">{c.flag}</span>{c.country}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-cf-text-primary">{c.currentBalanceLocal}</td>
                    <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${rc2.text}`}>{c.gdpRatio.toFixed(2)}%</td>
                    <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${c.changeYoY >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                      {c.changeYoY >= 0 ? '+' : ''}{c.changeYoY.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full ${rc2.bar} rounded-full`} style={{ width: `${c.histPercentile}%` }} />
                        </div>
                        <span className="text-[10px] tabular-nums text-cf-text-secondary">{c.histPercentile}th</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-center">
                        <MiniSparkline data={spark} color={c.changeYoY >= 0 ? 'bg-red-400' : 'bg-blue-400'} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${rc2.bg} ${rc2.text}`}>{rc2.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-[10px] text-cf-text-secondary border-t border-cf-border">
          데이터: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · 단위: USD Billions (환율 환산) · 분기별 업데이트
        </div>
      </div>
    </div>
  );
}

// ── News Cascade Tab ──────────────────────────────────────────────────────────
interface CascadeEffectItem { asset: string; direction: 'positive' | 'negative' | 'neutral'; magnitude: 'high' | 'medium' | 'low'; reason: string; timeframe: string; }
interface NewsWithCascadeItem { id: string; title: string; source: string; pubDate: string; summary: string; cascades: CascadeEffectItem[]; sentiment: 'bullish' | 'bearish' | 'neutral'; importance: 'high' | 'medium' | 'low'; }

const SENTIMENT_STYLE: Record<string, { label: string; cls: string }> = {
  bullish:  { label: '강세', cls: 'bg-green-50 text-green-700 border-green-200' },
  bearish:  { label: '약세', cls: 'bg-red-50 text-red-700 border-red-200' },
  neutral:  { label: '중립', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
};
const IMPORTANCE_STYLE: Record<string, { cls: string }> = {
  high:   { cls: 'border-l-4 border-l-red-400' },
  medium: { cls: 'border-l-4 border-l-amber-400' },
  low:    { cls: 'border-l-4 border-l-gray-300' },
};
const CASCADE_DIR_STYLE: Record<string, { icon: string; cls: string }> = {
  positive: { icon: '▲', cls: 'text-green-600 bg-green-50' },
  negative: { icon: '▼', cls: 'text-red-600 bg-red-50' },
  neutral:  { icon: '→', cls: 'text-gray-500 bg-gray-50' },
};

function NewsCascadeTab() {
  const [news, setNews] = useState<NewsWithCascadeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/news-cascade')
      .then(r => r.json())
      .then(d => setNews(Array.isArray(d) ? d : (d.articles ?? d.news ?? d.items ?? [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-cf-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">뉴스 분석 중...</span>
    </div>
  );

  if (!news.length) return (
    <div className="cf-card p-8 text-center text-cf-text-secondary text-sm">
      뉴스 Cascade 데이터를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="cf-card p-4 bg-gradient-to-r from-slate-50 to-amber-50 border-amber-100">
        <div className="flex items-start gap-3">
          <div className="text-2xl leading-none">📡</div>
          <div>
            <h3 className="text-sm font-bold text-cf-text-primary mb-1">뉴스 시장 파급 분석 (Cascade)</h3>
            <p className="text-xs text-cf-text-secondary leading-relaxed">AI가 주요 뉴스를 분석해 각 자산·섹터에 미치는 연쇄 영향을 예측합니다. 🔴 중요도 높음 · 🟡 중간 · ⚪ 낮음</p>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {news.map((item) => {
          const isOpen = expanded === item.id;
          const ss = SENTIMENT_STYLE[item.sentiment] ?? SENTIMENT_STYLE.neutral;
          const imp = IMPORTANCE_STYLE[item.importance] ?? IMPORTANCE_STYLE.low;
          return (
            <div key={item.id} className={`cf-card overflow-hidden ${imp.cls}`}>
              <div className="p-4">
                <div className="flex items-start gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ss.cls}`}>{ss.label}</span>
                      <span className="text-[10px] text-cf-text-secondary">{item.source}</span>
                      <span className="text-[10px] text-gray-400">{new Date(item.pubDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <h4 className="text-sm font-bold text-cf-text-primary leading-snug">{item.title}</h4>
                    {item.summary && <p className="text-xs text-cf-text-secondary mt-1 leading-relaxed">{item.summary}</p>}
                  </div>
                </div>
                {item.cascades.length > 0 && (
                  <button
                    onClick={() => setExpanded(isOpen ? null : item.id)}
                    className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${isOpen ? 'bg-cf-primary/10 border-cf-primary/30 text-cf-primary' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                  >
                    <GitMerge className="w-3 h-3" />
                    Cascade {item.cascades.length}개 {isOpen ? '접기' : '보기'}
                  </button>
                )}
              </div>
              {isOpen && (
                <div className="border-t border-cf-border bg-gray-50/50 px-4 py-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {item.cascades.map((c, i) => {
                      const ds = CASCADE_DIR_STYLE[c.direction] ?? CASCADE_DIR_STYLE.neutral;
                      return (
                        <div key={i} className={`flex items-center gap-2 text-xs p-2.5 rounded-xl bg-white border ${c.direction === 'positive' ? 'border-green-100' : c.direction === 'negative' ? 'border-red-100' : 'border-gray-100'}`}>
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-bold ${ds.cls}`}>{ds.icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-cf-text-primary">{c.asset}</div>
                            <div className="text-cf-text-secondary leading-tight">{c.reason}</div>
                            <div className="text-gray-400 text-[10px]">{c.timeframe}</div>
                          </div>
                          <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${c.magnitude === 'high' ? 'bg-red-50 text-red-500' : c.magnitude === 'medium' ? 'bg-amber-50 text-amber-500' : 'bg-gray-50 text-gray-400'}`}>
                            {c.magnitude === 'high' ? '강' : c.magnitude === 'medium' ? '중' : '약'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const TABS = ['capital', 'macro', 'flows', 'fear-greed', 'credit', 'narratives', 'news'] as const;
type Tab = typeof TABS[number];

interface LiveFGData {
  byCountry: FearGreedEntryExtended[];
  byAsset: FearGreedEntryExtended[];
  updatedAt: string;
}

export default function IntelligencePage() {
  const t = useTranslations('intelligence');
  const [activeTab, setActiveTab] = useState<Tab>('flows');
  const [chatOpen, setChatOpen] = useState(false);

  // Live Fear & Greed data from API
  const [fgData, setFgData] = useState<LiveFGData | null>(null);
  const [fgLoading, setFgLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== 'fear-greed' || fgData) return;
    setFgLoading(true);
    fetch('/api/fear-greed')
      .then((r) => r.json())
      .then((d) => setFgData(d))
      .catch(() => {/* fallback to static */})
      .finally(() => setFgLoading(false));
  }, [activeTab, fgData]);

  const liveCountry = (fgData?.byCountry ?? fearGreedByCountry) as FearGreedEntryExtended[];
  const liveAsset = (fgData?.byAsset ?? fearGreedByAsset) as FearGreedEntryExtended[];

  const tabConfig: Record<Tab, { label: string; icon: React.ReactNode }> = {
    'capital':     { label: '자금 흐름 지도',  icon: <GitMerge className="w-4 h-4" /> },
    'macro':       { label: '매크로 지표',     icon: <TrendingUp className="w-4 h-4" /> },
    'flows':       { label: '머니 흐름',       icon: <Activity className="w-4 h-4" /> },
    'fear-greed':  { label: 'Fear & Greed',   icon: <BarChart3 className="w-4 h-4" /> },
    'credit':      { label: '신용잔고',        icon: <TrendingDown className="w-4 h-4" /> },
    'narratives':  { label: '매크로 테마',     icon: <Brain className="w-4 h-4" /> },
    'news':        { label: '뉴스 Cascade',   icon: <Zap className="w-4 h-4" /> },
  };

  const inflows = moneyFlowSectors.filter(f => f.direction === 'inflow').sort((a, b) => b.magnitude - a.magnitude);
  const outflows = moneyFlowSectors.filter(f => f.direction === 'outflow').sort((a, b) => b.magnitude - a.magnitude);

  return (
    <div className="min-h-screen bg-cf-bg">
      {/* Hero */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white py-12 px-4">
        <div className="mx-auto max-w-5xl">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-medium mb-4">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
            </span>
            <span className="text-amber-200">{t('title')}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-heading font-extrabold mb-3 leading-tight">
            {t('subtitle')}
          </h1>
          <p className="text-slate-300 max-w-2xl leading-relaxed">{t('description')}</p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap flex-shrink-0 ${
                activeTab === tab
                  ? 'bg-white text-cf-text-primary shadow-sm'
                  : 'text-cf-text-secondary hover:text-cf-text-primary'
              }`}
            >
              {tabConfig[tab].icon}
              {tabConfig[tab].label}
            </button>
          ))}
        </div>

        {/* Tab: 자금 흐름 지도 */}
        {activeTab === 'capital' && <CapitalFlowsTab />}

        {/* Tab: 매크로 지표 */}
        {activeTab === 'macro' && <MacroIndicatorsTab />}

        {/* Tab: 비밀 머니 흐름 */}
        {activeTab === 'flows' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h2 className="text-base font-heading font-bold text-green-700 mb-3 flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4" />
                  스마트 머니 유입 섹터
                </h2>
                <div className="space-y-3">
                  {inflows.map((f) => <MoneyFlowRow key={f.sector} flow={f} />)}
                </div>
              </div>
              <div>
                <h2 className="text-base font-heading font-bold text-red-700 mb-3 flex items-center gap-2">
                  <ArrowDownRight className="w-4 h-4" />
                  스마트 머니 이탈 섹터
                </h2>
                <div className="space-y-3">
                  {outflows.map((f) => <MoneyFlowRow key={f.sector} flow={f} />)}
                </div>
              </div>
            </div>
            <p className="text-xs text-cf-text-secondary text-center">
              데이터 소스: SEC 13F 공시 + 기관 포지션 변화 분석 · 매일 새벽 3시 자동 업데이트
            </p>
          </div>
        )}

        {/* Tab: Fear & Greed */}
        {activeTab === 'fear-greed' && (
          <div className="space-y-8">
            {fgLoading && (
              <div className="flex items-center justify-center gap-2 py-8 text-cf-text-secondary">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">실시간 시장 데이터 로딩중...</span>
              </div>
            )}
            {!fgLoading && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-lg font-heading font-bold text-cf-text-primary flex items-center gap-2">
                      <Globe className="w-5 h-5 text-cf-primary" />
                      국가별 Fear & Greed
                    </h2>
                    {fgData?.updatedAt && (
                      <span className="text-[11px] text-cf-text-secondary">
                        {new Date(fgData.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 업데이트
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-cf-text-secondary mb-4">
                    {fgData ? 'CNN F&G 원리 (RSI · 125일 모멘텀 · 변동성) · Yahoo Finance (15분 지연)' : '정적 데이터'}
                    {' '}· 0 = 극단적 공포, 100 = 극단적 탐욕
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {liveCountry.map((e) => <FearGreedCard key={e.id} entry={e} />)}
                  </div>
                </div>

                <div>
                  <h2 className="text-lg font-heading font-bold text-cf-text-primary mb-1 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-cf-primary" />
                    자산별 Fear & Greed
                  </h2>
                  <p className="text-xs text-cf-text-secondary mb-4">섹터 및 자산 클래스별 시장 심리 지수</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {liveAsset.map((e) => <FearGreedCard key={e.id} entry={e} />)}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab: Macro Themes */}
        {/* Tab: 신용잔고 */}
        {activeTab === 'credit' && <CreditBalanceTab />}

        {activeTab === 'narratives' && (
          <div>
            <p className="text-sm text-cf-text-secondary mb-6">
              시장을 지배하는 8가지 구조적 힘 — 뉴스에 나오기 전에 이해하세요.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {macroNarratives.map((n) => (
                <NarrativeCard key={n.id} n={n} t={t} />
              ))}
            </div>
          </div>
        )}

        {/* Tab: 뉴스 Cascade */}
        {activeTab === 'news' && <NewsCascadeTab />}
      </div>

      {/* Floating AI Chat Button */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {chatOpen && (
          <div className="w-[340px] sm:w-[400px] max-h-[520px] flex flex-col rounded-2xl shadow-2xl border border-cf-border bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-cf-primary text-white">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4" />
                <span className="text-sm font-semibold">Flowvium AI</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-white/70 hover:text-white text-lg leading-none">×</button>
            </div>
            <AiChat t={t} />
          </div>
        )}
        <button
          onClick={() => setChatOpen((o) => !o)}
          className="w-14 h-14 rounded-full bg-cf-primary text-white shadow-lg hover:bg-cf-primary/90 transition-all flex items-center justify-center"
        >
          {chatOpen ? <Minus className="w-6 h-6" /> : <Brain className="w-6 h-6" />}
        </button>
      </div>
    </div>
  );
}
