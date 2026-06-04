'use client';

import { useState, useMemo, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { type InstitutionalSignal } from '@/data/institutional-signals';
import { type NewsGapEntry } from '@/data/news-gap';
import { sectors } from '@/data/sectors';
import dynamic from 'next/dynamic';
const StockSupplyModal = dynamic(() => import('@/components/StockSupplyModal'), { ssr: false });
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Plus,
  LogOut,
  Filter,
  ArrowUpDown,
  Activity,
  AlertTriangle,
  Zap,
  Database,
  BarChart2,
} from 'lucide-react';

const actionColors: Record<string, { text: string; bg: string; key: string }> = {
  accumulating: { text: 'text-green-600', bg: 'bg-green-50', key: 'accumulating' },
  reducing: { text: 'text-red-600', bg: 'bg-red-50', key: 'reducing' },
  new_position: { text: 'text-blue-600', bg: 'bg-blue-50', key: 'new_position' },
  exit: { text: 'text-orange-600', bg: 'bg-orange-50', key: 'exit' },
};

const actionIcons: Record<string, React.ReactNode> = {
  accumulating: <TrendingUp className="w-3.5 h-3.5" />,
  reducing: <TrendingDown className="w-3.5 h-3.5" />,
  new_position: <Plus className="w-3.5 h-3.5" />,
  exit: <LogOut className="w-3.5 h-3.5" />,
};

const sectorColors: Record<string, string> = {
  semiconductors: '#6366f1',
  'ai-cloud': '#3b82f6',
  'ev-battery': '#22c55e',
  defense: '#ef4444',
  'pharma-biotech': '#a855f7',
};

type SortKey = 'date' | 'value' | 'gap';

interface SignalsPageProps {
  initialSignals: InstitutionalSignal[];
  lastUpdated: string;
  updatedTickers: number;
  source: 'live' | 'cached' | 'static';
}

export default function SignalsPage({
  initialSignals,
  lastUpdated,
  updatedTickers,
  source,
}: SignalsPageProps) {
  const t = useTranslations('signals');
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [institutionFilter, setInstitutionFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [page, setPage] = useState(0);
  const [supplyTicker, setSupplyTicker] = useState<string | null>(null);

  const PAGE_SIZE = 100;

  const institutions = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of initialSignals) {
      map[s.institution] = (map[s.institution] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [initialSignals]);

  const filtered = useMemo(() => {
    let result = [...initialSignals];
    if (sectorFilter !== 'all') {
      result = result.filter((s) => s.sector === sectorFilter);
    }
    if (actionFilter !== 'all') {
      result = result.filter((s) => s.action === actionFilter);
    }
    if (institutionFilter !== 'all') {
      result = result.filter((s) => s.institution === institutionFilter);
    }

    result.sort((a, b) => {
      if (sortBy === 'date') return b.filingDate.localeCompare(a.filingDate);
      if (sortBy === 'gap') return b.newsGapScore - a.newsGapScore;
      // sort by value - parse the estimated value
      const parseVal = (v: string) => {
        const num = parseFloat(v.replace(/[^0-9.-]/g, ''));
        return isNaN(num) ? 0 : Math.abs(num);
      };
      return parseVal(b.estimatedValue) - parseVal(a.estimatedValue);
    });

    return result;
  }, [sectorFilter, actionFilter, institutionFilter, sortBy]);

  // 2026-06-04: 정적 newsGapData → 라이브 /api/news-gap (시계열, 정적 금지).
  const [liveNewsGap, setLiveNewsGap] = useState<NewsGapEntry[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/news-gap', { signal: ctrl.signal }).then(r => r.ok ? r.json() : null)
      .then(d => { if (!ctrl.signal.aborted && Array.isArray(d?.entries)) setLiveNewsGap(d.entries); }).catch(() => {});
    return () => ctrl.abort();
  }, []);
  // Pre-computed lookup map — avoids O(n²) in table render
  const newsGapMap = useMemo(() => {
    const map: Record<string, NewsGapEntry> = {};
    for (const entry of liveNewsGap) map[entry.ticker] = entry;
    return map;
  }, [liveNewsGap]);

  // Reset to page 0 when filters/sort change
  const pagedSignals = useMemo(() => {
    return filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [filtered, page]);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // Sector breakdown for bar chart
  const sectorBreakdown = useMemo(() => {
    const map: Record<string, { accumulating: number; reducing: number }> = {};
    for (const s of initialSignals) {
      if (!map[s.sector]) map[s.sector] = { accumulating: 0, reducing: 0 };
      if (s.action === 'accumulating' || s.action === 'new_position') {
        map[s.sector].accumulating += 1;
      } else {
        map[s.sector].reducing += 1;
      }
    }
    return Object.entries(map).map(([sector, data]) => ({
      sector: sector.replace('-', '/').slice(0, 12),
      sectorId: sector,
      Accumulating: data.accumulating,
      Reducing: data.reducing,
    }));
  }, []);

  const topInstitutions = institutions.slice(0, 8);

  return (
    <>
    {supplyTicker && (
      <StockSupplyModal ticker={supplyTicker} onClose={() => setSupplyTicker(null)} />
    )}
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cf-secondary/10 text-cf-secondary text-sm font-medium">
            <Activity className="w-4 h-4" />
            {t('title')}
          </div>
          {source === 'live' ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-xs font-semibold border border-green-200">
              <Zap className="w-3.5 h-3.5" />
              {t('liveRefreshed', { count: updatedTickers })}
            </div>
          ) : source === 'cached' ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium border border-blue-200">
              <Database className="w-3.5 h-3.5" />
              {updatedTickers} tickers cached
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium border border-gray-200">
              <Database className="w-3.5 h-3.5" />
              {t('staticData')}
            </div>
          )}
          <span className="text-xs text-cf-text-muted ml-auto">
            Updated {new Date(lastUpdated).toLocaleString('en-US', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
        <h1 className="text-4xl font-heading font-bold text-cf-text-primary mb-2">
          {t('title')}
        </h1>
        <p className="text-lg text-cf-text-secondary">{t('subtitle')}</p>
      </div>

      {/* Filters */}
      <div className="cf-card p-4 mb-8">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-cf-text-secondary" />
            <span className="text-sm font-medium text-cf-text-secondary">{t('filters')}:</span>
          </div>

          <select
            value={sectorFilter}
            onChange={(e) => { setSectorFilter(e.target.value); setPage(0); }}
            className="cf-input w-auto text-sm py-1.5"
          >
            <option value="all">{t('allSectors')}</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}
            className="cf-input w-auto text-sm py-1.5"
          >
            <option value="all">{t('allActions')}</option>
            <option value="accumulating">{t('actions.accumulating')}</option>
            <option value="reducing">{t('actions.reducing')}</option>
            <option value="new_position">{t('actions.new_position')}</option>
            <option value="exit">{t('actions.exit')}</option>
          </select>

          <select
            value={institutionFilter}
            onChange={(e) => { setInstitutionFilter(e.target.value); setPage(0); }}
            className="cf-input w-auto text-sm py-1.5"
          >
            <option value="all">{t('allInstitutions')}</option>
            {institutions.map(([name, count]) => (
              <option key={name} value={name}>
                {name} ({count})
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 ml-auto">
            <ArrowUpDown className="w-4 h-4 text-cf-text-secondary" />
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value as SortKey); setPage(0); }}
              className="cf-input w-auto text-sm py-1.5"
            >
              <option value="date">{t('sortByDate')}</option>
              <option value="value">{t('sortByValue')}</option>
              <option value="gap">{t('sortByGap')}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        {/* Sector breakdown chart */}
        <div className="cf-card p-6">
          <h3 className="text-lg font-heading font-bold text-cf-text-primary mb-4">
            {t('sectorActivity')}
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sectorBreakdown} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="sector" width={80} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="Accumulating" fill="#5CB88A" radius={[0, 4, 4, 0]} />
                <Bar dataKey="Reducing" fill="#D97171" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Institutions */}
        <div className="cf-card p-6 lg:col-span-2">
          <h3 className="text-lg font-heading font-bold text-cf-text-primary mb-4">
            {t('mostActiveInstitutions')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {topInstitutions.map(([name, count], i) => (
              <div
                key={name}
                onClick={() => setInstitutionFilter(institutionFilter === name ? 'all' : name)}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${institutionFilter === name ? 'bg-cf-primary/10 border border-cf-primary/30' : 'bg-gray-50 hover:bg-gray-100'}`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-cf-primary/10 text-cf-primary text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="text-sm text-cf-text-primary font-medium truncate">
                    {name}
                  </span>
                </div>
                <span className="text-xs text-cf-text-secondary bg-white px-2 py-1 rounded-full">
                  {t('signalsCount', { count })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Signal table/cards */}
      <div className="cf-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-cf-border">
                <th className="text-left py-3 px-4 text-cf-text-secondary font-medium text-xs">{t('company')}</th>
                <th className="text-left py-3 px-4 text-cf-text-secondary font-medium text-xs">{t('institution')}</th>
                <th className="text-left py-3 px-4 text-cf-text-secondary font-medium text-xs">{t('action')}</th>
                <th className="text-right py-3 px-4 text-cf-text-secondary font-medium text-xs">{t('ownershipPct')}</th>
                <th className="text-right py-3 px-4 text-cf-text-secondary font-medium text-xs">{t('sharesChanged')}</th>
                <th className="text-right py-3 px-4 text-cf-text-secondary font-medium text-xs">{t('value')}</th>
                <th className="text-center py-3 px-4 text-cf-text-secondary font-medium text-xs">{t('gapScore')}</th>
                <th className="text-right py-3 px-4 text-cf-text-secondary font-medium text-xs">{t('filingDate')}</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {pagedSignals.map((sig) => {
                const action = actionColors[sig.action];
                // 지분율 데이터 매칭 — O(1) lookup via pre-built map
                const ownerEntry = newsGapMap[sig.ticker];
                const ownerRecord = ownerEntry?.ownershipData?.find(
                  o => o.institution.toLowerCase().includes(sig.institution.toLowerCase().split(' ')[0])
                ) ?? ownerEntry?.ownershipData?.[0];
                const diff = ownerRecord?.prevPct !== undefined && ownerRecord?.pctOfShares !== undefined
                  ? ownerRecord.pctOfShares - ownerRecord.prevPct : null;
                return (
                  <tr key={sig.id} className="border-b border-cf-border/50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4">
                      <Link href={`/company/${sig.ticker}`} className="hover:text-cf-primary transition-colors">
                        <span className="font-mono font-bold text-cf-primary text-xs mr-2">{sig.ticker}</span>
                        <span className="text-cf-text-primary text-sm">{sig.companyName || sig.ticker}</span>
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-cf-text-secondary text-sm">{sig.institution}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${action.bg} ${action.text}`}>
                        {actionIcons[sig.action]}
                        {t(`actions.${action.key}`)}
                      </span>
                    </td>
                    {/* 지분율 컬럼 */}
                    <td className="text-right py-3 px-4">
                      {ownerRecord ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs font-bold tabular-nums text-cf-text-primary">
                            {ownerRecord.pctOfShares.toFixed(2)}%
                          </span>
                          {diff !== null && diff !== 0 && (
                            <span className={`text-[10px] font-bold tabular-nums ${diff > 0 ? 'text-green-600' : 'text-red-500'}`}>
                              {diff > 0 ? '+' : ''}{diff.toFixed(2)}%p
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="text-right py-3 px-4 font-mono text-xs text-cf-text-secondary">
                      {sig.sharesChanged.toLocaleString()}
                    </td>
                    <td className="text-right py-3 px-4 font-medium text-cf-text-primary text-sm">
                      {sig.estimatedValue}
                    </td>
                    <td className="text-center py-3 px-4">
                      <div className="flex items-center justify-center gap-1.5">
                        {sig.newsGapScore >= 70 && <AlertTriangle className="w-3.5 h-3.5 text-cf-accent" />}
                        <span className={`text-xs font-bold ${sig.newsGapScore >= 70 ? 'text-cf-accent' : sig.newsGapScore >= 40 ? 'text-cf-primary' : 'text-cf-text-secondary'}`}>
                          {sig.newsGapScore}
                        </span>
                      </div>
                    </td>
                    <td className="text-right py-3 px-4 text-xs text-cf-text-secondary">{sig.filingDate}</td>
                    <td className="py-3 px-3">
                      <button
                        onClick={() => setSupplyTicker(sig.ticker)}
                        className="flex items-center gap-1 text-[10px] font-bold text-violet-600 bg-violet-50 hover:bg-violet-100 px-2 py-1 rounded-lg transition-colors"
                        title={t('supplyDemandTitle')}
                      >
                        <BarChart2 className="w-3 h-3" />
                        {t('supplyDemand')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-cf-text-secondary">
            {t('noSignalsMatch')}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 px-2">
            <span className="text-sm text-cf-text-secondary">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} / {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-sm rounded-lg border border-cf-border disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                ←
              </button>
              <span className="text-sm text-cf-text-secondary">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-cf-border disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
