'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

interface CreditHistPoint { period: string; balance: number; gdpRatio: number; }
interface CountryCreditData {
  id: string; country: string; flag: string;
  currentBalance: number; currentBalanceLocal: string;
  gdp: number; gdpRatio: number;
  changeYoY: number; changeQoQ: number;
  historical: CreditHistPoint[];
  peakBalance: number; peakPeriod: string;
  troughBalance: number; troughPeriod: string;
  histPercentile: number;
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  riskReason: string; source: string; sourceUrl: string;
  lastUpdated: string; laymanSummary: string;
}
interface GlobalSnapshot {
  totalBalance: number; globalGdpRatio: number;
  riskCounts: Record<string, number>;
  mostLeveraged: CountryCreditData[];
  fastestGrowing: CountryCreditData[];
}

const RISK_COLORS = {
  low:     { bar: 'bg-emerald-400', text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', label: '안전', dot: 'bg-emerald-400' },
  medium:  { bar: 'bg-amber-400',   text: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     label: '주의', dot: 'bg-amber-400' },
  high:    { bar: 'bg-orange-500',  text: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200',   label: '경계', dot: 'bg-orange-500' },
  extreme: { bar: 'bg-red-600',     text: 'text-red-700',     bg: 'bg-red-50 border-red-200',         label: '위험', dot: 'bg-red-600' },
};

function MiniSparkline({ data, color = 'bg-blue-400' }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  return (
    <div className="flex items-end gap-px h-8 w-20">
      {data.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-t-sm ${color} opacity-80 transition-all`}
          style={{ height: `${Math.max(((v - min) / range) * 100, 8)}%` }}
        />
      ))}
    </div>
  );
}

function GdpRatioGauge({ ratio, peak, trough, percentile }: { ratio: number; peak: number; trough: number; percentile: number }) {
  const range = peak - trough || 1;
  const posPct = Math.min(((ratio - trough) / range) * 100, 100);
  const riskColor = percentile >= 90 ? 'bg-red-500' : percentile >= 70 ? 'bg-orange-400' : percentile >= 40 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[10px] text-cf-text-secondary mb-1">
        <span>최저 {trough.toFixed(1)}%</span>
        <span className="font-bold text-cf-text-primary">현재 {ratio.toFixed(2)}%</span>
        <span>최고 {peak.toFixed(1)}%</span>
      </div>
      <div className="relative h-3 rounded-full bg-gray-100 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-200 via-amber-200 to-red-300 opacity-40 rounded-full" />
        <div
          className={`absolute top-0 h-full w-2 rounded-full ${riskColor} shadow-sm transition-all`}
          style={{ left: `calc(${posPct}% - 4px)` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
        <span>안전</span><span>주의</span><span>경계</span><span>위험</span>
      </div>
    </div>
  );
}

export default function CreditBalanceTab() {
  const [countries, setCountries] = useState<CountryCreditData[]>([]);
  const [usLongHistory, setUsLongHistory] = useState<CountryCreditData | null>(null);
  const [globalSnapshot, setGlobalSnapshot] = useState<GlobalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>('us');
  const [viewMode, setViewMode] = useState<'balance' | 'gdpRatio'>('gdpRatio');
  const [showLayman, setShowLayman] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/credit-balance', { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => {
        if (controller.signal.aborted) return;
        setCountries(d.countries ?? []);
        setUsLongHistory(d.usLongHistory ?? null);
        setGlobalSnapshot(d.globalSnapshot ?? null);
      })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-cf-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">신용잔고 데이터 로딩중...</span>
    </div>
  );

  const activeCountry = countries.find(c => c.id === selected) ?? countries[0];
  if (!activeCountry) return null;

  const rc = RISK_COLORS[activeCountry.riskLevel];
  const histValues = activeCountry.historical.map(h => viewMode === 'balance' ? h.balance : h.gdpRatio);
  const maxHist = Math.max(...histValues, 0.1);

  const gdpRatioHistory = activeCountry.historical.map(h => h.gdpRatio);
  const gdpRatioPeak = Math.max(...gdpRatioHistory);
  const gdpRatioTrough = Math.min(...gdpRatioHistory);

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div className="cf-card p-4 bg-gradient-to-r from-slate-50 to-indigo-50 border-indigo-100">
        <div className="flex items-start gap-3">
          <div className="text-2xl leading-none">📉</div>
          <div>
            <h3 className="text-sm font-bold text-cf-text-primary mb-1">국가별 신용잔고 — 시장 레버리지 지도</h3>
            <p className="text-xs text-cf-text-secondary leading-relaxed">
              투자자들이 주식을 사기 위해 빌린 돈의 총합이에요. <span className="font-semibold text-indigo-600">GDP 대비 비율과 역대 비교</span>로
              현재 시장이 얼마나 과열됐는지, 조정 리스크가 얼마나 큰지 볼 수 있어요.
            </p>
          </div>
        </div>
      </div>

      {/* Global snapshot */}
      {globalSnapshot && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="cf-card p-3 text-center">
            <div className="text-lg font-extrabold text-cf-text-primary tabular-nums">${globalSnapshot.totalBalance.toFixed(0)}B</div>
            <div className="text-[10px] text-cf-text-secondary mt-0.5">글로벌 신용잔고 합산</div>
          </div>
          <div className="cf-card p-3 text-center">
            <div className="text-lg font-extrabold text-amber-600 tabular-nums">{globalSnapshot.globalGdpRatio.toFixed(2)}%</div>
            <div className="text-[10px] text-cf-text-secondary mt-0.5">합산 GDP 대비</div>
          </div>
          <div className="cf-card p-3 text-center">
            <div className="text-lg font-extrabold text-orange-600 tabular-nums">
              {(globalSnapshot.riskCounts['high'] ?? 0) + (globalSnapshot.riskCounts['extreme'] ?? 0)}
            </div>
            <div className="text-[10px] text-cf-text-secondary mt-0.5">경계/위험 국가 수</div>
          </div>
          <div className="cf-card p-3 text-center">
            <div className="text-base font-extrabold text-red-600 truncate">
              {globalSnapshot.fastestGrowing[0]?.flag} {globalSnapshot.fastestGrowing[0]?.country}
            </div>
            <div className="text-[10px] text-cf-text-secondary mt-0.5">가장 빠른 증가</div>
            <div className="text-[11px] font-bold text-red-500">+{globalSnapshot.fastestGrowing[0]?.changeYoY.toFixed(1)}% YoY</div>
          </div>
        </div>
      )}

      {/* Country selector + view toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {countries.map(c => {
            const rc2 = RISK_COLORS[c.riskLevel];
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                  selected === c.id
                    ? `${rc2.bg} ${rc2.text} shadow-sm`
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span>{c.flag}</span>
                <span>{c.country}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${rc2.dot}`} />
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => setViewMode('gdpRatio')} className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${viewMode === 'gdpRatio' ? 'bg-white shadow-sm text-cf-text-primary' : 'text-gray-500'}`}>GDP 비율</button>
          <button onClick={() => setViewMode('balance')} className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${viewMode === 'balance' ? 'bg-white shadow-sm text-cf-text-primary' : 'text-gray-500'}`}>금액(USD)</button>
        </div>
      </div>

      {/* Country detail */}
      <div className="cf-card p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">{activeCountry.flag}</span>
              <span className="text-lg font-extrabold text-cf-text-primary">{activeCountry.country}</span>
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${rc.bg} ${rc.text}`}>
                {rc.label} (역대 {activeCountry.histPercentile}th)
              </span>
            </div>
            <p className="text-xs text-cf-text-secondary">{activeCountry.source} · {activeCountry.lastUpdated}</p>
          </div>
          <button
            onClick={() => setShowLayman(p => !p)}
            className={`flex-shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${showLayman ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-blue-50 border-blue-100 text-blue-600'}`}
          >
            💡 쉬운 설명
          </button>
        </div>

        {showLayman && (
          <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-700 leading-relaxed">
            {activeCountry.laymanSummary}
          </div>
        )}

        {/* Key numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-[10px] text-cf-text-secondary mb-1">현재 신용잔고</div>
            <div className="text-base font-extrabold text-cf-text-primary">{activeCountry.currentBalanceLocal}</div>
            <div className="text-[10px] text-gray-400">${activeCountry.currentBalance.toFixed(1)}B USD</div>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-[10px] text-cf-text-secondary mb-1">GDP 대비</div>
            <div className={`text-base font-extrabold tabular-nums ${rc.text}`}>{activeCountry.gdpRatio.toFixed(2)}%</div>
            <GdpRatioGauge
              ratio={activeCountry.gdpRatio}
              peak={gdpRatioPeak}
              trough={gdpRatioTrough}
              percentile={activeCountry.histPercentile}
            />
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-[10px] text-cf-text-secondary mb-1">YoY 변화</div>
            <div className={`text-base font-extrabold tabular-nums ${activeCountry.changeYoY >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
              {activeCountry.changeYoY >= 0 ? '+' : ''}{activeCountry.changeYoY.toFixed(1)}%
            </div>
            <div className="text-[10px] text-gray-400">전년 동기 대비</div>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-[10px] text-cf-text-secondary mb-1">역대 최고</div>
            <div className="text-base font-extrabold text-cf-text-primary">{activeCountry.peakPeriod}</div>
            <div className="text-[10px] text-gray-400">현재 역대 {activeCountry.histPercentile}th</div>
          </div>
        </div>

        {/* Historical bar chart */}
        <div className="mt-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-cf-text-primary">역사적 추이</p>
            <span className="text-[10px] text-cf-text-secondary">{viewMode === 'gdpRatio' ? 'GDP 대비 %' : 'USD 십억'}</span>
          </div>
          <div className="flex items-end gap-0.5 h-28">
            {activeCountry.historical.map((pt, i) => {
              const val = viewMode === 'balance' ? pt.balance : pt.gdpRatio;
              const heightPct = (val / maxHist) * 100;
              const isCurrentOrRecent = i >= activeCountry.historical.length - 2;
              const isPeak = val === Math.max(...histValues);
              return (
                <div key={pt.period} className="flex flex-col items-center gap-0.5 flex-1 min-w-0 group relative">
                  <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                    <div className="bg-slate-800 text-white text-[10px] px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
                      <div className="font-bold">{pt.period}</div>
                      <div>{viewMode === 'gdpRatio' ? `GDP비 ${val.toFixed(2)}%` : `$${val}B`}</div>
                    </div>
                    <div className="w-1.5 h-1.5 bg-slate-800 rotate-45 -mt-0.5" />
                  </div>
                  <div
                    className={`w-full rounded-t transition-all ${
                      isPeak ? 'bg-red-400' :
                      isCurrentOrRecent ? rc.bar :
                      'bg-blue-300'
                    } ${isPeak ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  />
                  <span className={`text-[8px] truncate max-w-full text-center ${isCurrentOrRecent ? 'font-bold text-cf-text-primary' : 'text-gray-400'}`}>
                    {pt.period.replace('-Q1', '').replace('-Q2', '').replace('-Q3', '').replace('-Q4', '')}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 mt-2 text-[10px]">
            <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-red-400" /><span className="text-cf-text-secondary">역대 최고</span></div>
            <div className="flex items-center gap-1"><div className={`w-2.5 h-2.5 rounded-sm ${rc.bar}`} /><span className="text-cf-text-secondary">현재</span></div>
            <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-blue-300" /><span className="text-cf-text-secondary">과거</span></div>
          </div>
        </div>

        {/* Risk reason */}
        <div className={`p-3 rounded-xl border text-xs leading-relaxed ${rc.bg} ${rc.text}`}>
          <span className="font-bold">리스크 분석: </span>{activeCountry.riskReason}
        </div>
      </div>

      {/* US long-term history */}
      {usLongHistory && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-1 flex items-center gap-2">
            🇺🇸 미국 신용잔고 장기 역사 — 닷컴버블부터 현재까지
          </h3>
          <p className="text-xs text-cf-text-secondary mb-3">
            역대 시장 버블·붕괴와 신용잔고의 관계. 현재 위치를 역사적 맥락에서 봐요.
          </p>
          <div className="flex items-end gap-1 h-28">
            {usLongHistory.historical.map((pt, i) => {
              const val = pt.gdpRatio;
              const maxV = Math.max(...usLongHistory.historical.map(h => h.gdpRatio));
              const heightPct = (val / maxV) * 100;
              const isCurrent = i === usLongHistory.historical.length - 1;
              const isPeak = val === maxV;
              const isCrash = pt.period === '2002' || pt.period === '2009';
              return (
                <div key={pt.period} className="flex flex-col items-center gap-0.5 flex-1 min-w-0 group relative">
                  <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                    <div className="bg-slate-800 text-white text-[10px] px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
                      <div className="font-bold">{pt.period}</div>
                      <div>GDP비 {val.toFixed(1)}% · ${pt.balance}B</div>
                    </div>
                    <div className="w-1.5 h-1.5 bg-slate-800 rotate-45 -mt-0.5" />
                  </div>
                  <div
                    className={`w-full rounded-t transition-all ${
                      isPeak ? 'bg-red-500' :
                      isCrash ? 'bg-blue-300' :
                      isCurrent ? 'bg-amber-400' :
                      'bg-slate-300'
                    }`}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  />
                  <span className={`text-[8px] truncate max-w-full ${isCurrent ? 'font-bold text-cf-text-primary' : 'text-gray-400'}`}>
                    {pt.period}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
            {[
              { period: '2000-2002', color: 'bg-red-50 border-red-100 text-red-700', label: '닷컴버블', desc: 'GDP비 2.7% → 1.3% 급락. 나스닥 -78% 동반.' },
              { period: '2007-2009', color: 'bg-orange-50 border-orange-100 text-orange-700', label: '금융위기', desc: 'GDP비 2.6% → 1.6%. S&P500 -57% 동반.' },
              { period: '2021-2022', color: 'bg-amber-50 border-amber-100 text-amber-700', label: '팬데믹 버블', desc: 'GDP비 4.1%(최고) → 2.5%. 연준 긴축에 급락.' },
            ].map(e => (
              <div key={e.period} className={`p-2.5 rounded-lg border text-xs leading-relaxed ${e.color}`}>
                <div className="font-bold mb-0.5">{e.period} {e.label}</div>
                {e.desc}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Country comparison table */}
      <div className="cf-card overflow-hidden">
        <div className="p-4 pb-2">
          <h3 className="text-sm font-bold text-cf-text-primary">국가별 비교 요약</h3>
          <p className="text-xs text-cf-text-secondary">GDP 대비 신용잔고 비율 기준 정렬</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-cf-border bg-gray-50/50">
                <th className="text-left px-4 py-2 font-semibold text-cf-text-secondary">국가</th>
                <th className="text-right px-3 py-2 font-semibold text-cf-text-secondary">신용잔고</th>
                <th className="text-right px-3 py-2 font-semibold text-cf-text-secondary">GDP비</th>
                <th className="text-right px-3 py-2 font-semibold text-cf-text-secondary">YoY</th>
                <th className="text-center px-3 py-2 font-semibold text-cf-text-secondary">역대위치</th>
                <th className="text-center px-3 py-2 font-semibold text-cf-text-secondary">추세</th>
                <th className="text-center px-3 py-2 font-semibold text-cf-text-secondary">리스크</th>
              </tr>
            </thead>
            <tbody>
              {[...countries].sort((a, b) => b.gdpRatio - a.gdpRatio).map((c) => {
                const rc2 = RISK_COLORS[c.riskLevel];
                const spark = c.historical.slice(-6).map(h => h.gdpRatio);
                return (
                  <tr
                    key={c.id}
                    className={`border-b border-cf-border/50 transition-colors cursor-pointer hover:bg-gray-50/50 ${selected === c.id ? 'bg-cf-primary/5' : ''}`}
                    onClick={() => setSelected(c.id)}
                  >
                    <td className="px-4 py-2.5 font-medium text-cf-text-primary">
                      <span className="mr-1.5">{c.flag}</span>{c.country}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-cf-text-primary">{c.currentBalanceLocal}</td>
                    <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${rc2.text}`}>{c.gdpRatio.toFixed(2)}%</td>
                    <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${c.changeYoY >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                      {c.changeYoY >= 0 ? '+' : ''}{c.changeYoY.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full ${rc2.bar} rounded-full`} style={{ width: `${c.histPercentile}%` }} />
                        </div>
                        <span className="text-[10px] tabular-nums text-cf-text-secondary">{c.histPercentile}th</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-center">
                        <MiniSparkline data={spark} color={c.changeYoY >= 0 ? 'bg-red-400' : 'bg-blue-400'} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${rc2.bg} ${rc2.text}`}>{rc2.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-[10px] text-cf-text-secondary border-t border-cf-border">
          데이터: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · 단위: USD Billions (환율 환산) · 분기별 업데이트
        </div>
      </div>
    </div>
  );
}
