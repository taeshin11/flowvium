'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { sectors } from '@/data/sectors';
import { type InstitutionalSignal } from '@/data/institutional-signals';
import {
  ArrowRight,
  Network,
  TrendingUp,
  Layers,
  Newspaper,
  Cpu,
  Cloud,
  Zap,
  Shield,
  FlaskConical,
  Users,
  BarChart3,
  Globe,
  Plus,
  LogOut,
  TrendingDown,
  Landmark,
  Flame,
  Heart,
  Factory,
  Radio,
  Building2,
  Gem,
  ShoppingBag,
  Monitor,
  ShoppingCart,
  GitCompare,
  Search,
  X,
  Radar,
  Activity,
  Brain,
  GitMerge,
  Satellite,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import EmailCTA from '@/components/EmailCTA';
import LiveFeed from '@/components/LiveFeed';
import { useRouter } from '@/i18n/routing';
import { companyNamesI18n } from '@/data/company-names-i18n';
import { UNIVERSE_COUNT } from '@/data/universe-count';
import { UNIVERSE_SEARCH } from '@/data/universe-search';
import { getLevel, levelLabels } from '@/data/fear-greed';
import Sparkline from '@/components/Sparkline';
import { getUpcomingEvents, daysUntil } from '@/data/econ-calendar';

// 2026-06-03: 검색을 전체 모니터링 유니버스(1210)로 확장 — allCompanies(프로필 ~637)만 검색하던
//   "616개" 불일치 해소. /company/[ticker] 는 임의 ticker 라이브 동작.
const searchCompanies = UNIVERSE_SEARCH;

// Live market snapshot strip — SPY / QQQ / BTC / VIX + macro row (10Y / DXY / Gold)
interface SnapPill { price: number | null; changePct: number | null; currency: string; }
const SNAPSHOT_TICKERS = ['SPY', 'QQQ', 'BTC-USD', '^VIX'];
const MACRO_TICKERS = ['^TNX', 'DX-Y.NYB', 'GC=F'];
const SNAPSHOT_REFRESH_MS = 60_000;
const TICKER_CONFIG: Record<string, { label: string; decimals: number; prefix: string; suffix: string; invertColor?: boolean }> = {
  'SPY':       { label: 'S&P',  decimals: 2, prefix: '$', suffix: '' },
  'QQQ':       { label: 'NDX',  decimals: 2, prefix: '$', suffix: '' },
  'BTC-USD':   { label: 'BTC',  decimals: 0, prefix: '$', suffix: '' },
  '^VIX':      { label: 'VIX',  decimals: 2, prefix: '',  suffix: '', invertColor: true },
  '^TNX':      { label: '10Y',  decimals: 2, prefix: '',  suffix: '%' },
  'DX-Y.NYB':  { label: 'DXY',  decimals: 1, prefix: '',  suffix: '' },
  'GC=F':      { label: 'Gold', decimals: 0, prefix: '$', suffix: '' },
};

function MarketSnapshot() {
  const t = useTranslations('home');
  const [pills, setPills] = useState<Map<string, SnapPill>>(new Map());
  const [fgScore, setFgScore] = useState<number | null>(null);
  const [fgHistory, setFgHistory] = useState<number[] | null>(null);
  const [riskSignal, setRiskSignal] = useState<'risk-on' | 'neutral' | 'risk-off' | null>(null);
  const [regimeSignal, setRegimeSignal] = useState<'recession' | 'stagflation' | 'overheating' | 'goldilocks' | 'slowdown' | null>(null);
  const [breadth, setBreadth] = useState<{ adv: number; dec: number; unc: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPills = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const allTickers = [...SNAPSHOT_TICKERS, ...MACRO_TICKERS];
    Promise.allSettled([
      // 7 individual stock-price calls → 1 batch call (Yahoo v7 batch under the hood)
      fetch(`/api/batch-prices?tickers=${allTickers.join(',')}`, { signal: controller.signal, cache: 'no-store' })
        .then(r => { if (!r.ok) throw new Error(); return r.json(); })
        .then((d: { prices: Record<string, { price: number | null; changePct: number | null }> }) => ({
          ticker: '__batch__', prices: d.prices,
        })),
      fetch('/api/fear-greed', { signal: controller.signal })
        .then(r => { if (!r.ok) throw new Error(); return r.json(); })
        .then(d => {
          const us = d.byCountry?.find((c: { id: string }) => c.id === 'us') as { score?: number; history?: Array<{score: number}> } | undefined;
          return { ticker: '__fg__', score: us?.score ?? null, history: us?.history ?? null };
        }),
    ]).then(results => {
      if (controller.signal.aborted) return;
      const map = new Map<string, SnapPill>();
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const val = r.value as { ticker: string; prices?: Record<string, { price: number | null; changePct: number | null }>; price?: number | null; changePct?: number | null; score?: number | null };
        if (val.ticker === '__fg__') {
          if (val.score != null) setFgScore(val.score);
          const hist = (val as { history?: Array<{score: number}> }).history;
          if (Array.isArray(hist) && hist.length >= 2) setFgHistory(hist.map(h => h.score));
        } else if (val.ticker === '__batch__' && val.prices) {
          for (const t of allTickers) {
            const entry = val.prices[t];
            if (entry?.price != null) {
              map.set(t, { price: entry.price, changePct: entry.changePct ?? null, currency: 'USD' });
            }
          }
        }
      }
      setPills(map);
    });
  }, []);

  useEffect(() => {
    fetchPills();
    const iv = setInterval(fetchPills, SNAPSHOT_REFRESH_MS);
    return () => {
      clearInterval(iv);
      abortRef.current?.abort();
    };
  }, [fetchPills]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/macro-indicators', { signal: ctrl.signal, cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (ctrl.signal.aborted) return;
        const inds: Array<{ id: string; actual?: number | null }> = d.indicators ?? [];
        const ig = inds.find(x => x.id === 'ig_spread')?.actual ?? null;
        const hy = inds.find(x => x.id === 'hy_spread')?.actual ?? null;
        const umc = inds.find(x => x.id === 'umcsent')?.actual ?? null;
        const inverted = d.yieldCurve?.inverted ?? false;
        const riskOff = (hy != null && hy > 5.0) || (ig != null && ig > 1.5) ||
                        (inverted && hy != null && hy > 4.0) || (umc != null && umc < 50);
        const riskOn = (hy != null && hy < 3.5) && (ig != null && ig < 1.0) &&
                       !inverted && (umc != null && umc > 60);
        setRiskSignal(riskOff ? 'risk-off' : riskOn ? 'risk-on' : 'neutral');
        const gdp = inds.find(x => x.id === 'gdp')?.actual ?? null;
        const cpi = inds.find(x => x.id === 'cpi')?.actual ?? null;
        if (gdp !== null && cpi !== null) {
          setRegimeSignal(
            gdp < 0        ? 'recession'   :
            gdp < 1.5 && cpi > 2.5 ? 'stagflation'  :
            gdp >= 1.5 && cpi > 2.5 ? 'overheating'  :
            gdp >= 1.5 && cpi <= 2.5 ? 'goldilocks'   :
            'slowdown'
          );
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/market-movers', { signal: ctrl.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d || ctrl.signal.aborted) return;
        if (d.advancers != null && d.decliners != null) {
          setBreadth({ adv: d.advancers, dec: d.decliners, unc: d.unchanged ?? 0 });
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  if (pills.size === 0) return null;

  return (
    <div className="border-y border-cf-border/60 bg-cf-bg/80 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-2.5">
        <div className="flex items-center gap-6 overflow-x-auto scrollbar-hide">
          {[...SNAPSHOT_TICKERS, ...MACRO_TICKERS].map((ticker, i) => {
            const p = pills.get(ticker);
            if (!p?.price) return null;
            const cfg = TICKER_CONFIG[ticker];
            const up = (p.changePct ?? 0) >= 0;
            const addSep = i === SNAPSHOT_TICKERS.length;
            return (
              <div key={ticker} className={`flex items-center gap-1.5 flex-shrink-0${addSep ? ' border-l border-cf-border/40 pl-6' : ''}`}>
                <span className="text-xs font-semibold text-cf-text-secondary uppercase tracking-wide">{cfg?.label ?? ticker}</span>
                <span className="text-sm font-mono font-bold text-cf-text-primary">
                  {cfg?.prefix ?? ''}{p.price.toFixed(cfg?.decimals ?? 2)}{cfg?.suffix ?? ''}
                </span>
                {p.changePct != null && (
                  <span className={`text-xs font-mono font-semibold px-1 py-0.5 rounded ${
                    cfg?.invertColor
                      ? (up ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50')
                      : (up ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50')
                  }`}>
                    {up ? '+' : ''}{p.changePct.toFixed(2)}%
                  </span>
                )}
              </div>
            );
          })}
          {fgScore != null && (() => {
            const lvl = getLevel(fgScore);
            const meta = levelLabels[lvl];
            return (
              <div className="flex items-center gap-1.5 flex-shrink-0 border-l border-cf-border/40 pl-6">
                <span className="text-xs font-semibold text-cf-text-secondary uppercase tracking-wide">F&amp;G</span>
                <span className={`text-xs font-mono font-semibold px-1 py-0.5 rounded ${meta.color} ${meta.bg}`}>
                  {fgScore}
                </span>
                {fgHistory && <Sparkline values={fgHistory} width={44} height={14} stroke={1} />}
              </div>
            );
          })()}
          {riskSignal && (
            <div className="flex items-center gap-1.5 flex-shrink-0 border-l border-cf-border/40 pl-6">
              <span className="text-xs font-semibold text-cf-text-secondary uppercase tracking-wide">RISK</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                riskSignal === 'risk-on' ? 'text-green-700 bg-green-100' :
                riskSignal === 'risk-off' ? 'text-red-700 bg-red-100' :
                'text-gray-600 bg-gray-100'
              }`}>
                {riskSignal === 'risk-on' ? `🟢 ${t('snapshotRiskOn')}` : riskSignal === 'risk-off' ? `🔴 ${t('snapshotRiskOff')}` : `⚪ ${t('snapshotNeutral')}`}
              </span>
            </div>
          )}
          {regimeSignal && (
            <div className="flex items-center gap-1.5 flex-shrink-0 border-l border-cf-border/40 pl-6">
              <span className="text-xs font-semibold text-cf-text-secondary uppercase tracking-wide">CYCLE</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                regimeSignal === 'recession'   ? 'text-purple-700 bg-purple-100' :
                regimeSignal === 'stagflation' ? 'text-orange-700 bg-orange-100' :
                regimeSignal === 'overheating' ? 'text-red-700 bg-red-100' :
                regimeSignal === 'goldilocks'  ? 'text-green-700 bg-green-100' :
                'text-yellow-700 bg-yellow-100'
              }`}>
                {regimeSignal === 'recession'   ? t('snapshotRecession')   :
                 regimeSignal === 'stagflation' ? t('snapshotStagflation') :
                 regimeSignal === 'overheating' ? t('snapshotOverheating') :
                 regimeSignal === 'goldilocks'  ? t('snapshotGoldilocks')  :
                 t('snapshotSlowdown')}
              </span>
            </div>
          )}
          {breadth && (
            <div className="flex items-center gap-1.5 flex-shrink-0 border-l border-cf-border/40 pl-6">
              <span className="text-xs font-semibold text-cf-text-secondary uppercase tracking-wide">BREADTH</span>
              <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded ${
                breadth.adv > breadth.dec ? 'text-green-700 bg-green-50' :
                breadth.dec > breadth.adv ? 'text-red-700 bg-red-50' :
                'text-gray-600 bg-gray-100'
              }`}>
                {breadth.adv}↑ {breadth.dec}↓
              </span>
            </div>
          )}
          {(() => {
            const today = new Date();
            const next = getUpcomingEvents(today, 1).find(e => e.impact === 'high');
            if (!next) return null;
            const days = daysUntil(next.date, today);
            const urgentCls = days <= 1 ? 'text-red-700 bg-red-50 border-red-200' :
                              days <= 3 ? 'text-orange-700 bg-orange-50 border-orange-200' :
                                          'text-slate-600 bg-slate-50 border-slate-200';
            return (
              <div className="flex items-center gap-1.5 flex-shrink-0 border-l border-cf-border/40 pl-6">
                <span className="text-xs font-semibold text-cf-text-secondary uppercase tracking-wide">NEXT</span>
                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded border ${urgentCls}`}>
                  {next.category} D-{days}
                </span>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function HeroSearch() {
  const router = useRouter();
  const tHome = useTranslations('home');
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    if (query.trim().length === 0) return [];
    const q = query.toLowerCase();
    return searchCompanies.filter((c) => {
      if (c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)) return true;
      const loc = companyNamesI18n[c.ticker];
      return loc?.some((n) => n.toLowerCase().includes(q)) ?? false;
    }).slice(0, 8);
  }, [query]);

  const handleSelect = useCallback((ticker: string) => {
    setQuery('');
    router.push(`/company/${ticker}`);
  }, [router]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filtered.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((p) => (p < filtered.length - 1 ? p + 1 : 0)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((p) => (p > 0 ? p - 1 : filtered.length - 1)); }
    if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); handleSelect(filtered[activeIndex].ticker); }
    if (e.key === 'Enter' && activeIndex < 0 && filtered.length > 0) { e.preventDefault(); handleSelect(filtered[0].ticker); }
  };

  useEffect(() => { setActiveIndex(-1); }, [query]);

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      (listRef.current.children[activeIndex] as HTMLElement)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  return (
    <div className="relative w-full max-w-md mt-6">
      <p className="text-xs font-semibold text-cf-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Search className="w-3.5 h-3.5" />
        {tHome('companySearchLabel', { count: searchCompanies.length })}
      </p>
      <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-white border border-cf-border shadow-md focus-within:border-cf-primary focus-within:shadow-lg transition-all">
        <Search className="w-4 h-4 text-cf-primary flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tHome('companySearchPlaceholder')}
          className="flex-1 text-sm outline-none text-cf-text-primary placeholder:text-cf-text-secondary/60 bg-transparent"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-cf-text-secondary hover:text-cf-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {filtered.length > 0 && (
        <ul
          ref={listRef}
          className="absolute top-full mt-1.5 left-0 right-0 bg-white rounded-xl border border-cf-border shadow-xl z-50 max-h-64 overflow-y-auto"
        >
          {filtered.map((c, i) => (
            <li
              key={c.ticker}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => handleSelect(c.ticker)}
              className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                i === activeIndex ? 'bg-cf-primary/5' : 'hover:bg-gray-50'
              }`}
            >
              <div>
                <p className="text-sm font-medium text-cf-text-primary">{c.name}</p>
                <p className="text-xs text-cf-text-secondary capitalize">{c.sector?.replace(/-/g, ' ')}</p>
              </div>
              <span className="text-xs font-mono font-bold text-cf-primary bg-cf-primary/10 px-2.5 py-1 rounded-lg">
                {c.ticker}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const sectorIcons: Record<string, React.ReactNode> = {
  Cpu: <Cpu className="w-6 h-6" />,
  Cloud: <Cloud className="w-6 h-6" />,
  Battery: <Zap className="w-6 h-6" />,
  Shield: <Shield className="w-6 h-6" />,
  FlaskConical: <FlaskConical className="w-6 h-6" />,
  Zap: <Zap className="w-6 h-6" />,
  Landmark: <Landmark className="w-6 h-6" />,
  Flame: <Flame className="w-6 h-6" />,
  Heart: <Heart className="w-6 h-6" />,
  Factory: <Factory className="w-6 h-6" />,
  Radio: <Radio className="w-6 h-6" />,
  Building2: <Building2 className="w-6 h-6" />,
  Gem: <Gem className="w-6 h-6" />,
  ShoppingBag: <ShoppingBag className="w-6 h-6" />,
  Monitor: <Monitor className="w-6 h-6" />,
  ShoppingCart: <ShoppingCart className="w-6 h-6" />,
};

const actionIcons: Record<string, React.ReactNode> = {
  accumulating: <TrendingUp className="w-3.5 h-3.5" />,
  reducing: <TrendingDown className="w-3.5 h-3.5" />,
  new_position: <Plus className="w-3.5 h-3.5" />,
  exit: <LogOut className="w-3.5 h-3.5" />,
};

const actionColors: Record<string, string> = {
  accumulating: 'text-green-600 bg-green-50',
  reducing: 'text-red-600 bg-red-50',
  new_position: 'text-blue-600 bg-blue-50',
  exit: 'text-orange-600 bg-orange-50',
};

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

// Cascade animation: nodes light up in sequence, then ripple outward
// ── AI Daily Brief ─────────────────────────────────────────────────────────────
type Timeframe = '1w' | '4w' | '13w';
interface BriefSection { title: string; content: string; bullets: string[]; }
interface DailyBrief {
  market: BriefSection;
  capital: BriefSection;
  company: BriefSection;
  signals?: BriefSection;
  outlook: string;
  riskLevel?: 'low' | 'medium' | 'high';
  generatedAt: string;
  tf: Timeframe;
  cached?: boolean;
}

const SECTION_META = [
  { key: 'market' as const, icon: '📊', gradient: 'from-blue-600/20 to-blue-500/5', border: 'border-blue-500/30', accent: 'text-blue-400', dot: 'bg-blue-400' },
  { key: 'capital' as const, icon: '💰', gradient: 'from-violet-600/20 to-violet-500/5', border: 'border-violet-500/30', accent: 'text-violet-400', dot: 'bg-violet-400' },
  { key: 'company' as const, icon: '🏢', gradient: 'from-emerald-600/20 to-emerald-500/5', border: 'border-emerald-500/30', accent: 'text-emerald-400', dot: 'bg-emerald-400' },
  { key: 'signals' as const, icon: '🔍', gradient: 'from-amber-600/20 to-amber-500/5', border: 'border-amber-500/30', accent: 'text-amber-400', dot: 'bg-amber-400' },
];

const RISK_STYLE = {
  low:    { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  medium: { color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/30' },
  high:   { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30' },
};

const BRIEF_TITLE_KEY: Record<string, 'briefMarket' | 'briefCapital' | 'briefCompany' | 'briefSignals'> = {
  market: 'briefMarket', capital: 'briefCapital', company: 'briefCompany', signals: 'briefSignals',
};

function AIDailyBrief() {
  const locale = useLocale();
  const tHome = useTranslations('home');
  const [tf, setTf] = useState<Timeframe>('4w');
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setBrief(null);
    fetch(`/api/daily-brief?tf=${tf}`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: DailyBrief) => { if (!controller.signal.aborted) setBrief(data); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tf]);

  const tfBtns: { key: Timeframe; label: string }[] = [
    { key: '1w', label: tHome('tf1w') },
    { key: '4w', label: tHome('tf4w') },
    { key: '13w', label: tHome('tf13w') },
  ];

  const riskKey = (brief?.riskLevel ?? 'medium') as 'low' | 'medium' | 'high';
  const risk = RISK_STYLE[riskKey];

  const genTime = brief?.generatedAt
    ? new Date(new Date(brief.generatedAt).getTime() + 9 * 3600000)
        .toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }) + ' KST'
    : null;

  return (
    <div id="ai-daily-brief" className="relative overflow-hidden border-b border-white/5 bg-[#080c14]">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/4 top-0 h-48 w-48 -translate-y-1/2 rounded-full bg-amber-500/5 blur-3xl" />
        <div className="absolute right-1/4 bottom-0 h-48 w-48 translate-y-1/2 rounded-full bg-blue-500/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            {/* Live dot + label */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-400" />
              </span>
              <span className="text-amber-400 text-[11px] font-bold tracking-widest uppercase">AI Daily Brief</span>
            </div>

            {/* Risk badge */}
            {brief && (
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${risk.bg} ${risk.color}`}>
                {tHome('riskLabel', { level: tHome(`risk${riskKey.charAt(0).toUpperCase() + riskKey.slice(1)}` as 'riskLow' | 'riskMedium' | 'riskHigh') })}
              </span>
            )}

            {/* Generation time */}
            {genTime && (
              <span className="hidden sm:inline text-[11px] text-slate-500">{tHome('generatedAt', { time: genTime })}</span>
            )}
          </div>

          {/* Timeframe toggle */}
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            {tfBtns.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTf(key)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                  tf === key
                    ? 'bg-amber-400 text-slate-900 shadow-lg shadow-amber-400/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl bg-white/8 animate-pulse border border-white/10" style={{ height: 120 }}>
                  <div className="p-3 space-y-2">
                    <div className="h-3 bg-white/10 rounded w-2/3" />
                    <div className="h-2 bg-white/8 rounded w-full" />
                    <div className="h-2 bg-white/8 rounded w-4/5" />
                    <div className="h-2 bg-white/8 rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
            <div className="h-8 bg-white/5 rounded-xl animate-pulse" />
          </div>
        )}

        {/* Cards */}
        {!loading && brief && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {SECTION_META.map(({ key, icon, gradient, border, accent, dot }) => {
                const sec = brief[key];
                if (!sec) return null;
                const isOpen = expandedKey === key;
                return (
                  <div
                    key={key}
                    onClick={() => setExpandedKey(isOpen ? null : key)}
                    className={`relative overflow-hidden rounded-2xl border ${border} bg-gradient-to-br ${gradient} cursor-pointer
                               transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/20`}
                  >
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-base leading-none">{icon}</span>
                          <span className={`text-[11px] font-bold uppercase tracking-wide ${accent}`}>
                            {BRIEF_TITLE_KEY[key] ? tHome(BRIEF_TITLE_KEY[key]) : sec.title}
                          </span>
                        </div>
                        <ArrowRight className={`w-3 h-3 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed line-clamp-3">{sec.content}</p>

                      {isOpen && (
                        <ul className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
                          {sec.bullets.map((b, j) => (
                            <li key={j} className="flex items-start gap-1.5 text-[11px] text-slate-400">
                              <span className={`mt-1 w-1 h-1 rounded-full flex-shrink-0 ${dot}`} />
                              {b}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Outlook bar */}
            <div className="mt-4 flex items-start gap-3 px-4 py-3 rounded-xl bg-white/3 border border-white/8">
              <span className="text-amber-400 text-sm mt-0.5">⚡</span>
              <div>
                <span className="text-[11px] font-bold text-amber-400 mr-2">{tHome('aiOutlook')}</span>
                <span className="text-[11px] text-slate-400">{brief.outlook}</span>
              </div>
              {genTime && (
                <span className="sm:hidden ml-auto text-[10px] text-slate-600 flex-shrink-0">{genTime}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const CASCADE_STEPS = [
  ['NVDA'],                   // step 0 — leader ignites
  ['TSM', 'MSFT'],            // step 1
  ['AMD', 'GOOGL'],           // step 2
  ['SMCI', 'ASML'],           // step 3
];
const MINI_NODES = [
  { id: 'NVDA', x: 200, y: 115, r: 28, color: '#4F8FBF', label: 'NVDA' },
  { id: 'TSM',  x: 82,  y: 78,  r: 22, color: '#6366f1', label: 'TSM'  },
  { id: 'MSFT', x: 318, y: 60,  r: 26, color: '#3b82f6', label: 'MSFT' },
  { id: 'AMD',  x: 118, y: 195, r: 18, color: '#6366f1', label: 'AMD'  },
  { id: 'SMCI', x: 300, y: 188, r: 14, color: '#6366f1', label: 'SMCI' },
  { id: 'GOOGL',x: 372, y: 142, r: 24, color: '#3b82f6', label: 'GOOGL'},
  { id: 'ASML', x: 50,  y: 168, r: 16, color: '#8b5cf6', label: 'ASML' },
];
const MINI_LINKS = [
  { from: 'TSM',  to: 'NVDA' },
  { from: 'NVDA', to: 'MSFT' },
  { from: 'TSM',  to: 'AMD'  },
  { from: 'NVDA', to: 'SMCI' },
  { from: 'NVDA', to: 'GOOGL'},
  { from: 'ASML', to: 'TSM'  },
  { from: 'AMD',  to: 'MSFT' },
];
const MINI_NODE_MAP = Object.fromEntries(MINI_NODES.map((n) => [n.id, n]));
const STEP_MS = 500;
const HOLD_MS = 1200;
const FADE_MS = 800;

function MiniGraph() {
  const [mounted, setMounted] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;

    function advance() {
      if (step < CASCADE_STEPS.length) {
        setActiveStep(step);
        step++;
        timer = setTimeout(advance, STEP_MS);
      } else {
        // hold then fade
        timer = setTimeout(() => {
          setActiveStep(-1);
          step = 0;
          timer = setTimeout(advance, FADE_MS + 400);
        }, HOLD_MS);
      }
    }

    timer = setTimeout(advance, 600);
    return () => clearTimeout(timer);
  }, [mounted]);

  if (!mounted) return <div className="w-full h-64 bg-cf-border/30 rounded-xl animate-pulse" />;

  // Which nodes are "lit" (all steps up to and including activeStep)
  const litIds = new Set<string>(
    activeStep >= 0
      ? CASCADE_STEPS.slice(0, activeStep + 1).flat()
      : []
  );
  // Which links are "active" (both endpoints lit)
  const isLinkActive = (from: string, to: string) => litIds.has(from) && litIds.has(to);

  return (
    <svg viewBox="0 0 420 260" className="w-full h-64" aria-hidden="true">
      <defs>
        <filter id="glow-strong">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-soft">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Links */}
      {MINI_LINKS.map((l, i) => {
        const from = MINI_NODE_MAP[l.from];
        const to   = MINI_NODE_MAP[l.to];
        const active = isLinkActive(l.from, l.to);
        return (
          <line
            key={i}
            x1={from.x} y1={from.y}
            x2={to.x}   y2={to.y}
            stroke={active ? '#4F8FBF' : '#CBD5E1'}
            strokeWidth={active ? 2.5 : 1.5}
            opacity={active ? 0.85 : 0.35}
            style={{ transition: 'all 0.4s ease' }}
          />
        );
      })}

      {/* Nodes */}
      {MINI_NODES.map((n) => {
        const lit = litIds.has(n.id);
        return (
          <g key={n.id} style={{ transition: 'all 0.4s ease' }}>
            {/* Outer pulse ring — only when lit */}
            {lit && (
              <circle
                cx={n.x} cy={n.y} r={n.r + 8}
                fill="none"
                stroke={n.color}
                strokeWidth={1.5}
                opacity={0.4}
              />
            )}
            {/* Halo */}
            <circle
              cx={n.x} cy={n.y} r={n.r}
              fill={n.color}
              opacity={lit ? 0.22 : 0.10}
              style={{ transition: 'opacity 0.4s ease' }}
            />
            {/* Core */}
            <circle
              cx={n.x} cy={n.y} r={n.r * 0.72}
              fill={n.color}
              opacity={lit ? 1 : 0.5}
              filter={lit ? 'url(#glow-strong)' : 'url(#glow-soft)'}
              style={{ transition: 'opacity 0.4s ease' }}
            />
            {/* Label */}
            <text
              x={n.x} y={n.y + 4}
              textAnchor="middle"
              fill="white"
              fontSize={n.r > 20 ? 10 : 8}
              fontWeight="bold"
              opacity={lit ? 1 : 0.7}
              style={{ transition: 'opacity 0.4s ease' }}
            >
              {n.label}
            </text>
          </g>
        );
      })}

      {/* Cascade label */}
      {activeStep >= 0 && (
        <text x="210" y="245" textAnchor="middle" fill="#4F8FBF" fontSize={10} opacity={0.7}>
          cascade flowing →
        </text>
      )}
    </svg>
  );
}

// ── Upcoming Earnings Strip ───────────────────────────────────────────────────
interface EarningChip { symbol: string; date: string; session: 'pre' | 'after' | 'during' | null; companyName: string | null; }

function UpcomingEarningsStrip() {
  const tHome = useTranslations('home');
  const tEarnings = useTranslations('earnings');
  const [chips, setChips] = useState<EarningChip[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    fetch(`/api/earnings?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.earnings) return;
        const upcoming: EarningChip[] = (d.earnings as Array<{
          symbol: string; date: string; session: 'pre' | 'after' | 'during' | null;
          epsActual: number | null; companyName: string | null;
        }>)
          .filter(e => e.epsActual == null)
          .slice(0, 10)
          .map(e => ({ symbol: e.symbol, date: e.date, session: e.session, companyName: e.companyName }));
        setChips(upcoming);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || chips.length === 0) return null;

  return (
    <div className="border-b border-cf-border/60 bg-cf-bg/80">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-2">
        <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          <span className="text-[10px] font-semibold text-cf-text-secondary uppercase tracking-wide flex-shrink-0">
            {tHome('earningsStrip')}
          </span>
          <div className="flex items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {chips.map(c => {
              const date = new Date(c.date + 'T12:00:00');
              const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              const sessionLabel = c.session === 'pre' ? tEarnings('sessionPre') :
                                   c.session === 'after' ? tEarnings('sessionAfter') :
                                   c.session === 'during' ? tEarnings('sessionDuring') : '';
              return (
                <Link
                  key={c.symbol}
                  href={`/company/${c.symbol}`}
                  className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-cf-border/60 bg-white/40 hover:bg-cf-primary/5 hover:border-cf-primary/30 transition-colors group"
                >
                  <span className="text-[11px] font-mono font-bold text-cf-primary group-hover:underline">{c.symbol}</span>
                  <span className="text-[10px] text-cf-text-secondary">{dateStr}</span>
                  {sessionLabel && (
                    <span className="text-[9px] font-bold px-1 py-px rounded bg-slate-100 text-slate-500">{sessionLabel}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface HomeMover { ticker: string; price: number; changePct: number; change: number; }

function TopMoversWidget() {
  const tHome = useTranslations('home');
  const [gainers, setGainers] = useState<HomeMover[]>([]);
  const [losers, setLosers] = useState<HomeMover[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/market-movers', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setGainers(d.gainers ?? []);
        setLosers(d.losers ?? []);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || (gainers.length === 0 && losers.length === 0)) return null;

  const MoverRow = ({ m, up }: { m: HomeMover; up: boolean }) => (
    <Link
      href={`/company/${m.ticker}`}
      className="flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-cf-primary/5 transition-colors group"
    >
      <span className="text-[11px] font-mono font-bold text-cf-primary group-hover:underline w-14 shrink-0">{m.ticker}</span>
      <span className="text-[11px] font-mono text-cf-text-secondary ml-auto">${m.price.toFixed(2)}</span>
      <span className={`text-[11px] font-mono font-bold ml-2 px-1.5 py-px rounded ${up ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
        {up ? '+' : ''}{m.changePct.toFixed(2)}%
      </span>
    </Link>
  );

  return (
    <div className="border-b border-cf-border/60 bg-cf-bg/80">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-start gap-6">
          <span className="text-[10px] font-semibold text-cf-text-secondary uppercase tracking-wide flex-shrink-0 pt-1.5">
            {tHome('moversTitle')}
          </span>
          <div className="flex gap-4 flex-1 min-w-0">
            {gainers.length > 0 && (
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold text-green-600 uppercase tracking-wider mb-1 px-2.5">{tHome('moversGainers')}</p>
                {gainers.map(m => <MoverRow key={m.ticker} m={m} up={true} />)}
              </div>
            )}
            {losers.length > 0 && (
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold text-red-600 uppercase tracking-wider mb-1 px-2.5">{tHome('moversLosers')}</p>
                {losers.map(m => <MoverRow key={m.ticker} m={m} up={false} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const t = useTranslations('hero');
  const tHome = useTranslations('home');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const tIntel = useTranslations('intelligence');

  const socialProof = useInView();
  const featuredSectors = useInView();
  const latestSignals = useInView();
  const features = useInView();
  const howItWorks = useInView();

  // 2026-06-04: 정적 institutionalSignals → 라이브 /api/signals (시계열, 정적 금지).
  const [liveSignals, setLiveSignals] = useState<InstitutionalSignal[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/signals', { signal: ctrl.signal }).then(r => r.ok ? r.json() : null)
      .then(d => { if (!ctrl.signal.aborted && Array.isArray(d?.signals)) setLiveSignals(d.signals); }).catch(() => {});
    return () => ctrl.abort();
  }, []);
  const topSignals = useMemo(
    () => liveSignals.filter((s) => s.action === 'accumulating' || s.action === 'new_position').slice(0, 5),
    [liveSignals]
  );

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-cf-primary/5 via-cf-secondary/5 to-cf-accent/5" />
        <div className="absolute inset-0 opacity-30">
          <div
            className="absolute inset-0 animate-pulse"
            style={{
              background:
                'radial-gradient(ellipse at 30% 50%, rgba(79,143,191,0.15) 0%, transparent 70%)',
            }}
          />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 md:py-32">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cf-primary/10 text-cf-primary text-sm font-medium mb-6">
                <span className="w-2 h-2 rounded-full bg-cf-primary animate-pulse" />
                {tCommon('beta')}
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-heading font-bold text-cf-text-primary leading-tight mb-6">
                {tHome.rich('heroHeadline', { accent: (chunks) => <span className="text-transparent bg-clip-text bg-gradient-to-r from-cf-primary to-cf-secondary">{chunks}</span> })}
              </h1>
              <p className="text-lg md:text-xl text-cf-text-secondary mb-8 max-w-lg">
                {t('description')}
              </p>
              {/* 통합 3열 그리드 — 모든 버튼 동일 크기 */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  { href: '/explore',      icon: <ArrowRight className="w-3.5 h-3.5" />,      label: tHome('exploreSupplyChains'),  desc: tHome('exploreSupplyChainsDesc', { count: UNIVERSE_COUNT }), accent: 'text-cf-primary',   primary: true },
                  { href: '/signals',      icon: <TrendingUp className="w-3.5 h-3.5" />,      label: tHome('viewSignals'),          desc: tHome('viewSignalsDesc'),         accent: 'text-blue-500' },
                  { href: '/intelligence', icon: <span className="relative flex h-3 w-3 items-center justify-center"><span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-amber-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" /></span>, label: tHome('secretMoneyTrack'), desc: tHome('secretMoneyTrackDesc'), accent: 'text-amber-500' },
                  { href: '/news-gap',     icon: <Radar className="w-3.5 h-3.5" />,           label: tHome('newsGapScan'),          desc: tHome('newsGapScanDesc'),         accent: 'text-emerald-500' },
                  { href: '/report',       icon: <span className="relative flex h-3 w-3 items-center justify-center"><span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-white opacity-90" /><span className="relative inline-flex rounded-full h-2 w-2 bg-white" /></span>, label: tHome('aiReport'), desc: tHome('aiReportDesc'), accent: 'text-white', aiReport: true },
                  { href: '/osint',        icon: <Search className="w-3.5 h-3.5" />,          label: tHome('fundTracking'),         desc: tHome('fundTrackingDesc'),         accent: 'text-cyan-500' },
                  { href: '/earnings',     icon: <BarChart3 className="w-3.5 h-3.5" />,       label: tNav('earnings'),              desc: tNav('earningsDesc'),              accent: 'text-amber-600 dark:text-amber-400' },
                  { href: '/insider',      icon: <TrendingUp className="w-3.5 h-3.5" />,      label: tNav('insider'),               desc: tNav('insiderDesc'),               accent: 'text-emerald-600 dark:text-emerald-400' },
                  { href: '/heatmap',      icon: <Layers className="w-3.5 h-3.5" />,          label: tNav('heatmap'),               desc: tNav('heatmapDesc'),               accent: 'text-blue-600 dark:text-blue-400' },
                  { href: '/screener',     icon: <Radar className="w-3.5 h-3.5" />,           label: tNav('screener'),              desc: tNav('screenerDesc'),              accent: 'text-violet-600 dark:text-violet-400' },
                  { href: '/short',        icon: <TrendingDown className="w-3.5 h-3.5" />,    label: tNav('short'),                 desc: tNav('shortDesc'),                 accent: 'text-red-600 dark:text-red-400' },
                  { href: '/cascade',      icon: <Network className="w-3.5 h-3.5" />,         label: tNav('cascade'),               desc: tNav('cascadeDesc'),               accent: 'text-cyan-600 dark:text-cyan-400' },
                  { href: '/volatility', icon: <Activity className="w-3.5 h-3.5" />, label: tNav('volatility'), desc: tNav('volatilityDesc'), accent: 'text-fuchsia-500' },
                  { href: '/intelligence?tab=capital',    icon: <GitMerge className="w-3.5 h-3.5" />,     label: tIntel('tabCapital'),    desc: tIntel('cfAiTitle'),      accent: 'text-amber-500' },
                  { href: '/intelligence?tab=macro',      icon: <TrendingUp className="w-3.5 h-3.5" />,   label: tIntel('tabMacro'),      accent: 'text-blue-500' },
                  { href: '/intelligence?tab=flows',      icon: <Activity className="w-3.5 h-3.5" />,     label: tIntel('tabFlows'),      desc: tIntel('sectorSignalsTitle'), accent: 'text-emerald-500' },
                  { href: '/intelligence?tab=fear-greed', icon: <BarChart3 className="w-3.5 h-3.5" />,    label: 'Fear & Greed',          desc: tIntel('fgByCountryTitle'), accent: 'text-rose-500' },
                  { href: '/intelligence?tab=credit',     icon: <TrendingDown className="w-3.5 h-3.5" />, label: tIntel('tabCredit'),     desc: tIntel('cbTitle'),        accent: 'text-red-500' },
                  { href: '/intelligence?tab=narratives', icon: <Brain className="w-3.5 h-3.5" />,        label: tIntel('tabNarratives'), accent: 'text-violet-500' },
                  { href: '/intelligence?tab=news',       icon: <Zap className="w-3.5 h-3.5" />,          label: tIntel('tabNews'),       desc: tIntel('ncTitle'),        accent: 'text-orange-500' },
                  { href: '/intelligence?tab=cot',        icon: <BarChart3 className="w-3.5 h-3.5" />,    label: tIntel('tabCot'),        desc: tIntel('cotTitle'),       accent: 'text-cyan-500' },
                ] as { href: string; icon: React.ReactNode; label: string; desc?: string; accent: string; primary?: boolean; aiReport?: boolean }[]).map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex flex-col justify-center gap-0.5 w-full text-xs px-3 py-2.5 rounded-xl font-semibold
                               border transition-all duration-200
                               ${item.primary
                                 ? 'bg-cf-primary text-white border-cf-primary/80 hover:bg-cf-primary/90 hover:shadow-md'
                                 : item.aiReport
                                   ? 'bg-gradient-to-br from-violet-600 to-purple-700 text-white border-violet-500/80 hover:from-violet-500 hover:to-purple-600 hover:shadow-lg hover:shadow-violet-500/30'
                                   : 'bg-white dark:bg-white/[0.06] text-cf-text-primary border-cf-border hover:border-cf-primary/30 hover:bg-gray-50/80 dark:hover:bg-white/10 hover:shadow-sm'}`}
                  >
                    <span className={`flex items-center gap-1.5 ${item.primary || item.aiReport ? '' : item.accent}`}>
                      {item.icon}
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.desc && (
                      <span className={`text-[9px] font-normal truncate leading-tight ${item.primary || item.aiReport ? 'opacity-75' : 'text-cf-text-secondary'}`}>
                        {item.desc}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
              <HeroSearch />
            </div>
            <div className="cf-card p-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-cf-text-secondary font-medium uppercase tracking-wider">
                  {tHome('latestUpdates')}
                </p>
                <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {tHome('realtime')}
                </span>
              </div>
              <LiveFeed />
            </div>
          </div>
        </div>
      </section>

      {/* Live market snapshot strip */}
      <MarketSnapshot />
      {/* Upcoming earnings strip */}
      <UpcomingEarningsStrip />
      {/* Top movers widget */}
      <TopMoversWidget />

      {/* Social Proof */}
      <section
        ref={socialProof.ref}
        className={`border-y border-cf-border bg-white transition-all duration-700 ${
          socialProof.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { value: '10,000+', label: tHome('socialProof.investors'), icon: <Users className="w-5 h-5" /> },
              // 2026-06-03: allCompanies.length(정적 프로필 ~637)이 모니터링 풀(1210)을 과소표시 → UNIVERSE_COUNT 사용.
              { value: `${UNIVERSE_COUNT}+`, label: tHome('socialProof.companies'), icon: <Network className="w-5 h-5" /> },
              { value: '16', label: tHome('socialProof.sectors'), icon: <Globe className="w-5 h-5" /> },
              { value: '$48B+', label: tHome('socialProof.flows'), icon: <BarChart3 className="w-5 h-5" /> },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-cf-primary/10 text-cf-primary mb-3">
                  {stat.icon}
                </div>
                <p className="text-2xl md:text-3xl font-heading font-bold text-cf-text-primary">
                  {stat.value}
                </p>
                <p className="text-sm text-cf-text-secondary mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Sectors */}
      <section
        ref={featuredSectors.ref}
        className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 transition-all duration-700 ${
          featuredSectors.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <div className="text-center mb-12">
          <h2 className="text-3xl font-heading font-bold text-cf-text-primary mb-4">
            {tHome('featuredSectors')}
          </h2>
          <p className="text-cf-text-secondary max-w-2xl mx-auto">
            {tHome('featuredSectorsDesc')}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
          {sectors.map((sector) => (
            <Link
              key={sector.id}
              href={`/explore/${sector.id}`}
              className="cf-card p-6 group hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-center border-2 border-transparent hover:border-current/10"
              style={{ '--tw-border-opacity': '0.1', borderColor: 'transparent' } as React.CSSProperties}
            >
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 transition-transform group-hover:scale-110"
                style={{ backgroundColor: sector.color + '15', color: sector.color }}
              >
                {sectorIcons[sector.icon] || <Network className="w-6 h-6" />}
              </div>
              <h3 className="font-heading font-bold text-cf-text-primary text-base mb-2 group-hover:text-cf-primary transition-colors">
                {sector.name}
              </h3>
              <p className="text-xs text-cf-text-secondary mb-3 line-clamp-2">
                {sector.description.split('.')[0]}.
              </p>
              <div className="flex items-center justify-center gap-1 text-sm font-medium text-cf-primary opacity-0 group-hover:opacity-100 transition-opacity">
                {tHome('explore')}
                <ArrowRight className="w-4 h-4" />
              </div>
              <p className="text-xs text-cf-text-secondary mt-2">
                {tHome('companies', { count: sector.companyCount })}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* Latest Signals */}
      <section
        ref={latestSignals.ref}
        className={`bg-white py-20 transition-all duration-700 ${
          latestSignals.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-3xl font-heading font-bold text-cf-text-primary mb-2">
                {tHome('latestSignals')}
              </h2>
              <p className="text-cf-text-secondary">
                {tHome('latestSignalsDesc')}
              </p>
            </div>
            <Link href="/signals" className="cf-btn-secondary gap-2 hidden md:inline-flex">
              {tHome('viewAllSignals')}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {topSignals.map((signal) => (
              <Link
                key={signal.id}
                href={`/company/${signal.ticker}`}
                className="cf-card p-5 group hover:shadow-lg transition-all"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono font-bold text-cf-primary text-lg">
                    {signal.ticker}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${actionColors[signal.action]}`}
                  >
                    {actionIcons[signal.action]}
                    {signal.action.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-sm text-cf-text-primary font-medium mb-1 truncate">
                  {signal.companyName || signal.ticker}
                </p>
                <p className="text-xs text-cf-text-secondary mb-3">
                  {signal.institution}
                </p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-cf-text-secondary">{signal.filingDate}</span>
                  <span className="font-bold text-cf-text-primary">{signal.estimatedValue}</span>
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-6 text-center md:hidden">
            <Link href="/signals" className="cf-btn-secondary gap-2">
              {tHome('viewAllSignals')}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section
        ref={features.ref}
        className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 transition-all duration-700 ${
          features.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <div className="text-center mb-12">
          <h2 className="text-3xl font-heading font-bold text-cf-text-primary mb-4">
            {tHome('fourLenses')}
          </h2>
          <p className="text-cf-text-secondary max-w-2xl mx-auto">
            {tHome('fourLensesDesc')}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          {[
            {
              icon: <Network className="w-6 h-6" />,
              title: tHome('featureCards.supplyChainMaps'),
              desc: t('features.realtimeDesc'),
              color: 'text-cf-primary bg-cf-primary/10',
              href: '/explore',
            },
            {
              icon: <TrendingUp className="w-6 h-6" />,
              title: tHome('featureCards.institutionalFlowSignals'),
              desc: t('features.signalsDesc'),
              color: 'text-cf-secondary bg-cf-secondary/10',
              href: '/signals',
            },
            {
              icon: <Layers className="w-6 h-6" />,
              title: tHome('featureCards.leaderToMidcapCascade'),
              desc: t('features.cascadeDesc'),
              color: 'text-cf-accent bg-cf-accent/10',
              href: '/cascade',
            },
            {
              icon: <Newspaper className="w-6 h-6" />,
              title: tHome('featureCards.newsGapAnalyzer'),
              desc: t('features.newsGapDesc'),
              color: 'text-cf-danger bg-cf-danger/10',
              href: '/news-gap',
            },
            {
              icon: <GitCompare className="w-6 h-6" />,
              title: 'Company Comparator',
              desc: 'Compare any two companies side-by-side — revenue, supply chain role, institutional signals, and news gap score.',
              color: 'text-purple-600 bg-purple-100',
              href: '/compare/nvda-vs-amd',
            },
          ].map((feature) => (
            <Link
              key={feature.title}
              href={feature.href}
              className="cf-card p-6 group hover:shadow-lg transition-all"
            >
              <div
                className={`w-12 h-12 rounded-xl ${feature.color} flex items-center justify-center mb-4`}
              >
                {feature.icon}
              </div>
              <h3 className="font-heading font-bold text-cf-text-primary mb-2 group-hover:text-cf-primary transition-colors">
                {feature.title}
              </h3>
              <p className="text-sm text-cf-text-secondary">{feature.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section
        ref={howItWorks.ref}
        className={`bg-white py-20 transition-all duration-700 ${
          howItWorks.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-heading font-bold text-cf-text-primary mb-4">
              {tHome('howItWorks')}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: '1',
                title: tHome('steps.mapTheChain'),
                desc: tHome('steps.mapTheChainDesc'),
              },
              {
                step: '2',
                title: tHome('steps.detectTheSignal'),
                desc: tHome('steps.detectTheSignalDesc'),
              },
              {
                step: '3',
                title: tHome('steps.tradeTheCascade'),
                desc: tHome('steps.tradeTheCascadeDesc'),
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-cf-primary to-cf-secondary text-white text-xl font-bold flex items-center justify-center mx-auto mb-6 shadow-lg">
                  {item.step}
                </div>
                <h3 className="text-lg font-heading font-bold text-cf-text-primary mb-3">
                  {item.title}
                </h3>
                <p className="text-sm text-cf-text-secondary max-w-xs mx-auto">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link href="/explore" className="cf-btn-primary text-base px-10 py-3.5 gap-2 shadow-lg shadow-cf-primary/25">
              {tHome('startExploringNow')}
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Email CTA */}
      <EmailCTA />

      {/* Disclaimer */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-12">
        <div className="text-center text-xs text-cf-text-secondary max-w-2xl mx-auto bg-white/60 rounded-xl p-4 border border-cf-border">
          {tHome('disclaimer')}
        </div>
      </section>
    </div>
  );
}
