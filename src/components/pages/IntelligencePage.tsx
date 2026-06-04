'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { macroNarratives, type MacroNarrative } from '@/data/macro-narratives';
import type { InstitutionalSignal } from '@/data/institutional-signals';
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
import dynamic from 'next/dynamic';
import Sparkline from '@/components/Sparkline';

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
  history?: Array<{date: string; score: number}>;
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
                title={t('cnnBadgeTooltip')}
              >
                CNN
              </span>
            )}
            {entry.source === 'composite' && (
              <span
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200 flex-shrink-0"
                title="FlowVium composite index: RSI-14 × 40% + 125d SMA momentum × 35% + volatility × 25%"
              >
                {t('compositeLabel')}
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
          {entry.history && entry.history.length >= 2 && (
            <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
              <Sparkline values={entry.history.map(h => h.score)} width={56} height={18} />
              <span className="text-[9px] text-cf-text-secondary leading-none">30d</span>
            </div>
          )}
        </div>
      </button>

      {/* Factor bars — always visible when data is available */}
      {entry.factors && (
        <div className="border-t border-cf-border bg-gray-50/40 px-4 pt-2.5 pb-2 space-y-1.5">
          <FactorBar label={t('rsiMomentum')} score={entry.factors.rsi} weight="40%" />
          <FactorBar label={t('trendStrength')} score={entry.factors.momentum} weight="35%" />
          <FactorBar label={t('volatility')} score={entry.factors.volatility} weight="25%" />
        </div>
      )}

      {/* Expanded detail — macro context + methodology */}
      {expanded && entry.detail && (
        <div className="border-t border-cf-border bg-gray-50/60 px-4 py-3 space-y-3">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-cf-text-secondary uppercase tracking-wide">🔍 {t('measureFactors')}</p>
            {entry.detail.factors.map((f, i) => (
              <p key={i} className="text-[11px] text-cf-text-secondary leading-relaxed flex gap-1.5">
                <span className="text-gray-400 flex-shrink-0">•</span>{f}
              </p>
            ))}
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-2.5">
            <p className="text-[10px] font-bold text-blue-700 mb-1">📈 {t('sentimentBackground')}</p>
            <p className="text-[11px] text-blue-700 leading-relaxed">{entry.detail.macro}</p>
          </div>
          <div className="rounded-lg bg-red-50 border border-red-100 p-2.5">
            <p className="text-[10px] font-bold text-red-600 mb-1">⚠ {t('keyRisks')}</p>
            <p className="text-[11px] text-red-600 leading-relaxed">{entry.detail.risk}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Money Flow ────────────────────────────────────────────────────────────────
type IntelTr = (k: string, vals?: Record<string, string | number>) => string;
function weeksAgo(dateStr: string, t: IntelTr): string {
  const start = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) return t('weeksAgoDays', { n: diffDays });
  if (diffDays < 30) return t('weeksAgoWeeks', { n: Math.floor(diffDays / 7) });
  return t('weeksAgoMonths', { n: Math.floor(diffDays / 30) });
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
          </div>
          <p className="text-xs text-cf-text-secondary leading-relaxed mb-2">{flow.reason}</p>
          {/* Timing row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-cf-text-secondary flex items-center gap-1">
              🕐 {weeksAgo(flow.sinceDate, t)}
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
interface NarrativeIntensity {
  id: string;
  intensity: number;
  direction: 'heating' | 'cooling' | 'neutral';
  tickerMomentum: number;
  sectorMomentum: number;
  topMovers: Array<{ ticker: string; changePct: number }>;
  liveData: boolean;
}

function NarrativeCard({ n, t, intensity }: { n: MacroNarrative; t: ReturnType<typeof useTranslations<'intelligence'>>; intensity?: NarrativeIntensity }) {
  const dir = intensity?.direction;
  const dirStyle = dir === 'heating'
    ? { cls: 'text-red-600 bg-red-50 border-red-200', icon: <TrendingUp className="w-3 h-3" />, label: t('narrativeHeating') }
    : dir === 'cooling'
    ? { cls: 'text-blue-600 bg-blue-50 border-blue-200', icon: <TrendingDown className="w-3 h-3" />, label: t('narrativeCooling') }
    : { cls: 'text-gray-500 bg-gray-50 border-gray-200', icon: <Activity className="w-3 h-3" />, label: t('narrativeNeutral') };
  const barColor = dir === 'heating' ? 'bg-red-500' : dir === 'cooling' ? 'bg-blue-500' : 'bg-gray-400';
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
            {intensity?.liveData && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${dirStyle.cls}`} title={t('narrativeIntensityTip')}>
                {dirStyle.icon}{dirStyle.label} {intensity.intensity}
              </span>
            )}
          </div>
          <h3 className="text-base font-heading font-bold text-cf-text-primary leading-tight">{n.title}</h3>
        </div>
      </div>
      {intensity?.liveData && (
        <div className="mb-3">
          <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full ${barColor} transition-all`} style={{ width: `${intensity.intensity}%` }} />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-cf-text-secondary/70">
            <span>{t('narrativeTickerMom')}: {intensity.tickerMomentum > 0 ? '+' : ''}{intensity.tickerMomentum}%</span>
            <span>{t('narrativeSectorMom')}(4w): {intensity.sectorMomentum > 0 ? '+' : ''}{intensity.sectorMomentum}%</span>
          </div>
        </div>
      )}
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

// ── Narratives Tab (정적 정의 + 라이브 intensity overlay) ───────────────────────
function NarrativesTab({ t }: { t: ReturnType<typeof useTranslations<'intelligence'>> }) {
  const [intensityMap, setIntensityMap] = useState<Record<string, NarrativeIntensity>>({});
  const [source, setSource] = useState<'live' | 'static' | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/narratives')
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (cancelled || !j) return;
        const map: Record<string, NarrativeIntensity> = {};
        for (const i of (j.intensities ?? [])) map[i.id] = i;
        setIntensityMap(map);
        setSource(j.source ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return (
    <div>
      <p className="text-sm text-cf-text-secondary mb-2">{t('narrativesDesc')}</p>
      {source === 'live' && (
        <p className="text-[11px] text-cf-text-secondary/70 mb-6 flex items-center gap-1">
          <Activity className="w-3 h-3" /> {t('narrativeLiveNote')}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {macroNarratives.map((n) => (
          <NarrativeCard key={n.id} n={n} t={t} intensity={intensityMap[n.id]} />
        ))}
      </div>
    </div>
  );
}

// ── AI Chat ───────────────────────────────────────────────────────────────────
interface Message { role: 'user' | 'assistant'; content: string; }

function AiChat({ t, flowSectors }: { t: ReturnType<typeof useTranslations<'intelligence'>>; flowSectors?: MoneyFlowSector[] }) {
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
      const flowContext = (flowSectors ?? moneyFlowSectors)
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        <span className="ml-auto text-xs text-slate-400">{t('poweredByGemini')}</span>
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


// ── Live sector flow derivation from capital-flows ETF data ──────────────────
interface SectorReturn { id: string; label: string; flag: string; ticker: string; ret1w: number; ret4w: number; ret13w: number; }

const SECTOR_META: Record<string, { sectorEn: string; sectorKo: string; movers: string[] }> = {
  XLK:  { sectorEn: 'Technology (AI)',   sectorKo: 'AI 테크',       movers: ['NVDA', 'MSFT', 'META'] },
  XLF:  { sectorEn: 'Financials',        sectorKo: '금융',           movers: ['JPM', 'BAC', 'GS'] },
  XLE:  { sectorEn: 'Energy (Oil/Gas)',  sectorKo: '에너지 (원유)',   movers: ['XOM', 'CVX', 'SLB'] },
  XLV:  { sectorEn: 'Healthcare/Pharma', sectorKo: '헬스케어',       movers: ['UNH', 'LLY', 'ABBV'] },
  XLI:  { sectorEn: 'Industrials',       sectorKo: '산업재',         movers: ['CAT', 'GE', 'HON'] },
  XLB:  { sectorEn: 'Materials',         sectorKo: '소재',           movers: ['FCX', 'NEM', 'ALB'] },
  XLY:  { sectorEn: 'Consumer Disc.',    sectorKo: '경기소비재',     movers: ['AMZN', 'TSLA', 'MCD'] },
  XLP:  { sectorEn: 'Consumer Staples',  sectorKo: '필수소비재',     movers: ['PG', 'KO', 'WMT'] },
  XLU:  { sectorEn: 'Utilities',         sectorKo: '유틸리티',       movers: ['NEE', 'DUK', 'SO'] },
  XLRE: { sectorEn: 'Real Estate (REIT)',sectorKo: '부동산 (리츠)',  movers: ['AMT', 'PLD', 'SPG'] },
  XLC:  { sectorEn: 'Comm. Services',    sectorKo: '통신 서비스',    movers: ['GOOGL', 'META', 'NFLX'] },
};

function deriveSectorFlows(sectors: SectorReturn[]): MoneyFlowSector[] {
  const sinceDate = new Date(Date.now() - 28 * 86400_000).toISOString().slice(0, 10);
  return sectors
    .filter(s => Math.abs(s.ret4w) > 0.3 && SECTOR_META[s.ticker])
    .map(s => {
      const meta = SECTOR_META[s.ticker];
      const direction: 'inflow' | 'outflow' = s.ret4w >= 0 ? 'inflow' : 'outflow';
      const absRet = Math.abs(s.ret4w);
      const magnitude = absRet < 1 ? 1 : absRet < 2 ? 2 : absRet < 4 ? 3 : absRet < 7 ? 4 : 5;
      const signal: 'accelerating' | 'holding' | 'fading' =
        direction === 'inflow'
          ? (s.ret1w > absRet * 0.25 ? 'accelerating' : s.ret1w < 0 ? 'fading' : 'holding')
          : (s.ret1w < -(absRet * 0.25) ? 'accelerating' : s.ret1w > 0 ? 'fading' : 'holding');
      const sign = (n: number) => (n >= 0 ? '+' : '');
      return {
        sector: meta.sectorEn,
        sectorKo: meta.sectorKo,
        direction,
        magnitude,
        topMovers: meta.movers.map(tk => ({ ticker: tk, action: direction === 'inflow' ? '↑' : '↓' })),
        reason: `${s.ticker} ${sign(s.ret4w)}${s.ret4w.toFixed(1)}% 4W · 1W: ${sign(s.ret1w)}${s.ret1w.toFixed(1)}%`,
        sinceDate,
        signal,
      } satisfies MoneyFlowSector;
    });
}

// ── Lazily-loaded tab chunks ─────────────────────────────────────────────────
const CapitalFlowsTab = dynamic(() => import('@/components/intelligence/CapitalFlowsTab'), { ssr: false });
const MacroIndicatorsTab = dynamic(() => import('@/components/intelligence/MacroIndicatorsTab'), { ssr: false });
const CreditBalanceTab = dynamic(() => import('@/components/intelligence/CreditBalanceTab'), { ssr: false });
const NewsCascadeTab = dynamic(() => import('@/components/intelligence/NewsCascadeTab'), { ssr: false });
const CotTab = dynamic(() => import('@/components/intelligence/CotTab'), { ssr: false });
// ── Main Page ─────────────────────────────────────────────────────────────────
const TABS = ['capital', 'macro', 'flows', 'fear-greed', 'credit', 'narratives', 'news', 'cot'] as const;
type Tab = typeof TABS[number];

interface LiveFGData {
  byCountry: FearGreedEntryExtended[];
  byAsset: FearGreedEntryExtended[];
  source?: 'live' | 'static';
  updatedAt: string;
}

export default function IntelligencePage() {
  const t = useTranslations('intelligence');
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') ?? 'capital') as Tab;
  const [activeTab, setActiveTab] = useState<Tab>(TABS.includes(initialTab) ? initialTab : 'capital');
  const [chatOpen, setChatOpen] = useState(false);

  // Live Fear & Greed data from API
  const [fgData, setFgData] = useState<LiveFGData | null>(null);
  const [fgLoading, setFgLoading] = useState(false);

  // Live 13F signals and ETF sector performance for flows tab
  const [liveSignals, setLiveSignals] = useState<InstitutionalSignal[] | null>(null);
  const [liveCapSectors, setLiveCapSectors] = useState<SectorReturn[] | null>(null);

  useEffect(() => {
    if (activeTab !== 'fear-greed' || fgData) return;
    const controller = new AbortController();
    setFgLoading(true);
    fetch('/api/fear-greed', { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { if (!controller.signal.aborted) setFgData(d); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setFgLoading(false); });
    return () => controller.abort();
  }, [activeTab, fgData]);

  useEffect(() => {
    if (activeTab !== 'flows' || liveSignals !== null) return;
    const controller = new AbortController();
    const { signal } = controller;
    fetch('/api/signals', { signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { if (!signal.aborted) setLiveSignals(d.signals ?? []); })
      .catch(() => { if (!signal.aborted) setLiveSignals([]); });
    fetch('/api/capital-flows', { signal })
      .then(r => r.json())
      .then(d => { if (!signal.aborted) setLiveCapSectors(d.sectorPerformance ?? null); })
      .catch(() => {});
    return () => controller.abort();
  }, [activeTab, liveSignals]);

  const liveSectorFlows = useMemo(() => {
    if (!liveSignals?.length) return [];
    const SECTOR_KO: Record<string, string> = {
      'semiconductors': t('sectorSemiconductors'),
      'ai-cloud': t('sectorAiCloud'),
      'ev-battery': t('sectorEvBattery'),
      'defense': t('sectorDefense'),
      'financials': t('sectorFinancials'),
      'materials': t('sectorMaterials'),
      'pharma-biotech': t('sectorPharmaBiotech'),
    };
    const byS: Record<string, { buys: number; sells: number; tickers: Set<string> }> = {};
    for (const s of liveSignals) {
      if (!s.sector) continue;
      if (!byS[s.sector]) byS[s.sector] = { buys: 0, sells: 0, tickers: new Set() };
      if (s.action === 'accumulating' || s.action === 'new_position') byS[s.sector].buys++;
      else byS[s.sector].sells++;
      byS[s.sector].tickers.add(s.ticker);
    }
    return Object.entries(byS)
      .map(([sector, d]) => ({
        sector, ko: SECTOR_KO[sector] ?? sector,
        buys: d.buys, sells: d.sells, net: d.buys - d.sells,
        tickers: Array.from(d.tickers).slice(0, 4),
      }))
      .sort((a, b) => b.net - a.net);
  }, [liveSignals]);

  const liveCountry = (fgData?.byCountry ?? fearGreedByCountry) as FearGreedEntryExtended[];
  const liveAsset = (fgData?.byAsset ?? fearGreedByAsset) as FearGreedEntryExtended[];

  const tabConfig: Record<Tab, { label: string; icon: React.ReactNode }> = {
    'capital':     { label: t('tabCapital'),    icon: <GitMerge className="w-4 h-4" /> },
    'macro':       { label: t('tabMacro'),      icon: <TrendingUp className="w-4 h-4" /> },
    'flows':       { label: t('tabFlows'),      icon: <Activity className="w-4 h-4" /> },
    'fear-greed':  { label: 'Fear & Greed',    icon: <BarChart3 className="w-4 h-4" /> },
    'credit':      { label: t('tabCredit'),     icon: <TrendingDown className="w-4 h-4" /> },
    'narratives':  { label: t('tabNarratives'), icon: <Brain className="w-4 h-4" /> },
    'news':        { label: t('tabNews'),       icon: <Zap className="w-4 h-4" /> },
    'cot':         { label: t('tabCot'),        icon: <BarChart3 className="w-4 h-4" /> },
  };

  // Live ETF-derived sector flows — falls back to static when capital-flows not yet fetched
  const activeSectorFlows = useMemo(
    () => liveCapSectors ? deriveSectorFlows(liveCapSectors) : moneyFlowSectors,
    [liveCapSectors]
  );
  const inflows = activeSectorFlows.filter(f => f.direction === 'inflow').sort((a, b) => b.magnitude - a.magnitude);
  const outflows = activeSectorFlows.filter(f => f.direction === 'outflow').sort((a, b) => b.magnitude - a.magnitude);

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
        {/* Outer div provides rounded clip; inner div handles horizontal scroll so border-radius
            doesn't clip the last tab's text when scrolled to the edge. */}
        <div className="bg-gray-100 rounded-xl overflow-hidden">
          <div className="flex gap-1 p-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
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
        </div>

        {/* Tab: 자금 흐름 지도 */}
        {activeTab === 'capital' && <CapitalFlowsTab />}

        {/* Tab: 매크로 지표 */}
        {activeTab === 'macro' && <MacroIndicatorsTab />}

        {/* Tab: 비밀 머니 흐름 */}
        {activeTab === 'flows' && (
          <div className="space-y-6">
            {/* Live 13F sector pulse */}
            {liveSectorFlows.length > 0 && (
              <div>
                <h2 className="text-base font-heading font-bold text-cf-text-primary mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cf-primary" />
                  {t('sectorSignalsTitle')}
                  <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">{t('liveLabel')}</span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {liveSectorFlows.map(f => (
                    <div key={f.sector} className={`rounded-xl border p-3 flex items-center gap-3 ${f.net > 0 ? 'border-green-200 bg-green-50/40' : f.net < 0 ? 'border-red-200 bg-red-50/40' : 'border-gray-200 bg-gray-50/40'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${f.net > 0 ? 'bg-green-100 text-green-700' : f.net < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                            {f.net > 0 ? t('netBuy') : f.net < 0 ? t('netSell') : t('neutralSignal')}
                          </span>
                          <span className="text-xs font-bold text-cf-text-primary truncate">{f.ko}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-cf-text-secondary">
                          <span className="text-green-600">↑{f.buys}</span>
                          <span className="text-red-600">↓{f.sells}</span>
                          <span className="text-cf-text-secondary/60">|</span>
                          {f.tickers.map(tk => (
                            <Link key={tk} href={`/company/${tk}`} className="font-mono text-cf-primary hover:underline">{tk}</Link>
                          ))}
                        </div>
                      </div>
                      <div className={`text-lg font-black tabular-nums ${f.net > 0 ? 'text-green-600' : f.net < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        {f.net > 0 ? '+' : ''}{f.net}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-cf-text-secondary mt-2">
                  {t('sectorSignalsSource')}
                </p>
              </div>
            )}
            {liveSignals === null && (
              <div className="flex items-center gap-2 text-cf-text-secondary text-xs py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('loadingSignals')}
              </div>
            )}

            {/* ETF sector flows — live when capital-flows loaded, static fallback otherwise */}
            {!liveCapSectors && (
              <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                <span>⚠️</span>
                <span>{t('flowsStaticBanner')}</span>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h2 className="text-base font-heading font-bold text-green-700 mb-3 flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4" />
                  {t('smartMoneyInflow')}
                  {liveCapSectors && <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">{t('liveLabel')}</span>}
                </h2>
                <div className="space-y-3">
                  {inflows.map((f) => <MoneyFlowRow key={f.sector} flow={f} />)}
                </div>
              </div>
              <div>
                <h2 className="text-base font-heading font-bold text-red-700 mb-3 flex items-center gap-2">
                  <ArrowDownRight className="w-4 h-4" />
                  {t('smartMoneyOutflow')}
                </h2>
                <div className="space-y-3">
                  {outflows.map((f) => <MoneyFlowRow key={f.sector} flow={f} />)}
                </div>
              </div>
            </div>
            <p className="text-xs text-cf-text-secondary text-center">
              {t('editorialContext')}
            </p>
          </div>
        )}

        {/* Tab: Fear & Greed */}
        {activeTab === 'fear-greed' && (
          <div className="space-y-8">
            {fgLoading && (
              <div className="flex items-center justify-center gap-2 py-8 text-cf-text-secondary">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">{t('loadingMarketData')}</span>
              </div>
            )}
            {!fgLoading && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-lg font-heading font-bold text-cf-text-primary flex items-center gap-2">
                      <Globe className="w-5 h-5 text-cf-primary" />
                      {t('fgByCountryTitle')}
                    </h2>
                    {fgData?.updatedAt && (
                      <span className="text-[11px] text-cf-text-secondary">
                        {new Date(fgData.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} {t('fgUpdatedLabel')}
                      </span>
                    )}
                  </div>
                  {(!fgData || fgData.source === 'static') && (
                    <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                      <span>⚠️</span>
                      <span>{t('fgStaticBanner')}</span>
                    </div>
                  )}
                  <p className="text-xs text-cf-text-secondary mb-4">
                    {fgData && fgData.source !== 'static' ? t('fgMethodologyLabel') : t('fgScaleLabel')}
                    {fgData && fgData.source !== 'static' ? ' · ' + t('fgScaleLabel') : ''}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {liveCountry.map((e) => <FearGreedCard key={e.id} entry={e} />)}
                  </div>
                </div>

                <div>
                  <h2 className="text-lg font-heading font-bold text-cf-text-primary mb-1 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-cf-primary" />
                    {t('fgByAssetTitle')}
                  </h2>
                  <p className="text-xs text-cf-text-secondary mb-4">{t('fgByAssetDesc')}</p>
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

        {activeTab === 'narratives' && <NarrativesTab t={t} />}

        {/* Tab: 뉴스 Cascade */}
        {activeTab === 'news' && <NewsCascadeTab />}

        {/* Tab: CFTC COT 포지션 */}
        {activeTab === 'cot' && <CotTab />}
      </div>

      {/* Floating AI Chat Button */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {chatOpen && (
          <div className="w-[340px] sm:w-[400px] max-h-[520px] flex flex-col rounded-2xl shadow-2xl border border-cf-border bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-cf-primary text-white">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4" />
                <span className="text-sm font-semibold">{t('flowviumAi')}</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-white/70 hover:text-white text-lg leading-none">×</button>
            </div>
            <AiChat t={t} flowSectors={activeSectorFlows} />
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
