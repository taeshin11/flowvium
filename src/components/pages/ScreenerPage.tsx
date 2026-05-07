'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useMemo } from 'react';
import { Link } from '@/i18n/routing';
import { Loader2, ArrowUpDown, ExternalLink, Filter, X, TrendingUp, TrendingDown, Plus, LogOut } from 'lucide-react';
import type { InstitutionalSignal } from '@/data/institutional-signals';
import type { ShortEntry } from '@/app/api/short-interest/route';

type Timeframe = '1w' | '4w' | '13w';

const TF_DAYS: Record<'1w' | '4w', number> = { '1w': 7, '4w': 28 };

const ACTION_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  accumulating: { color: '#10b981', bg: '#10b98120', icon: <TrendingUp className="w-3 h-3" /> },
  new_position: { color: '#3b82f6', bg: '#3b82f620', icon: <Plus className="w-3 h-3" /> },
  reducing:     { color: '#f59e0b', bg: '#f59e0b20', icon: <TrendingDown className="w-3 h-3" /> },
  exit:         { color: '#ef4444', bg: '#ef444420', icon: <LogOut className="w-3 h-3" /> },
};

interface ScreenerRow {
  ticker: string;
  companyName: string;
  sector: string;
  institution: string;
  action: string;
  estimatedValue: string;
  filingDate: string;
  newsGapScore: number;
  shortFloatPct: number | null;
  shortVolPct: number | null;
  shortRatio: number | null;
  squeezeScore: number;
  bullishCount: number;
  bearishCount: number;
  institutionCount: number;
  nportValue: number | null;
  nportFundCount: number | null;
  price: number | null;
  changePct: number | null;
}

interface InsiderTrade {
  id: string;
  ticker: string;
  issuerName: string;
  insiderName: string;
  officerTitle: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  direction: 'buy' | 'sell';
  transactionCode: string;
  shares: number;
  pricePerShare: number | null;
  transactionValueUsd: number | null;
  transactionDate: string;
  filedAt: string;
}

interface InsiderRow {
  ticker: string;
  issuerName: string;
  totalValueUsd: number;
  trades: InsiderTrade[];
  topBuyer: string;
  topTitle: string | null;
  isCsuite: boolean;
  tradeCount: number;
}

const PRESETS: { id: string; filter: (r: ScreenerRow) => boolean }[] = [
  {
    id: 'squeeze',
    filter: (r: ScreenerRow) => {
      const accumulating = r.action === 'accumulating' || r.action === 'new_position';
      if (!accumulating) return false;
      if (r.shortVolPct != null) return r.squeezeScore >= 30;
      return true;
    },
  },
  { id: 'inst',       filter: (r: ScreenerRow) => r.action === 'new_position' },
  { id: 'accumulate', filter: (r: ScreenerRow) => r.action === 'accumulating' || r.action === 'new_position' },
  { id: 'reduce',     filter: (r: ScreenerRow) => r.action === 'reducing' || r.action === 'exit' },
  { id: 'gap',        filter: (r: ScreenerRow) => (r.action === 'accumulating' || r.action === 'new_position') && r.institutionCount <= 2 },
  { id: 'consensus',  filter: (r: ScreenerRow) => r.bullishCount >= 2 },
  { id: 'nport-dual', filter: (r: ScreenerRow) => (r.action === 'accumulating' || r.action === 'new_position') && r.nportValue != null },
];

type SortKey = keyof ScreenerRow;

interface TopPrice { price: number | null; changePct: number | null; ret: number | null; currency: string; }

function parseVal(v: string): number {
  if (!v) return 0;
  const n = parseFloat(v.replace(/[$,]/g, ''));
  if (v.endsWith('B')) return n * 1e9;
  if (v.endsWith('M')) return n * 1e6;
  if (v.endsWith('K')) return n * 1e3;
  return Number.isNaN(n) ? 0 : n;
}

function fmtUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function isCsuiteTitle(title: string | null): boolean {
  if (!title) return false;
  const upper = title.toUpperCase();
  return upper.includes('CEO') || upper.includes('CFO') || upper.includes('COO') || upper.includes('CTO') ||
    upper.includes('PRESIDENT') || upper.includes('CHAIRMAN') || upper.includes('DIRECTOR');
}

export default function ScreenerPage() {
  const t = useTranslations('screener');
  const [tf, setTf] = useState<Timeframe>('13w');

  const [signals, setSignals] = useState<InstitutionalSignal[]>([]);
  const [shortData, setShortData] = useState<ShortEntry[]>([]);
  const [loading13F, setLoading13F] = useState(true);

  const [nportMap, setNportMap] = useState<Map<string, { value: number; fundCount: number }>>(new Map());

  const [insiderTrades, setInsiderTrades] = useState<InsiderTrade[]>([]);
  const [loadingInsider, setLoadingInsider] = useState(false);
  const [insiderLoaded, setInsiderLoaded] = useState(false);

  const [priceMap, setPriceMap] = useState<Map<string, TopPrice>>(new Map());
  const [pricesLoaded, setPricesLoaded] = useState(false);

  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [minShort, setMinShort] = useState<number>(0);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('filingDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const tfLabels: Record<Timeframe, string> = {
    '1w': t('tf1w'), '4w': t('tf4w'), '13w': t('tf13w'),
  };
  const sectorLabels: Record<string, string> = {
    semiconductors: t('sectorSemiconductors'),
    'ai-cloud': t('sectorAiCloud'),
    'ev-battery': t('sectorEvBattery'),
    defense: t('sectorDefense'),
    'pharma-biotech': t('sectorPharmaBiotech'),
    commodities: t('sectorCommodities'),
    other: t('sectorOther'),
  };
  const actionLabels: Record<string, string> = {
    accumulating: t('actionAccumulating'),
    new_position: t('actionNew'),
    reducing: t('actionReducing'),
    exit: t('actionExit'),
  };
  const presetMeta = [
    { id: 'squeeze',    label: t('presetSqueezeLabel'),    desc: t('presetSqueezeDesc')    },
    { id: 'inst',       label: t('presetInstLabel'),       desc: t('presetInstDesc')       },
    { id: 'accumulate', label: t('presetAccumulateLabel'), desc: t('presetAccumulateDesc') },
    { id: 'reduce',     label: t('presetReduceLabel'),     desc: t('presetReduceDesc')     },
    { id: 'gap',        label: t('presetGapLabel'),        desc: t('presetGapDesc')        },
    { id: 'consensus',  label: t('presetConsensusLabel'),  desc: t('presetConsensusDesc')  },
    { id: 'nport-dual', label: t('presetNportLabel'),      desc: t('presetNportDesc')      },
  ];

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.allSettled([
      fetch('/api/signals', { signal: ctrl.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch('/api/short-interest', { signal: ctrl.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    ]).then(([sigRes, shortRes]) => {
      if (ctrl.signal.aborted) return;
      if (sigRes.status === 'fulfilled') setSignals(sigRes.value.signals ?? []);
      if (shortRes.status === 'fulfilled') setShortData(shortRes.value.entries ?? []);
      setLoading13F(false);
    }).catch(() => { if (!ctrl.signal.aborted) setLoading13F(false); });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    fetch('/api/nport-holdings')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => {
        const map = new Map<string, { value: number; fundCount: number }>();
        for (const entry of (d.byTicker ?? [])) {
          if (entry.ticker && entry.totalValueUsd > 0)
            map.set(entry.ticker, { value: entry.totalValueUsd, fundCount: entry.funds?.length ?? 0 });
        }
        setNportMap(map);
      })
      .catch(() => {/* non-fatal */});
  }, []);

  useEffect(() => {
    if (tf === '13w') return;
    if (insiderLoaded) return;
    setLoadingInsider(true);
    const ctrl = new AbortController();
    fetch('/api/insider-trades', { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => {
        if (ctrl.signal.aborted) return;
        setInsiderTrades((d.items ?? []) as InsiderTrade[]);
        setInsiderLoaded(true);
        setLoadingInsider(false);
      })
      .catch(() => { if (!ctrl.signal.aborted) { setInsiderLoaded(true); setLoadingInsider(false); } });
    return () => ctrl.abort();
  }, [tf, insiderLoaded]);

  const shortMap = useMemo(() => new Map(shortData.map(s => [s.ticker, s])), [shortData]);

  const deduped: ScreenerRow[] = useMemo(() => {
    const byTicker = new Map<string, InstitutionalSignal>();
    const consensusMap = new Map<string, { bullish: number; bearish: number; instSet: Set<string> }>();
    for (const sig of signals) {
      const existing = byTicker.get(sig.ticker);
      if (!existing || sig.filingDate > existing.filingDate) byTicker.set(sig.ticker, sig);
      const c = consensusMap.get(sig.ticker) ?? { bullish: 0, bearish: 0, instSet: new Set() };
      if (sig.action === 'accumulating' || sig.action === 'new_position') c.bullish++;
      else if (sig.action === 'reducing' || sig.action === 'exit') c.bearish++;
      c.instSet.add(sig.institution);
      consensusMap.set(sig.ticker, c);
    }
    return Array.from(byTicker.values()).map(sig => {
      const short = shortMap.get(sig.ticker);
      const consensus = consensusMap.get(sig.ticker) ?? { bullish: 0, bearish: 0, instSet: new Set() };
      const nport = nportMap.get(sig.ticker) ?? null;
      const lp = priceMap.get(sig.ticker) ?? null;
      return {
        ticker: sig.ticker, companyName: sig.companyName, sector: sig.sector,
        institution: sig.institution, action: sig.action, estimatedValue: sig.estimatedValue,
        filingDate: sig.filingDate, newsGapScore: sig.newsGapScore,
        shortFloatPct: short?.shortFloatPct ?? null, shortVolPct: short?.shortVolPct ?? null,
        shortRatio: short?.shortRatio ?? null, squeezeScore: short?.squeezeScore ?? 0,
        bullishCount: consensus.bullish, bearishCount: consensus.bearish,
        institutionCount: consensus.instSet.size,
        nportValue: nport?.value ?? null, nportFundCount: nport?.fundCount ?? null,
        price: lp?.price ?? null, changePct: lp?.ret ?? lp?.changePct ?? null,
      };
    });
  }, [signals, shortMap, nportMap, priceMap]);

  const tickerKey = useMemo(
    () => Array.from(new Set(signals.map(s => s.ticker))).sort().join(','),
    [signals],
  );

  const sectors = useMemo(() => ['all', ...Array.from(new Set(deduped.map(r => r.sector)))], [deduped]);

  const filtered = useMemo(() => {
    let rows = deduped;
    if (activePreset) {
      const preset = PRESETS.find(p => p.id === activePreset);
      if (preset) rows = rows.filter(preset.filter);
    } else {
      if (sectorFilter !== 'all') rows = rows.filter(r => r.sector === sectorFilter);
      if (actionFilter !== 'all') rows = rows.filter(r => r.action === actionFilter);
      rows = rows.filter(r => (r.shortVolPct ?? 0) >= minShort);
    }
    return [...rows].sort((a, b) => {
      const va: unknown = a[sortKey], vb: unknown = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [deduped, activePreset, sectorFilter, actionFilter, minShort, sortKey, sortDir]);

  const top5Squeeze = useMemo(() => [...deduped].sort((a, b) => b.squeezeScore - a.squeezeScore).slice(0, 5), [deduped]);
  const top5NewPosition = useMemo(() => [...deduped].filter(r => r.action === 'new_position').sort((a, b) => parseVal(b.estimatedValue) - parseVal(a.estimatedValue)).slice(0, 5), [deduped]);
  const top5Underradar = useMemo(() => [...deduped].filter(r => (r.action === 'accumulating' || r.action === 'new_position') && r.newsGapScore < 30).sort((a, b) => (a.newsGapScore ?? 100) - (b.newsGapScore ?? 100)).slice(0, 5), [deduped]);

  const insiderRows = useMemo((): InsiderRow[] => {
    if (tf === '13w') return [];
    const days = TF_DAYS[tf];
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const buys = insiderTrades.filter(trade => trade.direction === 'buy' && trade.transactionDate >= cutoff && (trade.transactionValueUsd ?? 0) > 0);
    const byTicker = new Map<string, InsiderTrade[]>();
    for (const trade of buys) {
      const arr = byTicker.get(trade.ticker) ?? [];
      arr.push(trade);
      byTicker.set(trade.ticker, arr);
    }
    return Array.from(byTicker.entries()).map(([ticker, trades]) => {
      const totalValueUsd = trades.reduce((s, trade) => s + (trade.transactionValueUsd ?? 0), 0);
      const topTrade = [...trades].sort((a, b) => (b.transactionValueUsd ?? 0) - (a.transactionValueUsd ?? 0))[0];
      const isCsuite = trades.some(trade => isCsuiteTitle(trade.officerTitle));
      return {
        ticker, issuerName: topTrade.issuerName, totalValueUsd, trades,
        topBuyer: topTrade.insiderName, topTitle: topTrade.officerTitle,
        isCsuite, tradeCount: trades.length,
      };
    }).sort((a, b) => b.totalValueUsd - a.totalValueUsd);
  }, [insiderTrades, tf]);

  const topInsiderBuys = useMemo(() => insiderRows.slice(0, 5), [insiderRows]);
  const topCsuite = useMemo(() => insiderRows.filter(r => r.isCsuite).slice(0, 5), [insiderRows]);
  const topClustered = useMemo(() => [...insiderRows].sort((a, b) => b.tradeCount - a.tradeCount).slice(0, 5), [insiderRows]);

  // Squeeze candidates for 1W/4W: cross insider buy signal with short data
  const insiderSqueezeRows = useMemo(() => {
    if (tf === '13w') return [];
    return insiderRows
      .map(row => {
        const short = shortMap.get(row.ticker);
        if (!short) return null;
        const insiderBonus = row.isCsuite ? 20 : row.tradeCount >= 3 ? 15 : 10;
        const adjScore = Math.min(100, (short.squeezeScore ?? 0) + insiderBonus);
        return { ...row, squeezeScore: adjScore, shortVolPct: short.shortVolPct };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null && r.squeezeScore >= 20)
      .sort((a, b) => b.squeezeScore - a.squeezeScore)
      .slice(0, 5);
  }, [insiderRows, shortMap, tf]);

  // Fetch prices for insider tickers (separate from 13F tickers)
  const insiderTickerKey = useMemo(
    () => insiderRows.map(r => r.ticker).sort().join(','),
    [insiderRows],
  );

  useEffect(() => {
    if (tf === '13w') return;
    const tickers = insiderTickerKey.split(',').filter(Boolean);
    if (!tickers.length) return;
    const ctrl = new AbortController();
    const periodParam = tf === '1w' || tf === '4w' ? `&period=${tf}` : '';
    fetch(`/api/batch-prices?tickers=${tickers.join(',')}${periodParam}`, { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: { prices: Record<string, { price: number | null; changePct: number | null; ret: number | null }> }) => {
        if (ctrl.signal.aborted) return;
        setPriceMap(prev => {
          const map = new Map(prev);
          for (const [ticker, entry] of Object.entries(d.prices ?? {}))
            map.set(ticker, { price: entry.price, changePct: entry.changePct, ret: entry.ret ?? null, currency: 'USD' });
          return map;
        });
        setPricesLoaded(true);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [insiderTickerKey, tf]);

  useEffect(() => {
    const allTickers = tickerKey.split(',').filter(Boolean);
    if (!allTickers.length) return;
    const ctrl = new AbortController();
    setPricesLoaded(false);
    fetch(`/api/batch-prices?tickers=${allTickers.join(',')}`, { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: { prices: Record<string, { price: number | null; changePct: number | null; change: number | null }> }) => {
        if (ctrl.signal.aborted) return;
        const map = new Map<string, TopPrice>();
        for (const [ticker, entry] of Object.entries(d.prices ?? {}))
          map.set(ticker, { price: entry.price, changePct: entry.changePct, ret: null, currency: 'USD' });
        setPriceMap(map);
        setPricesLoaded(true);
      })
      .catch(() => { if (!ctrl.signal.aborted) setPricesLoaded(true); });
    return () => ctrl.abort();
  }, [tickerKey]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };
  const clearFilters = () => { setSectorFilter('all'); setActionFilter('all'); setMinShort(0); setActivePreset(null); };

  const SortTh = ({ label, k }: { label: string; k: SortKey }) => (
    <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary cursor-pointer hover:text-cf-text-primary select-none whitespace-nowrap" onClick={() => handleSort(k)}>
      <div className="flex items-center gap-1">{label}<ArrowUpDown className="w-2.5 h-2.5 opacity-40" />{sortKey === k && <span className="opacity-70">{sortDir === 'desc' ? '↓' : '↑'}</span>}</div>
    </th>
  );

  const PriceCard = ({ ticker, badge, badgeCls, sub }: { ticker: string; badge: string; badgeCls: string; sub?: string }) => {
    const lp = priceMap.get(ticker);
    const sym = lp?.currency === 'KRW' ? '₩' : '$';
    return (
      <Link href={`/company/${ticker}` as Parameters<typeof Link>[0]['href']}
        className="flex-1 min-w-[110px] max-w-[160px] bg-white/5 rounded-xl p-3 hover:bg-white/10 transition-all">
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono font-bold text-xs text-cf-primary">{ticker}</span>
          <span className={`text-[9px] px-1 py-0.5 rounded font-bold tabular-nums ${badgeCls}`}>{badge}</span>
        </div>
        {lp?.price != null ? (
          <>
            <p className="text-sm font-bold text-cf-text-primary tabular-nums">{sym}{lp.price.toFixed(2)}</p>
            {lp.changePct != null && (
              <p className={`text-xs font-semibold tabular-nums ${lp.changePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {lp.changePct >= 0 ? '+' : ''}{lp.changePct.toFixed(2)}%
              </p>
            )}
          </>
        ) : pricesLoaded ? <p className="text-xs text-cf-text-secondary/50">—</p>
          : <p className="text-xs text-cf-text-secondary/50 animate-pulse">···</p>}
        {sub && <p className="text-[9px] text-cf-text-secondary/60 mt-1 truncate">{sub}</p>}
      </Link>
    );
  };

  const loading = tf === '13w' ? loading13F : loadingInsider;
  const dataDate13F = t('dataDate13F');
  const insiderDays = tf === '1w' ? 7 : 28;
  const dataDateInsider = t('dataDateInsider', { days: insiderDays });

  if (loading && tf === '13w' && signals.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px] gap-3 text-cf-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>{t('loading')}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-cf-text-primary flex items-center gap-2">
          <Filter className="w-6 h-6 text-cf-accent" />
          {t('title')}
        </h1>
        <p className="text-sm text-cf-text-secondary mt-1">{t('subtitle')}</p>
      </div>

      {/* Timeframe selector */}
      <div className="flex items-center gap-1 mb-5 bg-white/5 rounded-xl p-1 w-fit">
        {(['1w', '4w', '13w'] as Timeframe[]).map(tfOpt => (
          <button key={tfOpt} onClick={() => setTf(tfOpt)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tf === tfOpt ? 'bg-cf-accent text-white shadow-sm' : 'text-cf-text-secondary hover:text-cf-text-primary'}`}>
            {tfLabels[tfOpt]}
          </button>
        ))}
      </div>

      {/* Data source description */}
      <div className={`cf-card px-4 py-3 mb-5 text-xs flex items-start gap-2 ${tf === '13w' ? 'border-blue-500/20 bg-blue-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
        <span className="text-lg shrink-0">{tf === '13w' ? '🏦' : '👤'}</span>
        <div>
          <p className="font-semibold text-cf-text-primary">
            {tf === '13w' ? t('data13fTitle') : t('dataInsiderTitle', { days: insiderDays })}
          </p>
          <p className="text-cf-text-secondary mt-0.5">
            {tf === '13w' ? t('data13fDesc') : t('dataInsiderDesc')}
          </p>
        </div>
      </div>

      {/* ── 13w view ─────────────────────────────────────────────────────── */}
      {tf === '13w' && (
        <>
          {(top5Squeeze.length > 0 || top5NewPosition.length > 0 || top5Underradar.length > 0) && (
            <div className="space-y-3 mb-4">
              {top5Squeeze.length > 0 && (
                <div className="cf-card p-4 bg-gradient-to-r from-amber-500/5 to-orange-500/5 border border-amber-500/10">
                  <p className="text-[10px] font-bold text-amber-400 mb-3 flex items-center gap-1.5">
                    {t('topSqueezeTitle')}
                    <span className="font-normal text-cf-text-secondary">{t('topSqueezeSubtitle')}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {top5Squeeze.map(row => <PriceCard key={row.ticker} ticker={row.ticker} badge={String(row.squeezeScore)} badgeCls="bg-amber-500/20 text-amber-300" sub={sectorLabels[row.sector] ?? row.sector} />)}
                  </div>
                  <p className="text-[9px] text-cf-text-secondary/40 mt-2">{t('priceCache')} &nbsp;|&nbsp; {t('instPosition', { date: dataDate13F })}</p>
                </div>
              )}
              {top5NewPosition.length > 0 && (
                <div className="cf-card p-4 bg-gradient-to-r from-blue-500/5 to-indigo-500/5 border border-blue-500/10">
                  <p className="text-[10px] font-bold text-blue-400 mb-3 flex items-center gap-1.5">
                    {t('topNewInstTitle')}
                    <span className="font-normal text-cf-text-secondary">{t('topNewInstSubtitle')}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {top5NewPosition.map(row => <PriceCard key={row.ticker} ticker={row.ticker} badge={row.estimatedValue} badgeCls="bg-blue-500/20 text-blue-300" sub={sectorLabels[row.sector] ?? row.sector} />)}
                  </div>
                  <p className="text-[9px] text-cf-text-secondary/40 mt-2">{t('priceCache')} &nbsp;|&nbsp; {t('instPosition', { date: dataDate13F })}</p>
                </div>
              )}
              {top5Underradar.length > 0 && (
                <div className="cf-card p-4 bg-gradient-to-r from-purple-500/5 to-violet-500/5 border border-purple-500/10">
                  <p className="text-[10px] font-bold text-purple-400 mb-3 flex items-center gap-1.5">
                    {t('topUnderradarTitle')}
                    <span className="font-normal text-cf-text-secondary">{t('topUnderradarSubtitle')}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {top5Underradar.map(row => <PriceCard key={row.ticker} ticker={row.ticker} badge={t('newsScore', { score: row.newsGapScore })} badgeCls="bg-purple-500/20 text-purple-300" sub={sectorLabels[row.sector] ?? row.sector} />)}
                  </div>
                  <p className="text-[9px] text-cf-text-secondary/40 mt-2">{t('priceCache')} &nbsp;|&nbsp; {t('instPosition', { date: dataDate13F })}</p>
                </div>
              )}
            </div>
          )}

          {/* Quick guide */}
          <div className="cf-card p-4 mb-4 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 border border-indigo-500/10">
            <p className="text-xs font-bold text-cf-text-primary mb-2">{t('howToReadTitle')}</p>
            <ul className="text-[11px] text-cf-text-secondary space-y-1.5 leading-relaxed">
              <li>• {t('howToReadSqueeze')}</li>
              <li>• {t('howToReadInst')}</li>
              <li>• {t('howToReadUnder')}</li>
            </ul>
          </div>

          {/* Preset buttons */}
          <div className="flex flex-wrap gap-2 mb-4">
            {presetMeta.map(p => (
              <button key={p.id} onClick={() => setActivePreset(activePreset === p.id ? null : p.id)}
                className={`text-xs px-3 py-2 rounded-xl border transition-all ${activePreset === p.id ? 'bg-cf-accent/20 border-cf-accent text-cf-accent' : 'border-white/10 text-cf-text-secondary hover:border-white/20'}`}>
                <span className="font-semibold">{p.label}</span>
                <span className="text-[10px] opacity-70 ml-1.5 hidden sm:inline">{p.desc}</span>
              </button>
            ))}
          </div>

          {!activePreset && (
            <div className="cf-card p-4 mb-4 flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-[10px] text-cf-text-secondary block mb-1">{t('filterSector')}</label>
                <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)} className="text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-cf-text-primary">
                  <option value="all">{t('filterAll')}</option>
                  {sectors.filter(s => s !== 'all').map(s => <option key={s} value={s}>{sectorLabels[s] ?? s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-cf-text-secondary block mb-1">{t('filterAction')}</label>
                <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-cf-text-primary">
                  <option value="all">{t('filterAll')}</option>
                  <option value="accumulating">{t('actionAccumulating')}</option>
                  <option value="new_position">{t('actionNew')}</option>
                  <option value="reducing">{t('actionReducing')}</option>
                  <option value="exit">{t('actionExit')}</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-cf-text-secondary block mb-1">{t('filterMinShort')}</label>
                <input type="number" min={0} max={100} value={minShort} onChange={e => setMinShort(+e.target.value)} className="text-xs w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-cf-text-primary" />
              </div>
              <button onClick={clearFilters} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-cf-text-secondary hover:bg-white/5 transition-colors">
                <X className="w-3 h-3" /> {t('filterReset')}
              </button>
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-cf-text-secondary">{t('resultsCount', { n: filtered.length })}</span>
            {activePreset && (
              <button onClick={() => setActivePreset(null)} className="flex items-center gap-1 text-xs text-cf-text-secondary hover:text-cf-text-primary transition-colors">
                <X className="w-3 h-3" /> {t('clearPreset')}
              </button>
            )}
          </div>

          <div className="cf-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/5">
                <tr>
                  <SortTh label={t('colTicker')} k="ticker" />
                  <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colCompany')}</th>
                  <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colSector')}</th>
                  <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colInstitution')}</th>
                  <SortTh label={t('colConsensus')} k="bullishCount" />
                  <SortTh label="N-PORT" k="nportValue" />
                  <SortTh label={t('colPrice')} k="price" />
                  <SortTh label={t('colChange')} k="changePct" />
                  <SortTh label={t('colAction')} k="action" />
                  <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colSize')}</th>
                  <SortTh label="Short Vol %" k="shortVolPct" />
                  <SortTh label={t('colSqueeze')} k="squeezeScore" />
                  <SortTh label={t('colNewsGap')} k="newsGapScore" />
                  <SortTh label={t('colFilingDate')} k="filingDate" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => {
                  const actionCfg = ACTION_CONFIG[row.action];
                  const actionLabel = actionLabels[row.action];
                  return (
                    <tr key={`${row.ticker}-${row.institution}`} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-2.5">
                        <Link href={`/company/${row.ticker}` as Parameters<typeof Link>[0]['href']} className="font-bold text-cf-accent hover:underline flex items-center gap-1">
                          {row.ticker}<ExternalLink className="w-3 h-3 opacity-40" />
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary max-w-[130px] truncate">{row.companyName || row.ticker}</td>
                      <td className="px-3 py-2.5"><span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-cf-text-secondary">{sectorLabels[row.sector] ?? row.sector}</span></td>
                      <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary max-w-[140px] truncate">{row.institution}</td>
                      <td className="px-3 py-2.5">
                        {(row.bullishCount > 0 || row.bearishCount > 0) && (
                          <div className="flex items-center gap-1 text-[10px]">
                            {row.bullishCount > 0 && <span className="text-green-400 font-bold">▲{row.bullishCount}</span>}
                            {row.bearishCount > 0 && <span className="text-red-400 font-bold">▼{row.bearishCount}</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.nportValue != null ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-mono whitespace-nowrap"
                            title={row.nportFundCount != null ? t('nportFunds', { n: row.nportFundCount }) : undefined}>
                            {fmtUsd(row.nportValue)}
                          </span>
                        ) : <span className="text-cf-text-secondary/30 text-[10px]">—</span>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
                        {row.price != null
                          ? <span className="text-cf-text-primary">${row.price < 1000 ? row.price.toFixed(2) : row.price.toFixed(0)}</span>
                          : <span className="text-cf-text-secondary/30 animate-pulse text-[10px]">···</span>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
                        {row.changePct != null
                          ? <span className={row.changePct >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                              {row.changePct >= 0 ? '+' : ''}{row.changePct.toFixed(2)}%
                            </span>
                          : <span className="text-cf-text-secondary/30 animate-pulse text-[10px]">···</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {actionCfg && actionLabel && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold w-fit px-1.5 py-0.5 rounded" style={{ color: actionCfg.color, backgroundColor: actionCfg.bg }}>
                            {actionCfg.icon}{actionLabel}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-mono text-cf-text-secondary">{row.estimatedValue}</td>
                      <td className="px-3 py-2.5 font-mono text-sm">
                        {row.shortVolPct != null
                          ? <span className={row.shortVolPct > 60 ? 'text-red-400' : row.shortVolPct > 50 ? 'text-amber-400' : 'text-cf-text-primary'}>{row.shortVolPct.toFixed(1)}%</span>
                          : <span className="text-cf-text-secondary/40">-</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold">{row.squeezeScore}</span>
                          <div className="w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${row.squeezeScore}%`, backgroundColor: row.squeezeScore >= 70 ? '#ef4444' : row.squeezeScore >= 45 ? '#f59e0b' : '#6366f1' }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {row.newsGapScore === 50 ? <span className="text-cf-text-secondary/30 text-[10px]">—</span> : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-mono">{row.newsGapScore}</span>
                            <div className="w-10 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-purple-400" style={{ width: `${row.newsGapScore}%` }} /></div>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary font-mono whitespace-nowrap">{row.filingDate}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="text-center py-12 text-cf-text-secondary text-sm">{t('noResults')}</div>}
          </div>
          <p className="text-[10px] text-cf-text-secondary/40 mt-3">{t('sourceNote13f', { date: dataDate13F })}</p>
        </>
      )}

      {/* ── 1w / 4w insider view ─────────────────────────────────────────── */}
      {tf !== '13w' && (
        <>
          {loadingInsider && insiderRows.length === 0 && (
            <div className="flex items-center justify-center py-12 gap-3 text-cf-text-secondary">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{t('loadingInsider')}</span>
            </div>
          )}

          {!loadingInsider && insiderRows.length === 0 && (
            <div className="text-center py-12 text-cf-text-secondary text-sm">
              {t('noInsiderBuys', { days: insiderDays })}
            </div>
          )}

          {insiderRows.length > 0 && (
            <>
              <div className="space-y-3 mb-5">
                {topInsiderBuys.length > 0 && (
                  <div className="cf-card p-4 bg-gradient-to-r from-emerald-500/5 to-teal-500/5 border border-emerald-500/10">
                    <p className="text-[10px] font-bold text-emerald-400 mb-3 flex items-center gap-1.5">
                      {t('topInsiderTitle')}
                      <span className="font-normal text-cf-text-secondary">{t('topInsiderSubtitle')}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {topInsiderBuys.map(row => <PriceCard key={row.ticker} ticker={row.ticker} badge={fmtUsd(row.totalValueUsd)} badgeCls="bg-emerald-500/20 text-emerald-300" sub={row.issuerName.slice(0, 18)} />)}
                    </div>
                    <p className="text-[9px] text-cf-text-secondary/40 mt-2">{t('priceCache')} &nbsp;|&nbsp; {t('insiderTrades', { date: dataDateInsider })}</p>
                  </div>
                )}

                {topCsuite.length > 0 && (
                  <div className="cf-card p-4 bg-gradient-to-r from-violet-500/5 to-purple-500/5 border border-violet-500/10">
                    <p className="text-[10px] font-bold text-violet-400 mb-3 flex items-center gap-1.5">
                      {t('topCsuiteTitle')}
                      <span className="font-normal text-cf-text-secondary">{t('topCsuiteSubtitle')}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {topCsuite.map(row => <PriceCard key={row.ticker} ticker={row.ticker} badge={row.topTitle?.slice(0, 10) ?? 'C-Suite'} badgeCls="bg-violet-500/20 text-violet-300" sub={row.topBuyer.split(' ').slice(-1)[0]} />)}
                    </div>
                    <p className="text-[9px] text-cf-text-secondary/40 mt-2">{t('priceCache')} &nbsp;|&nbsp; {t('insiderTrades', { date: dataDateInsider })}</p>
                  </div>
                )}

                {topClustered.filter(r => r.tradeCount >= 2).length > 0 && (
                  <div className="cf-card p-4 bg-gradient-to-r from-amber-500/5 to-yellow-500/5 border border-amber-500/10">
                    <p className="text-[10px] font-bold text-amber-400 mb-3 flex items-center gap-1.5">
                      {t('topClusteredTitle')}
                      <span className="font-normal text-cf-text-secondary">{t('topClusteredSubtitle')}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {topClustered.filter(r => r.tradeCount >= 2).slice(0, 5).map(row => (
                        <PriceCard key={row.ticker} ticker={row.ticker}
                          badge={t('tradeCount', { n: row.tradeCount })}
                          badgeCls="bg-amber-500/20 text-amber-300"
                          sub={t('totalAmount', { amount: fmtUsd(row.totalValueUsd) })} />
                      ))}
                    </div>
                    <p className="text-[9px] text-cf-text-secondary/40 mt-2">{t('priceCache')} &nbsp;|&nbsp; {t('insiderTrades', { date: dataDateInsider })}</p>
                  </div>
                )}

                {insiderSqueezeRows.length > 0 && (
                  <div className="cf-card p-4 bg-gradient-to-r from-orange-500/5 to-red-500/5 border border-orange-500/10">
                    <p className="text-[10px] font-bold text-orange-400 mb-3 flex items-center gap-1.5">
                      {t('topInsiderSqueezeTitle')}
                      <span className="font-normal text-cf-text-secondary">{t('topInsiderSqueezeSubtitle')}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {insiderSqueezeRows.map(row => (
                        <PriceCard key={row.ticker} ticker={row.ticker}
                          badge={String(row.squeezeScore)}
                          badgeCls="bg-orange-500/20 text-orange-300"
                          sub={row.shortVolPct != null ? `Short ${row.shortVolPct.toFixed(0)}%` : row.issuerName.slice(0, 14)} />
                      ))}
                    </div>
                    <p className="text-[9px] text-cf-text-secondary/40 mt-2">{t('priceCache')} &nbsp;|&nbsp; {t('insiderTrades', { date: dataDateInsider })}</p>
                  </div>
                )}
              </div>

              <div className="cf-card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-white/5">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colTicker')}</th>
                      <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colCompany')}</th>
                      <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colPrice')}</th>
                      <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{tf === '1w' ? '1W 수익률' : '4W 수익률'}</th>
                      <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colInsider')}</th>
                      <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colTitle')}</th>
                      <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colBuyAmount')}</th>
                      <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colTradeCount')}</th>
                      <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colRecentDate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insiderRows.slice(0, 50).map(row => (
                      <tr key={row.ticker} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="px-3 py-2.5">
                          <Link href={`/company/${row.ticker}` as Parameters<typeof Link>[0]['href']} className="font-bold text-cf-accent hover:underline flex items-center gap-1">
                            {row.ticker}<ExternalLink className="w-3 h-3 opacity-40" />
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary max-w-[130px] truncate">{row.issuerName}</td>
                        <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
                          {(() => { const lp = priceMap.get(row.ticker); return lp?.price != null ? <span className="text-cf-text-primary">${lp.price < 1000 ? lp.price.toFixed(2) : lp.price.toFixed(0)}</span> : <span className="text-cf-text-secondary/30 text-[10px]">···</span>; })()}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
                          {(() => { const lp = priceMap.get(row.ticker); const ret = lp?.ret ?? lp?.changePct ?? null; return ret != null ? <span className={ret >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>{ret >= 0 ? '+' : ''}{ret.toFixed(2)}%</span> : <span className="text-cf-text-secondary/30 text-[10px]">···</span>; })()}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary max-w-[120px] truncate">{row.topBuyer}</td>
                        <td className="px-3 py-2.5">
                          {row.topTitle && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${row.isCsuite ? 'bg-violet-500/20 text-violet-300' : 'bg-white/5 text-cf-text-secondary'}`}>
                              {row.topTitle.slice(0, 15)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-sm font-bold text-emerald-400">{fmtUsd(row.totalValueUsd)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`text-xs font-bold ${row.tradeCount >= 3 ? 'text-amber-400' : 'text-cf-text-primary'}`}>
                            {t('tradeCount', { n: row.tradeCount })}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary font-mono">
                          {row.trades.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))[0].transactionDate}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {insiderRows.length === 0 && <div className="text-center py-12 text-cf-text-secondary text-sm">{t('noInsiderBuysInPeriod')}</div>}
              </div>
              <p className="text-[10px] text-cf-text-secondary/40 mt-3">{t('sourceNoteInsider', { date: dataDateInsider })}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
