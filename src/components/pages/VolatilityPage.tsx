'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ArrowUpDown, ExternalLink, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { Link } from '@/i18n/routing';
import type { IvScreenerResponse } from '@/app/api/iv-screener/route';

type SortKey = 'atmIv30d' | 'termSlope' | 'skew25d' | 'putCallRatio' | 'qualityScore' | 'ticker';

interface Entry {
  ticker: string;
  spot: number | null;
  atmIv30d: number | null;
  atmIv90d: number | null;
  termSlope: number | null;
  skew25d: number | null;
  putCallRatio: number | null;
  qualityScore: number;
  asOf: string | null;
}

function pct(v: number | null, decimals = 1): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(decimals)}%`;
}

function signedPp(v: number | null): string {
  if (v == null) return '—';
  const pp = v * 100;
  return `${pp >= 0 ? '+' : ''}${pp.toFixed(2)}pp`;
}

function Slope({ v }: { v: number | null }) {
  if (v == null) return <span className="text-cf-text-secondary">—</span>;
  const color = v > 0.005 ? 'text-emerald-600' : v < -0.005 ? 'text-rose-600' : 'text-cf-text-secondary';
  const Icon = v > 0.005 ? TrendingUp : v < -0.005 ? TrendingDown : Activity;
  return (
    <span className={`inline-flex items-center gap-1 ${color} font-semibold`}>
      <Icon className="w-3 h-3" />
      {signedPp(v)}
    </span>
  );
}

function QualityDot({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-xs">{score}</span>
    </span>
  );
}

export default function VolatilityPage() {
  const t = useTranslations('volatility');
  const [data, setData] = useState<IvScreenerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('atmIv30d');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetch('/api/iv-screener')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: IvScreenerResponse) => {
        if (!cancel) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const entries: Entry[] = data?.entries ?? [];
  const valid = entries.filter((e) => e.atmIv30d != null);
  const ivValues = valid.map((e) => e.atmIv30d!).sort((a, b) => a - b);
  // 데이터셋 내 percentile rank (true IV rank 는 1y history 필요 — MVP 는 cross-section)
  const ivRank = (v: number | null): number | null => {
    if (v == null || ivValues.length < 3) return null;
    let count = 0;
    for (const x of ivValues) if (x <= v) count++;
    return Math.round((count / ivValues.length) * 100);
  };

  const sorted = useMemo(() => {
    const arr = [...entries];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === 'ticker') return a.ticker.localeCompare(b.ticker) * dir;
      const av = (a[sortKey] ?? -Infinity) as number;
      const bv = (b[sortKey] ?? -Infinity) as number;
      return (av - bv) * dir;
    });
    return arr;
  }, [entries, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-center gap-2 py-16 text-cf-text-secondary">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">{t('loading')}</span>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-cf-text-primary mb-1">{t('title')}</h1>
        <p className="text-sm text-cf-text-secondary">{t('subtitle')}</p>
      </header>

      <div className="cf-card p-4 mb-5 bg-gradient-to-r from-slate-50 to-indigo-50 border-indigo-100">
        <div className="flex items-start gap-3">
          <div className="text-2xl leading-none">📊</div>
          <div className="text-xs text-cf-text-secondary leading-relaxed">
            <p>{t('methodologyTitle')}</p>
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              <li>{t('methodologyParity')}</li>
              <li>{t('methodologyBrent')}</li>
              <li>{t('methodologyInterp')}</li>
              <li>{t('methodologyQuality')}</li>
            </ul>
          </div>
        </div>
      </div>

      {data?.source === 'error' && (
        <div className="cf-card p-3 mb-4 border-rose-200 bg-rose-50 text-rose-700 text-xs">
          {t('errorBanner')}
        </div>
      )}

      <div className="cf-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cf-bg-secondary text-cf-text-secondary text-[11px] uppercase">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">
                <button onClick={() => toggleSort('ticker')} className="inline-flex items-center gap-1 hover:text-cf-primary">
                  {t('colTicker')} <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-right px-3 py-2 font-semibold">{t('colSpot')}</th>
              <th className="text-right px-3 py-2 font-semibold">
                <button onClick={() => toggleSort('atmIv30d')} className="inline-flex items-center gap-1 hover:text-cf-primary">
                  {t('colAtm30d')} <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-right px-3 py-2 font-semibold">{t('colIvRank')}</th>
              <th className="text-right px-3 py-2 font-semibold">
                <button onClick={() => toggleSort('termSlope')} className="inline-flex items-center gap-1 hover:text-cf-primary">
                  {t('colTermSlope')} <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-right px-3 py-2 font-semibold">
                <button onClick={() => toggleSort('skew25d')} className="inline-flex items-center gap-1 hover:text-cf-primary">
                  {t('colSkew')} <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-right px-3 py-2 font-semibold">
                <button onClick={() => toggleSort('putCallRatio')} className="inline-flex items-center gap-1 hover:text-cf-primary">
                  {t('colPcr')} <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-right px-3 py-2 font-semibold">
                <button onClick={() => toggleSort('qualityScore')} className="inline-flex items-center gap-1 hover:text-cf-primary">
                  {t('colQuality')} <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="text-left px-3 py-2 font-semibold">{t('colLink')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => {
              const rank = ivRank(e.atmIv30d);
              const rankColor = rank == null
                ? 'text-cf-text-secondary'
                : rank >= 80
                ? 'text-rose-600 font-bold'
                : rank <= 20
                ? 'text-emerald-600 font-bold'
                : 'text-cf-text-primary';
              return (
                <tr key={e.ticker} className="border-t border-cf-border hover:bg-cf-bg-secondary/40">
                  <td className="px-3 py-2 font-bold">{e.ticker}</td>
                  <td className="text-right px-3 py-2 text-cf-text-secondary">
                    {e.spot != null ? `$${e.spot.toFixed(2)}` : '—'}
                  </td>
                  <td className="text-right px-3 py-2 font-semibold tabular-nums">{pct(e.atmIv30d)}</td>
                  <td className={`text-right px-3 py-2 tabular-nums ${rankColor}`}>
                    {rank != null ? `${rank}%` : '—'}
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums">
                    <Slope v={e.termSlope} />
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums">
                    <span className={e.skew25d == null ? 'text-cf-text-secondary' : e.skew25d > 0.02 ? 'text-rose-600 font-semibold' : ''}>
                      {signedPp(e.skew25d)}
                    </span>
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums text-cf-text-secondary">
                    {e.putCallRatio != null ? e.putCallRatio.toFixed(2) : '—'}
                  </td>
                  <td className="text-right px-3 py-2">
                    <QualityDot score={e.qualityScore} />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/company/${e.ticker}`}
                      className="inline-flex items-center gap-1 text-cf-primary hover:underline text-xs"
                    >
                      {t('colLinkLabel')} <ExternalLink className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-10 text-cf-text-secondary text-sm">
                  {t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-[11px] text-cf-text-secondary flex flex-wrap gap-x-4 gap-y-1">
        <span>{t('legendIvRank')}</span>
        <span>{t('legendSkew')}</span>
        <span>{t('legendTermSlope')}</span>
        <span>
          {t('source')}: {data?.source ?? 'unknown'} · {t('generatedAt')}:{' '}
          {data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : '—'}
        </span>
      </div>
    </main>
  );
}
