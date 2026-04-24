'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Loader2 } from 'lucide-react';
import type { CotEntry } from '@/app/api/cot-positions/route';

interface CotResponse {
  entries: CotEntry[];
  reportDate: string;
  count: number;
  updatedAt: string;
  cached: boolean;
  error?: string;
}

function SentimentBadge({ s }: { s: CotEntry['sentiment'] }) {
  if (s === 'bullish') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
      <TrendingUp className="w-3 h-3" /> 강세
    </span>
  );
  if (s === 'bearish') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-400">
      <TrendingDown className="w-3 h-3" /> 약세
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-cf-text-secondary">
      <Minus className="w-3 h-3" /> 중립
    </span>
  );
}

function NetBar({ pct }: { pct: number }) {
  const clamped = Math.max(-100, Math.min(100, pct));
  const width = Math.abs(clamped);
  const positive = clamped >= 0;
  return (
    <div className="relative flex items-center h-4 w-24">
      <div className="absolute left-1/2 w-px h-full bg-cf-border" />
      {positive ? (
        <div className="absolute left-1/2 h-2 rounded-r-sm bg-emerald-500/60" style={{ width: `${width / 2}%` }} />
      ) : (
        <div className="absolute right-1/2 h-2 rounded-l-sm bg-red-500/60" style={{ width: `${width / 2}%` }} />
      )}
    </div>
  );
}

export default function CotTab() {
  const t = useTranslations('intelligence');
  const [data, setData] = useState<CotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(force = false) {
    if (force) setRefreshing(true);
    try {
      const url = force ? '/api/cot-positions?refresh=1' : '/api/cot-positions';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch { /* non-fatal */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-cf-accent" /></div>
  );

  if (!data || data.entries.length === 0) return (
    <div className="text-center text-cf-text-secondary py-12 text-sm">
      {data?.error ?? t('cotNoData')}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-cf-text-primary">{t('cotTitle')}</h3>
          <p className="text-xs text-cf-text-secondary mt-0.5">{t('cotSubtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-cf-text-secondary">{t('cotReportDate')}: {data.reportDate}</span>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="p-1.5 rounded hover:bg-cf-border/40 text-cf-text-secondary"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-cf-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-cf-border bg-cf-bg-secondary/40">
              <th className="px-4 py-2.5 text-left font-medium text-cf-text-secondary">{t('cotMarket')}</th>
              <th className="px-4 py-2.5 text-right font-medium text-cf-text-secondary">{t('cotNetPos')}</th>
              <th className="px-4 py-2.5 text-right font-medium text-cf-text-secondary">{t('cotNetPct')}</th>
              <th className="px-4 py-2.5 text-center font-medium text-cf-text-secondary hidden sm:table-cell">{t('cotBar')}</th>
              <th className="px-4 py-2.5 text-center font-medium text-cf-text-secondary">{t('cotSentiment')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cf-border/50">
            {data.entries.map(e => (
              <tr key={e.id} className="hover:bg-cf-border/20 transition-colors">
                <td className="px-4 py-3 font-medium text-cf-text-primary">{e.label}</td>
                <td className={`px-4 py-3 text-right font-mono tabular-nums ${e.netPosition > 0 ? 'text-emerald-400' : e.netPosition < 0 ? 'text-red-400' : 'text-cf-text-secondary'}`}>
                  {e.netPosition > 0 ? '+' : ''}{e.netPosition.toLocaleString()}
                </td>
                <td className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${e.netPctOI > 0 ? 'text-emerald-400' : e.netPctOI < 0 ? 'text-red-400' : 'text-cf-text-secondary'}`}>
                  {e.netPctOI > 0 ? '+' : ''}{e.netPctOI.toFixed(1)}%
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <div className="flex justify-center"><NetBar pct={e.netPctOI} /></div>
                </td>
                <td className="px-4 py-3 text-center"><SentimentBadge s={e.sentiment} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <p className="text-[11px] text-cf-text-secondary/60 leading-relaxed">
        {t('cotLegend')}
        {' '}
        <span className="text-cf-text-secondary/80">Source: CFTC Legacy COT Report (Financial Futures)</span>
      </p>
    </div>
  );
}
