'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  AreaChart,
  Area,
} from 'recharts';
import type { YieldCurveData } from '@/app/api/yield-curve/route';

const CURVE_COLORS = {
  today:   '#4F8FBF',
  weekAgo: '#E8A945',
  monthAgo:'#5CB88A',
  quarterAgo: '#8b5cf6',
};

function SpreadBadge({ value, label }: { value: number | null; label: string }) {
  if (value == null) return null;
  const bp = Math.round(value * 100);
  const inverted = bp < 0;
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold ${inverted ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
      <span className="text-xs font-medium opacity-70">{label}</span>
      <span>{inverted ? '' : '+'}{bp}bp</span>
      {inverted && <span className="text-[10px] font-bold bg-red-600 text-white px-1.5 py-0.5 rounded">역전</span>}
    </div>
  );
}

export default function YieldCurveCard() {
  const [data, setData] = useState<YieldCurveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(true);
  const [spreadView, setSpreadView] = useState<'2s10s' | '3m10y'>('2s10s');

  useEffect(() => {
    fetch('/api/yield-curve')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="cf-card p-6 animate-pulse">
        <div className="h-5 bg-gray-100 rounded w-40 mb-4" />
        <div className="h-48 bg-gray-50 rounded" />
      </div>
    );
  }
  if (!data || !data.today.length) return null;

  const curveData = data.today.map((pt, i) => ({
    label: pt.label,
    today: pt.value,
    weekAgo: data.weekAgo[i]?.value ?? null,
    monthAgo: data.monthAgo[i]?.value ?? null,
    quarterAgo: data.quarterAgo[i]?.value ?? null,
  }));

  const spreadData = spreadView === '2s10s' ? data.spread2s10s : data.spread3m10y;
  // Show last 90 data points for the spread chart
  const spreadSlice = spreadData.slice(-90);

  return (
    <div className="cf-card p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-heading font-bold text-cf-text-primary">미국 금리 커브</h2>
          <p className="text-xs text-cf-text-secondary mt-0.5">
            Treasury Yield Curve · {data.dataDate ?? '-'} · FRED
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SpreadBadge value={data.spread2s10sCurrent} label="2s10s" />
          <SpreadBadge value={data.spread3m10yCurrent} label="3m10y" />
        </div>
      </div>

      {/* Yield curve chart */}
      <div>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="text-xs font-bold text-cf-text-secondary uppercase tracking-wider">수익률 곡선</span>
          <label className="flex items-center gap-1.5 text-xs text-cf-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={showHistory}
              onChange={e => setShowHistory(e.target.checked)}
              className="accent-cf-primary"
            />
            과거 비교
          </label>
          {showHistory && (
            <div className="flex flex-wrap gap-3 text-[11px]">
              {Object.entries(CURVE_COLORS).map(([k, c]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="w-5 h-1 rounded-full inline-block" style={{ backgroundColor: c }} />
                  {k === 'today' ? '현재' : k === 'weekAgo' ? '1주 전' : k === 'monthAgo' ? '1개월 전' : '3개월 전'}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={curveData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 11 }}
                tickFormatter={v => `${v}%`}
                width={45}
              />
              <Tooltip
                formatter={(v) => v != null ? `${(+v).toFixed(2)}%` : '-'}
                contentStyle={{ fontSize: 12 }}
              />
              <Line dataKey="today" name="현재" stroke={CURVE_COLORS.today} strokeWidth={2.5} dot={false} connectNulls />
              {showHistory && <>
                <Line dataKey="weekAgo" name="1주 전" stroke={CURVE_COLORS.weekAgo} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                <Line dataKey="monthAgo" name="1개월 전" stroke={CURVE_COLORS.monthAgo} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                <Line dataKey="quarterAgo" name="3개월 전" stroke={CURVE_COLORS.quarterAgo} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
              </>}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Spread time series */}
      {spreadSlice.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-bold text-cf-text-secondary uppercase tracking-wider">스프레드 추이 (최근 90일)</span>
            <div className="flex gap-1">
              {(['2s10s', '3m10y'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setSpreadView(v)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${spreadView === v ? 'bg-cf-primary text-white' : 'bg-white/5 text-cf-text-secondary hover:bg-white/10'}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spreadSlice} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={d => d.slice(5)}
                  interval={Math.floor(spreadSlice.length / 6)}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={v => `${(v * 100).toFixed(0)}bp`}
                  width={48}
                />
                <Tooltip
                  formatter={(v) => { const n = v != null ? +v : 0; return `${(n * 100).toFixed(0)}bp (${n >= 0 ? '+' : ''}${n.toFixed(3)}%)`; }}
                  contentStyle={{ fontSize: 11 }}
                />
                <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1.5} />
                <Area
                  dataKey="value"
                  name={spreadView}
                  stroke="#4F8FBF"
                  fill="#4F8FBF"
                  fillOpacity={0.15}
                  strokeWidth={1.5}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Yield table */}
      <div className="grid grid-cols-3 sm:grid-cols-9 gap-1">
        {data.today.map(pt => (
          <div key={pt.label} className="bg-gray-50 rounded-lg p-2 text-center">
            <p className="text-[10px] text-cf-text-secondary">{pt.label}</p>
            <p className="text-sm font-bold text-cf-text-primary">{pt.value != null ? `${pt.value.toFixed(2)}%` : '-'}</p>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-cf-text-secondary/50">
        출처: FRED (Federal Reserve Bank of St. Louis) · 1h 캐시 · 미국 재무부 국채 수익률
      </p>
    </div>
  );
}
