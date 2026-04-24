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

const BEI_COLORS = { '5Y': '#f97316', '10Y': '#8b5cf6' };

function interpretCurve(
  spread2s10s: number | null,
  spread3m10y: number | null,
  bei5y: number | null,
  bei10y: number | null,
  spreadHistory: { value: number | null }[],
): { level: 'danger' | 'caution' | 'neutral' | 'positive'; title: string; bullets: string[] } {
  const bp2s10s = spread2s10s != null ? Math.round(spread2s10s * 100) : null;
  const bp3m10y = spread3m10y != null ? Math.round(spread3m10y * 100) : null;

  // Spread trend: compare last 5d avg vs 30d avg
  const valid = spreadHistory.filter(d => d.value != null).map(d => d.value as number);
  const trend5d  = valid.length >= 5  ? valid.slice(-5).reduce((a,b)=>a+b,0)/5  : null;
  const trend30d = valid.length >= 30 ? valid.slice(-30).reduce((a,b)=>a+b,0)/30 : null;
  const trendDesc = trend5d != null && trend30d != null
    ? trend5d > trend30d + 0.002 ? '확대 중 ↑' : trend5d < trend30d - 0.002 ? '축소 중 ↓' : '횡보 →'
    : null;

  const beiSignal = bei5y != null && bei10y != null
    ? bei5y > bei10y + 0.1 ? `단기 인플레(5Y ${bei5y.toFixed(2)}%) > 장기(10Y ${bei10y.toFixed(2)}%) — Fed가 결국 통제할 것이라는 시장 기대`
    : bei10y > bei5y + 0.1 ? `장기 기대인플레(10Y ${bei10y.toFixed(2)}%) 단기 초과 — 인플레 고착화 경계`
    : `5Y/10Y 기대인플레 균형 (${bei5y.toFixed(2)}% / ${bei10y.toFixed(2)}%)`
    : null;

  const bullets: string[] = [];
  if (bp2s10s != null)  bullets.push(`2년-10년 스프레드 ${bp2s10s > 0 ? '+' : ''}${bp2s10s}bp${trendDesc ? ` (${trendDesc})` : ''}`);
  if (bp3m10y != null)  bullets.push(`3개월-10년 스프레드 ${bp3m10y > 0 ? '+' : ''}${bp3m10y}bp`);
  if (beiSignal)        bullets.push(beiSignal);

  if (bp2s10s == null) return { level: 'neutral', title: '데이터 없음', bullets };

  if (bp2s10s < -50) {
    bullets.push('커브 깊은 역전 → 과거 사례 기준 6~18개월 내 경기침체 확률 높음');
    return { level: 'danger', title: '⚠️ 심각한 역전 — 경기침체 선행 신호', bullets };
  }
  if (bp2s10s < 0) {
    bullets.push('커브 역전 구간 — 은행 마진 압박, 대출 위축, 성장 둔화 경계');
    return { level: 'caution', title: '⚡ 역전 구간 — 경기 둔화 주의', bullets };
  }
  if (bp2s10s < 30) {
    bullets.push('스프레드 축소 → 성장 기대 약화 또는 Fed 인하 사이클 시작 직전 패턴');
    return { level: 'caution', title: '⚡ 플랫 구간 — 전환기', bullets };
  }
  if (bp2s10s < 100) {
    bullets.push('정상 기울기 유지 — 경기침체 신호 없음, 금융 여건 양호');
    return { level: 'positive', title: '✅ 정상 커브 — 성장 기대 유효', bullets };
  }
  bullets.push('가파른 기울기 → 강한 성장 기대 또는 장기 재정 우려로 장기금리 급등');
  return { level: 'positive', title: '📈 스티프닝 — 강한 성장 기대 또는 장기 리스크', bullets };
}

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
  const [curveView, setCurveView] = useState<'nominal' | 'tips'>('nominal');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/yield-curve', { signal: controller.signal })
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
  const spreadSlice = spreadData.slice(-90);

  // TIPS: build nominal vs real overlay for matching maturities (5Y,10Y,20Y,30Y)
  const TIPS_LABELS = ['5Y', '10Y', '20Y', '30Y'];
  const tipsChartData = TIPS_LABELS.map(lbl => {
    const nominal = data.today.find(p => p.label === lbl)?.value ?? null;
    const real = (data.tipsToday ?? []).find(p => p.label === lbl)?.value ?? null;
    return { label: lbl, nominal, real };
  });

  // BEI time series
  const beiChartData = (data.bei10y ?? []).slice(-90).map(p => {
    const b5 = (data.bei5y ?? []).find(b => b.date === p.date);
    return { date: p.date, bei10y: p.value, bei5y: b5?.value ?? null };
  });

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
          <div className="flex gap-1">
            {(['nominal', 'tips'] as const).map(v => (
              <button key={v} onClick={() => setCurveView(v)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${curveView === v ? 'bg-cf-primary text-white' : 'bg-white/5 text-cf-text-secondary hover:bg-white/10'}`}>
                {v === 'nominal' ? '명목금리' : '실질(TIPS)'}
              </button>
            ))}
          </div>
          {curveView === 'nominal' && (
            <label className="flex items-center gap-1.5 text-xs text-cf-text-secondary cursor-pointer">
              <input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} className="accent-cf-primary" />
              과거 비교
            </label>
          )}
          {curveView === 'nominal' && showHistory && (
            <div className="flex flex-wrap gap-3 text-[11px]">
              {Object.entries(CURVE_COLORS).map(([k, c]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="w-5 h-1 rounded-full inline-block" style={{ backgroundColor: c }} />
                  {k === 'today' ? '현재' : k === 'weekAgo' ? '1주 전' : k === 'monthAgo' ? '1개월 전' : '3개월 전'}
                </span>
              ))}
            </div>
          )}
          {curveView === 'tips' && (
            <div className="flex flex-wrap gap-3 text-[11px]">
              <span className="flex items-center gap-1">
                <span className="w-5 h-1 rounded-full inline-block" style={{ backgroundColor: CURVE_COLORS.today }} />명목금리
              </span>
              <span className="flex items-center gap-1">
                <span className="w-5 h-1 rounded-full inline-block" style={{ backgroundColor: '#ef4444' }} />실질금리(TIPS)
              </span>
            </div>
          )}
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            {curveView === 'nominal' ? (
              <LineChart data={curveData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} width={45} />
                <Tooltip formatter={(v) => v != null ? `${(+v).toFixed(2)}%` : '-'} contentStyle={{ fontSize: 12 }} />
                <Line dataKey="today" name="현재" stroke={CURVE_COLORS.today} strokeWidth={2.5} dot={false} connectNulls />
                {showHistory && <>
                  <Line dataKey="weekAgo" name="1주 전" stroke={CURVE_COLORS.weekAgo} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                  <Line dataKey="monthAgo" name="1개월 전" stroke={CURVE_COLORS.monthAgo} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                  <Line dataKey="quarterAgo" name="3개월 전" stroke={CURVE_COLORS.quarterAgo} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                </>}
              </LineChart>
            ) : (
              <LineChart data={tipsChartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} width={45} />
                <Tooltip formatter={(v) => v != null ? `${(+v).toFixed(2)}%` : '-'} contentStyle={{ fontSize: 12 }} />
                <Line dataKey="nominal" name="명목금리" stroke={CURVE_COLORS.today} strokeWidth={2} strokeDasharray="4 2" dot={false} connectNulls />
                <Line dataKey="real" name="실질금리(TIPS)" stroke="#ef4444" strokeWidth={2.5} dot={false} connectNulls />
              </LineChart>
            )}
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

      {/* Breakeven Inflation section */}
      {beiChartData.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="text-xs font-bold text-cf-text-secondary uppercase tracking-wider">기대 인플레이션 (Breakeven)</span>
            <div className="flex gap-3 text-[11px]">
              {(['5Y', '10Y'] as const).map(k => {
                const cur = k === '5Y' ? data.bei5yCurrent : data.bei10yCurrent;
                return (
                  <span key={k} className="flex items-center gap-1">
                    <span className="w-4 h-1 rounded-full inline-block" style={{ backgroundColor: BEI_COLORS[k] }} />
                    <span>{k}:</span>
                    <span className="font-bold text-cf-text-primary">{cur != null ? `${cur.toFixed(2)}%` : '-'}</span>
                  </span>
                );
              })}
            </div>
          </div>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={beiChartData} margin={{ top: 4, right: 5, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} interval={Math.floor(beiChartData.length / 6)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(+v).toFixed(1)}%`} width={40} domain={['auto', 'auto']} />
                <Tooltip formatter={(v) => v != null ? `${(+v).toFixed(2)}%` : '-'} contentStyle={{ fontSize: 11 }} />
                <Line dataKey="bei5y" name="5Y BEI" stroke={BEI_COLORS['5Y']} strokeWidth={1.5} dot={false} connectNulls />
                <Line dataKey="bei10y" name="10Y BEI" stroke={BEI_COLORS['10Y']} strokeWidth={1.5} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Interpretation */}
      {(() => {
        const bei5yCur  = data.bei5y  != null && data.bei5y.length  > 0 ? data.bei5y[data.bei5y.length-1].value   : null;
        const bei10yCur = data.bei10y != null && data.bei10y.length > 0 ? data.bei10y[data.bei10y.length-1].value : null;
        const interp = interpretCurve(data.spread2s10sCurrent, data.spread3m10yCurrent, bei5yCur, bei10yCur, data.spread2s10s ?? []);
        const borderColor = interp.level === 'danger' ? 'border-red-500/40 bg-red-500/5' : interp.level === 'caution' ? 'border-yellow-500/40 bg-yellow-500/5' : interp.level === 'positive' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/10 bg-white/3';
        return (
          <div className={`rounded-xl border px-4 py-3 space-y-1.5 ${borderColor}`}>
            <p className="text-[12px] font-bold text-cf-text-primary">{interp.title}</p>
            <ul className="space-y-1">
              {interp.bullets.map((b, i) => (
                <li key={i} className="text-[11px] text-cf-text-secondary flex gap-1.5">
                  <span className="opacity-40 mt-px">•</span><span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

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
        출처: FRED (Federal Reserve Bank of St. Louis) · 1h 캐시 · 명목/TIPS 국채 수익률 · Breakeven = T5YIE/T10YIE
      </p>
    </div>
  );
}
