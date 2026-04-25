'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
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
  { id: 'today', label: '오늘', from: 0, to: 0 },
  { id: 'week', label: '이번 주', from: 0, to: 7 },
  { id: 'twoweeks', label: '2주', from: 0, to: 14 },
  { id: 'month', label: '1개월', from: 0, to: 30 },
] as const;

function dateFromOffset(offset: number): string {
  const d = new Date(Date.now() + 9 * 3600000 + offset * 86400000); // KST UTC+9
  return d.toISOString().slice(0, 10);
}

function SessionBadge({ session }: { session: EarningRow['session'] }) {
  if (session === 'pre') return <span title="Before Market Open" className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/30 inline-flex items-center gap-1"><Sun className="w-3 h-3" />장전</span>;
  if (session === 'after') return <span title="After Market Close" className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 border border-indigo-500/30 inline-flex items-center gap-1"><Moon className="w-3 h-3" />장후</span>;
  if (session === 'during') return <span title="During Market Hours" className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 inline-flex items-center gap-1"><Clock className="w-3 h-3" />장중</span>;
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
  const [preset, setPreset] = useState<typeof PRESETS[number]['id']>('twoweeks');
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'surprise'>('date');
  const [majorOnly, setMajorOnly] = useState(false);

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
    return filtered;
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
          실적 캘린더
        </h1>
        <p className="text-sm text-cf-text-secondary mt-1">
          블룸버그 EE 대응 · Finnhub 무료 데이터 · EPS·매출 컨센서스 vs 실제 surprise
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
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[200px] max-w-sm relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cf-text-secondary" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="티커·기업명 검색 (NVDA, Apple…)"
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-cf-text-primary placeholder:text-cf-text-secondary"
          />
        </div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="text-xs px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg text-cf-text-primary"
        >
          <option value="date">날짜순</option>
          <option value="surprise">Surprise 크기순</option>
        </select>
        <button
          onClick={() => setMajorOnly(v => !v)}
          className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors ${
            majorOnly
              ? 'bg-cf-accent/20 border-cf-accent text-cf-accent font-semibold'
              : 'bg-white/5 border-white/10 text-cf-text-secondary hover:bg-white/10'
          }`}
          title="S&P 100 + 주요 대형주만 표시"
        >
          <Star className="w-3.5 h-3.5" />
          주요 종목
        </button>
        <button
          onClick={() => load()}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 flex items-center gap-1.5 disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </button>
      </div>

      {/* Stats */}
      {data && !data.warning && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="cf-card p-3">
            <p className="text-[10px] text-cf-text-secondary">전체 건수</p>
            <p className="text-lg font-bold text-cf-text-primary">{stats.total.toLocaleString()}</p>
          </div>
          <div className="cf-card p-3">
            <p className="text-[10px] text-cf-text-secondary">발표 완료</p>
            <p className="text-lg font-bold text-cf-text-primary">{stats.reported.toLocaleString()}</p>
          </div>
          <div className="cf-card p-3 border-emerald-500/30">
            <p className="text-[10px] text-cf-text-secondary">예상 상회 (Beat)</p>
            <p className="text-lg font-bold text-emerald-600">{stats.beats.toLocaleString()}</p>
          </div>
          <div className="cf-card p-3 border-red-500/30">
            <p className="text-[10px] text-cf-text-secondary">예상 하회 (Miss)</p>
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
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">날짜</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">시간</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">티커</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">기업명</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">분기</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">EPS 예상</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">EPS 실제</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">EPS Surprise</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">매출 예상</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">매출 실제</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">매출 Surprise</th>
                <th className="text-center px-3 py-2 text-[11px] font-semibold text-cf-text-secondary">링크</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={12} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-cf-text-secondary" /></td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={12} className="text-center py-8 text-cf-text-secondary text-sm">
                  {data?.error ? `오류: ${data.error}` : '해당 기간 실적 발표 없음'}
                </td></tr>
              )}
              {!loading && rows.map((r, i) => (
                <tr key={`${r.symbol}-${r.date}-${i}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-mono text-xs text-cf-text-primary whitespace-nowrap">{r.date}</td>
                  <td className="px-3 py-2"><SessionBadge session={r.session} /></td>
                  <td className="px-3 py-2">
                    <Link href={`/company/${r.symbol}`} className="font-mono text-xs font-bold text-cf-accent hover:underline">{r.symbol}</Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-cf-text-secondary max-w-[120px] truncate" title={r.companyName ?? ''}>
                    {r.companyName ?? <span className="opacity-40">-</span>}
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
          업데이트: {new Date(data.updatedAt).toLocaleString(locale)} · 출처: Finnhub · {data.cached ? '캐시됨 (2h TTL)' : '실시간'}
        </p>
      )}
    </div>
  );
}
