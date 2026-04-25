'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
} from 'recharts';
import type { VolatilityData } from '@/app/api/volatility/route';

const REGIME_COLOR = {
  contango:     { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  backwardation:{ bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200' },
  humped:       { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  unknown:      { bg: 'bg-gray-50',    text: 'text-gray-500',    border: 'border-gray-200' },
};

export default function VolatilityCard() {
  const t = useTranslations('macro');
  const [data, setData] = useState<VolatilityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/volatility', { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !controller.signal.aborted) setData(d); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="cf-card p-6 animate-pulse">
        <div className="h-5 bg-gray-100 rounded w-40 mb-4" />
        <div className="h-40 bg-gray-50 rounded" />
      </div>
    );
  }
  if (!data) return null;

  const termData = [
    { label: t('volTerm9d'),  value: data.vxst, shortLabel: '9d' },
    { label: t('volTerm30d'), value: data.vix,  shortLabel: 'VIX' },
    { label: t('volTerm6m'),  value: data.vxmt, shortLabel: '6m' },
  ].filter(d => d.value != null);

  const regimeStyle = REGIME_COLOR[data.regime] ?? REGIME_COLOR.unknown;
  const histSlice = data.history.slice(-90);

  return (
    <div className="cf-card p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary">{t('volTitle')}</h2>
          <p className="text-xs text-cf-text-secondary mt-0.5">
            VIX Term Structure · CBOE · Yahoo Finance
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.vix != null && (
            <div className="text-center">
              <p className="text-2xl font-bold text-cf-text-primary">{data.vix.toFixed(1)}</p>
              <p className="text-[10px] text-cf-text-secondary">{t('volCurrentVix')}</p>
            </div>
          )}
          {data.vvix != null && (
            <div className="text-center ml-3">
              <p className="text-lg font-bold text-cf-text-secondary">{data.vvix.toFixed(0)}</p>
              <p className="text-[10px] text-cf-text-secondary">VVIX</p>
            </div>
          )}
        </div>
      </div>

      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border ${regimeStyle.bg} ${regimeStyle.text} ${regimeStyle.border}`}>
        <span className="font-bold uppercase tracking-wide">{data.regime}</span>
        <span className="opacity-80">{data.regimeLabel}</span>
      </div>

      {termData.length > 0 && (
        <div>
          <p className="text-xs font-bold text-cf-text-secondary mb-2 uppercase tracking-wider">{t('volTermCurve')}</p>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={termData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="shortLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={35} domain={[0, 'auto']} />
                <Tooltip formatter={(v) => v != null ? `${(+v).toFixed(1)}` : '-'} contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="value" name={t('volBarName')} radius={[4, 4, 0, 0]}>
                  {termData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.value != null && entry.value > 20 ? '#ef4444' : entry.value != null && entry.value > 15 ? '#f97316' : '#4F8FBF'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-1 text-[11px]">
            {termData.map(d => (
              <span key={d.shortLabel} className="text-cf-text-secondary">
                <span className="font-medium text-cf-text-primary">{d.shortLabel}</span>: {d.value?.toFixed(1) ?? '-'}
              </span>
            ))}
          </div>
        </div>
      )}

      {histSlice.length > 5 && (
        <div>
          <p className="text-xs font-bold text-cf-text-secondary mb-2 uppercase tracking-wider">{t('volHistory')}</p>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={histSlice} margin={{ top: 4, right: 5, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} interval={Math.floor(histSlice.length / 6)} />
                <YAxis tick={{ fontSize: 10 }} width={32} domain={[0, 'auto']} />
                <Tooltip formatter={(v) => v != null ? `${(+v).toFixed(1)}` : '-'} contentStyle={{ fontSize: 11 }} />
                <ReferenceLine y={20} stroke="#f97316" strokeDasharray="3 3" strokeWidth={1} />
                <ReferenceLine y={30} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
                <Area dataKey="value" name="VIX" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.15} strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-cf-text-secondary/60 mt-1">{t('volBaseline')}</p>
        </div>
      )}

      <p className="text-[10px] text-cf-text-secondary/50">{t('volSource')}</p>
    </div>
  );
}
