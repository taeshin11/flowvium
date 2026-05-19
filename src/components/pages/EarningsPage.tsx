'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Calendar, Loader2, RefreshCw, TrendingUp, TrendingDown, Clock, Sun, Moon, ExternalLink, Search, Star } from 'lucide-react';
import { Link } from '@/i18n/routing';

interface EarningRow {
  date: string;
  symbol: string;
  companyName: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  hour: 'bmo' | 'amc' | 'dmh' | '' | null;
  quarter: number;
  year: number;
  epsSurprise: number | null;
  revenueSurprise: number | null;
  session: 'pre' | 'after' | 'during' | null;
}

interface EarningsResponse {
  earnings: EarningRow[];
  from: string;
  to: string;
  count?: number;
  updatedAt?: string;
  warning?: string;
  error?: string;
  cached?: boolean;
}

// S&P 100 / 주요 글로벌 대형주 — 실적 캘린더 "주요 종목만" 필터 대상
const MAJOR_TICKERS = new Set([
  // Mag7
  'AAPL','MSFT','NVDA','GOOGL','GOOG','AMZN','META','TSLA',
  // Semiconductors
  'INTC','AMD','AVGO','QCOM','MU','AMAT','LRCX','KLAC','TSM','ASML','ARM','MRVL','SMCI','MCHP',
  // Finance
  'JPM','BAC','WFC','GS','MS','BLK','V','MA','AXP','BX','C','SCHW',
  // Healthcare
  'JNJ','LLY','ABBV','MRK','PFE','UNH','AMGN','GILD','REGN','MRNA','BMY','CVS',
  // Energy
  'XOM','CVX','COP','SLB','EOG',
  // Consumer / Retail
  'COST','WMT','TGT','HD','SBUX','NKE','MCD','LOW','TJX',
  // Industrials / Defense
  'CAT','RTX','LMT','BA','GE','HON','NOC','LHX','KTOS',
  // Tech / Software
  'CRM','ORCL','ADBE','NFLX','NOW','SNOW','PLTR','PANW','INTU','IBM',
  // Crypto / Alt
  'COIN','MSTR','MARA',
  // Telecom
  'T','VZ','TMUS',
  // Korea/global
  'BABA','TSM','NIO',
]);

const PRESETS = [
  { id: 'yesterday', from: 'lastTradingDay', to: 'lastTradingDay' },
  { id: 'today', from: 0, to: 0 },
  { id: 'week', from: 0, to: 7 },
  { id: 'twoweeks', from: 0, to: 14 },
  { id: 'month', from: 0, to: 30 },
] as const;

function dateFromOffset(offset: number | 'lastTradingDay'): string {
  if (offset === 'lastTradingDay') {
    // KST 기준 오늘 → 미국 직전 거래일 (월=금요일, 일=금요일, 토=금요일, 평일=어제)
    const now = new Date(Date.now() + 9 * 3600000);
    const dow = now.getUTCDay(); // KST 보정 후이므로 UTCDay = KST day
    // 미국 거래일 기준: 한국 월(1) → 미국 금(diff=-3), 한국 화(2)~금(5) → 미국 전일(-1), 한국 토(6) → 미국 금(-1), 한국 일(0) → 미국 금(-2)
    const offsetDays = dow === 1 ? -3 : dow === 0 ? -2 : dow === 6 ? -1 : -1;
    const d = new Date(now.getTime() + offsetDays * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(Date.now() + 9 * 3600000 + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

function SessionBadge({ session }: { session: EarningRow['session'] }) {
  const t = useTranslations('earnings');
  if (session === 'pre') return <span title="Before Market Open" className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/30 inline-flex items-center gap-1"><Sun className="w-3 h-3" />{t('sessionPre')}</span>;
  if (session === 'after') return <span title="After Market Close" className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 border border-indigo-500/30 inline-flex items-center gap-1"><Moon className="w-3 h-3" />{t('sessionAfter')}</span>;
  if (session === 'during') return <span title="During Market Hours" className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{t('sessionDuring')}</span>;
  return <span className="text-[10px] text-gray-400">-</span>;
}

function fmtNum(n: number | null, suffix = ''): string {
  if (n == null) return '-';
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B${suffix}`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M${suffix}`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K${suffix}`;
  return n.toFixed(2) + suffix;
}

function SurpriseBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-gray-400 text-xs">-</span>;
  const color = pct > 5 ? 'text-emerald-600' : pct > 0 ? 'text-emerald-500' : pct < -5 ? 'text-red-600' : 'text-red-400';
  const icon = pct > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />;
  return <span className={`inline-flex items-center gap-0.5 font-mono text-xs ${color}`}>{icon}{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</span>;
}

export default function EarningsPage() {
  const locale = useLocale();
  const t = useTranslations('earnings');
  const [preset, setPreset] = useState<typeof PRESETS[number]['id']>('yesterday');
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'surprise'>('date');
  const [majorOnly, setMajorOnly] = useState(false);

  const PRESET_LABELS: Record<string, string> = {
    yesterday: t('presetYesterday'),
    today: t('presetToday'),
    week: t('presetWeek'),
    twoweeks: t('presetTwoweeks'),
    month: t('presetMonth'),
  };

  const range = useMemo(() => {
    const p = PRESETS.find(x => x.id === preset) ?? PRESETS[2];
    return { from: dateFromOffset(p.from), to: dateFromOffset(p.to) };
  }, [preset]);

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/earnings?from=${range.from}&to=${range.to}`, signal ? { signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (signal?.aborted) return;
      setData(json);
    } catch (err) {
      if (signal?.aborted) return;
      setData({ earnings: [], from: range.from, to: range.to, error: err instanceof Error ? err.message : 'Fetch failed' });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!data?.earnings) return [];
    const q = search.trim().toUpperCase();
    let filtered = q ? data.earnings.filter(e => e.symbol?.includes(q) || e.companyName?.toUpperCase().includes(q)) : data.earnings;
    if (majorOnly) filtered = filtered.filter(e => MAJOR_TICKERS.has(e.symbol?.toUpperCase() ?? ''));
    if (sortBy === 'surprise') {
      return [...filtered].sort((a, b) => Math.abs(b.epsSurprise ?? 0) - Math.abs(a.epsSurprise ?? 0));
    }
    // date 정렬: 메이저 종목을 같은 날짜 내에서 위로 (사용자가 자주 보는 종목 부각)
    return [...filtered].sort((a, b) => {
      const dateCmp = (a.date ?? '').localeCompare(b.date ?? '');
      if (dateCmp !== 0) return dateCmp;
      const aMajor = MAJOR_TICKERS.has(a.symbol?.toUpperCase() ?? '');
      const bMajor = MAJOR_TICKERS.has(b.symbol?.toUpperCase() ?? '');
      if (aMajor && !bMajor) return -1;
      if (!aMajor && bMajor) return 1;
      return 0;
    });
  }, [data, search, sortBy, majorOnly]);

  const stats = useMemo(() => {
    const withActual = rows.filter(r => r.epsActual != null && r.epsEstimate != null);
    const beats = withActual.filter(r => (r.epsSurprise ?? 0) > 0).length;
    const misses = withActual.filter(r => (r.epsSurprise ?? 0) < 0).length;
    return { total: rows.length, reported: withActual.length, beats, misses };
  }, [rows]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-cf-text-primary flex items-center gap-2">
          <Calendar className="w-6 h-6 text-cf-accent" />
          {t('pageTitle')}
        </h1>
        <p className="text-sm text-cf-text-secondary mt-1">
          {t('pageDesc')}
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex gap-1">
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                preset === p.id
                  ? 'bg-cf-accent/20 border-cf-accent text-cf-accent font-semibold'
                  : 'bg-white/5 border-white/10 text-cf-text-secondary hover:bg-white/10'
              }`}
            >
              {PRESET_LABELS[p.id]}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[200px] max-w-sm relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cf-text-secondary" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-cf-text-primary placeholder:text-cf-text-secondary"
          />
        </div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="text-xs px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg text-cf-text-primary"
        >
          <option value="date">{t('sortDate')}</option>
          <option value="surprise">{t('sortSurprise')}</option>
        </select>
        <button
          onClick={() => setMajorOnly(v => !v)}
          className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors ${
            majorOnly
              ? 'bg-cf-accent/20 border-cf-accent text-cf-accent font-semibold'
              : 'bg-white/5 border-white/10 text-cf-text-secondary hover:bg-white/10'
          }`}
          title={t('filterMajorTitle')}
        >
          <Star className="w-3.5 h-3.5" />
          {t('filterMajor')}
        </button>
        <button
          onClick={() => load()}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 flex items-center gap-1.5 disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </button>
      </div>

      {/* Stats */}
      {data && !data.warning && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="cf-card p-3">
            <p className="text-[10px] text-cf-text-secondary">{t('statTotal')}</p>
            <p className="text-lg font-bold text-cf-text-primary">{stats.total.toLocaleString()}</p>
          </div>
          <div className="cf-card p-3">
            <p className="text-[10px] text-cf-text-secondary">{t('statReported')}</p>
            <p className="text-lg font-bold text-cf-text-primary">{stats.reported.toLocaleString()}</p>
          </div>
          <div className="cf-card p-3 border-emerald-500/30">
            <p className="text-[10px] text-cf-text-secondary">{t('statBeat')}</p>
            <p className="text-lg font-bold text-emerald-600">{stats.beats.toLocaleString()}</p>
          </div>
          <div className="cf-card p-3 border-red-500/30">
            <p className="text-[10px] text-cf-text-secondary">{t('statMiss')}</p>
            <p className="text-lg font-bold text-red-500">{stats.misses.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Warning */}
      {data?.warning && (
        <div className="cf-card p-4 mb-5 bg-amber-500/5 border border-amber-500/30">
          <p className="text-sm text-amber-600">⚠️ {data.warning}</p>
        </div>
      )}

      {/* Table */}
      <div className="cf-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 border-b border-white/10 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">{t('colDate')}</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">{t('colTime')}</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">{t('colTicker')}</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">{t('colCompany')}</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">{t('colQuarter')}</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">{t('colEpsEst')}</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">{t('colEpsAct')}</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">{t('colEpsSurprise')}</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">{t('colRevEst')}</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">{t('colRevAct')}</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">{t('colRevSurprise')}</th>
                <th className="text-center px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">{t('colLink')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={12} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-cf-text-secondary" /></td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={12} className="text-center py-8 text-cf-text-secondary text-sm">
                  {data?.error ? t('emptyError', { error: data.error }) : t('emptyNone')}
                </td></tr>
              )}
              {!loading && rows.map((r, i) => (
                <tr key={`${r.symbol}-${r.date}-${i}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-mono text-xs text-cf-text-primary whitespace-nowrap">{r.date}</td>
                  <td className="px-3 py-2"><SessionBadge session={r.session} /></td>
                  <td className="px-3 py-2">
                    <Link href={`/company/${r.symbol}`} className="font-mono text-xs font-bold text-cf-accent hover:underline">{r.symbol}</Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-cf-text-secondary max-w-[120px] truncate" title={r.companyName ?? r.symbol}>
                    {r.companyName ?? <span className="opacity-50 font-mono">{r.symbol}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-cf-text-secondary font-mono">Q{r.quarter} {r.year}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-cf-text-secondary">{fmtNum(r.epsEstimate)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-cf-text-primary font-semibold">{fmtNum(r.epsActual)}</td>
                  <td className="px-3 py-2 text-right"><SurpriseBadge pct={r.epsSurprise} /></td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-cf-text-secondary">{fmtNum(r.revenueEstimate)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-cf-text-primary font-semibold">{fmtNum(r.revenueActual)}</td>
                  <td className="px-3 py-2 text-right"><SurpriseBadge pct={r.revenueSurprise} /></td>
                  <td className="px-3 py-2 text-center">
                    <a
                      href={`https://finance.yahoo.com/quote/${r.symbol}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-cf-text-secondary hover:text-cf-accent"
                      title="Yahoo Finance"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data?.updatedAt && (
        <p className="text-[10px] text-cf-text-secondary mt-3 text-right">
          {t('updatedAt', {
            date: new Date(data.updatedAt).toLocaleString(locale),
            cache: data.cached ? t('cacheHit') : t('cacheNo'),
          })}
        </p>
      )}
    </div>
  );
}
