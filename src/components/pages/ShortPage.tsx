'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw, Loader2, ArrowUpDown, ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/routing';
import type { ShortEntry } from '@/app/api/short-interest/route';

const ACTION_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  accumulating: { color: '#10b981', icon: <TrendingUp className="w-3 h-3" /> },
  new_position: { color: '#3b82f6', icon: <TrendingUp className="w-3 h-3" /> },
  reducing:     { color: '#f59e0b', icon: <TrendingDown className="w-3 h-3" /> },
  exit:         { color: '#ef4444', icon: <Minus className="w-3 h-3" /> },
};

type SortKey = 'squeezeScore' | 'shortVolPct' | 'shortFloatPct' | 'shortRatio' | 'shortChangeMonthly' | 'trailingPE' | 'ticker';

function SqueezeBar({ score, label }: { score: number; label: string }) {
  const color = score >= 70 ? '#ef4444' : score >= 45 ? '#f59e0b' : score >= 25 ? '#6366f1' : '#64748b';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden min-w-[60px]">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-bold min-w-[28px]" style={{ color }}>{label}</span>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="cf-card px-4 py-3">
      <p className="text-[10px] text-cf-text-secondary mb-1">{label}</p>
      <p className="text-lg font-bold text-cf-text-primary">{value}</p>
      {sub && <p className="text-[10px] text-cf-text-secondary mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ShortPage() {
  const t = useTranslations('short');
  const [entries, setEntries] = useState<ShortEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('squeezeScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');

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

  const squeezeLabel = (score: number) =>
    score >= 70 ? t('sqzDanger') : score >= 45 ? t('sqzCaution') : score >= 25 ? t('sqzNormal') : t('sqzLow');

  const load = async (force = false, signal?: AbortSignal) => {
    if (force) setRefreshing(true);
    try {
      const res = await fetch(`/api/short-interest${force ? '?refresh=1' : ''}`, signal ? { signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      setEntries(data.entries ?? []);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    load(false, controller.signal);
    return () => controller.abort();
  }, []);

  const sectors = useMemo(() => ['all', ...Array.from(new Set(entries.map(e => e.sector)))], [entries]);

  const sorted = useMemo(() => {
    const filtered = entries
      .filter(e => sectorFilter === 'all' || e.sector === sectorFilter)
      .filter(e => actionFilter === 'all' || e.instAction === actionFilter);

    return [...filtered].sort((a, b) => {
      const va = a[sortKey] ?? -999;
      const vb = b[sortKey] ?? -999;
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [entries, sortKey, sortDir, sectorFilter, actionFilter]);

  const topSqueeze = useMemo(() => entries.filter(e => e.squeezeScore >= 45).length, [entries]);
  const avgShort = useMemo(() => {
    const valid = entries.filter(e => e.shortVolPct != null);
    if (!valid.length) return null;
    return (valid.reduce((s, e) => s + (e.shortVolPct ?? 0), 0) / valid.length).toFixed(1);
  }, [entries]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortTh = ({ label, k }: { label: string; k: SortKey }) => (
    <th
      className="px-3 py-2 text-left text-[10px] text-cf-text-secondary cursor-pointer hover:text-cf-text-primary select-none whitespace-nowrap"
      onClick={() => handleSort(k)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />
        {sortKey === k && <span className="opacity-70">{sortDir === 'desc' ? '↓' : '↑'}</span>}
      </div>
    </th>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] gap-3 text-cf-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>{t('loadingData')}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-cf-text-primary flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-400" />
            {t('title')}
          </h1>
          <p className="text-sm text-cf-text-secondary mt-1">
            {t('subtitle')}
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label={t('statTracked')} value={`${entries.length}`} sub={t('statTrackedSub')} />
        <StatCard label={t('statSqueezeRisk')} value={`${topSqueeze}`} sub={t('statSqueezeRiskSub')} />
        <StatCard label={t('statAvgShortVol')} value={avgShort ? `${avgShort}%` : '-'} sub={t('statAvgShortVolSub')} />
        <StatCard
          label={t('statTopScore')}
          value={sorted[0] ? t('statTopScoreValue', { score: sorted[0].squeezeScore }) : '-'}
          sub={sorted[0]?.ticker ?? ''}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={sectorFilter}
          onChange={e => setSectorFilter(e.target.value)}
          className="text-xs bg-cf-card border border-white/10 rounded-lg px-3 py-1.5 text-cf-text-primary"
        >
          <option value="all">{t('filterAllSectors')}</option>
          {sectors.filter(s => s !== 'all').map(s => (
            <option key={s} value={s}>{sectorLabels[s] ?? s}</option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          className="text-xs bg-cf-card border border-white/10 rounded-lg px-3 py-1.5 text-cf-text-primary"
        >
          <option value="all">{t('filterAllActions')}</option>
          <option value="accumulating">{t('actionAccumulating')}</option>
          <option value="new_position">{t('actionNew')}</option>
          <option value="reducing">{t('actionReducing')}</option>
          <option value="exit">{t('actionExit')}</option>
        </select>
        {/* Preset filters */}
        <button
          onClick={() => { setActionFilter('accumulating'); setSortKey('squeezeScore'); setSortDir('desc'); }}
          className="text-[10px] px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-colors"
        >
          {t('presetSqueeze')}
        </button>
        <button
          onClick={() => { setActionFilter('all'); setSortKey('shortVolPct'); setSortDir('desc'); }}
          className="text-[10px] px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
        >
          {t('presetHighShort')}
        </button>
      </div>

      {/* Table */}
      <div className="cf-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-white/5">
            <tr>
              <SortTh label={t('colTicker')} k="ticker" />
              <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colCompany')}</th>
              <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colSector')}</th>
              <SortTh label="Short Vol % (FINRA)" k="shortVolPct" />
              <SortTh label={t('colShortFloat')} k="shortFloatPct" />
              <SortTh label="Days to Cover" k="shortRatio" />
              <SortTh label={t('colMom')} k="shortChangeMonthly" />
              <SortTh label="PER (TTM)" k="trailingPE" />
              <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">{t('colInstAction')}</th>
              <SortTh label={t('colSqueezeScore')} k="squeezeScore" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(entry => {
              const actionCfg = entry.instAction ? ACTION_CONFIG[entry.instAction] : null;
              const actionLabel = entry.instAction ? (actionLabels[entry.instAction] ?? entry.instAction) : null;
              return (
                <tr key={entry.ticker} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/company/${entry.ticker}` as Parameters<typeof Link>[0]['href']}
                      className="font-bold text-cf-accent hover:underline flex items-center gap-1"
                    >
                      {entry.ticker}
                      <ExternalLink className="w-3 h-3 opacity-40" />
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary max-w-[140px] truncate">
                    {entry.companyName || entry.ticker}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-cf-text-secondary">
                      {sectorLabels[entry.sector] ?? entry.sector}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {entry.shortVolPct != null ? (
                      <span className={`font-mono font-semibold text-sm ${entry.shortVolPct > 60 ? 'text-red-400' : entry.shortVolPct > 50 ? 'text-amber-400' : 'text-cf-text-primary'}`}>
                        {entry.shortVolPct.toFixed(1)}%
                      </span>
                    ) : <span className="text-cf-text-secondary/40">-</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-sm">
                    {entry.shortFloatPct != null ? (
                      <span className={entry.shortFloatPct > 20 ? 'text-red-400' : entry.shortFloatPct > 10 ? 'text-amber-400' : 'text-cf-text-primary'}>
                        {entry.shortFloatPct.toFixed(1)}%
                      </span>
                    ) : <span className="text-cf-text-secondary/40">-</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-sm">
                    {entry.shortRatio != null ? (
                      <span className={entry.shortRatio > 5 ? 'text-amber-400' : 'text-cf-text-primary'}>
                        {entry.shortRatio.toFixed(1)}{t('daysUnit')}
                      </span>
                    ) : <span className="text-cf-text-secondary/40">-</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-sm">
                    {entry.shortChangeMonthly != null ? (
                      <span className={entry.shortChangeMonthly > 5 ? 'text-red-400' : entry.shortChangeMonthly < -5 ? 'text-green-400' : 'text-cf-text-secondary'}>
                        {entry.shortChangeMonthly > 0 ? '+' : ''}{entry.shortChangeMonthly.toFixed(1)}%
                      </span>
                    ) : <span className="text-cf-text-secondary/40">-</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-sm">
                    {entry.trailingPE != null ? (
                      <span className={entry.trailingPE > 50 ? 'text-amber-400' : entry.trailingPE < 15 ? 'text-green-400' : 'text-cf-text-primary'}>
                        {entry.trailingPE.toFixed(1)}x
                      </span>
                    ) : <span className="text-cf-text-secondary/40">-</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {actionCfg && actionLabel ? (
                      <span
                        className="flex items-center gap-1 text-[10px] font-semibold w-fit px-1.5 py-0.5 rounded"
                        style={{ color: actionCfg.color, backgroundColor: actionCfg.color + '20' }}
                      >
                        {actionCfg.icon}
                        {actionLabel}
                      </span>
                    ) : <span className="text-cf-text-secondary/40 text-[10px]">{t('noData')}</span>}
                  </td>
                  <td className="px-3 py-2.5 min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm w-8 text-right">{entry.squeezeScore}</span>
                      <div className="flex-1">
                        <SqueezeBar score={entry.squeezeScore} label={squeezeLabel(entry.squeezeScore)} />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div className="text-center py-12 text-cf-text-secondary text-sm">
            {t('noResults')}
          </div>
        )}
      </div>

      <p className="text-[10px] text-cf-text-secondary/40 mt-3">
        {t('sourceNote')}
      </p>
    </div>
  );
}
