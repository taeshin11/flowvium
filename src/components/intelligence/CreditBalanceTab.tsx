'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
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
  low:     { bar: 'bg-emerald-400', text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-400' },
  medium:  { bar: 'bg-amber-400',   text: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     dot: 'bg-amber-400' },
  high:    { bar: 'bg-orange-500',  text: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200',   dot: 'bg-orange-500' },
  extreme: { bar: 'bg-red-600',     text: 'text-red-700',     bg: 'bg-red-50 border-red-200',         dot: 'bg-red-600' },
};

const RISK_KEYS: Record<string, string> = {
  low: 'cbRiskLow', medium: 'cbRiskMedium', high: 'cbRiskHigh', extreme: 'cbRiskExtreme',
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

function GdpRatioGauge({ ratio, peak, trough, percentile, labels }: {
  ratio: number; peak: number; trough: number; percentile: number;
  labels: { min: string; current: string; max: string; safe: string; caution: string; warning: string; danger: string };
}) {
  const range = peak - trough || 1;
  const posPct = Math.min(((ratio - trough) / range) * 100, 100);
  const riskColor = percentile >= 90 ? 'bg-red-500' : percentile >= 70 ? 'bg-orange-400' : percentile >= 40 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[10px] text-cf-text-secondary mb-1">
        <span>{labels.min}</span>
        <span className="font-bold text-cf-text-primary">{labels.current}</span>
        <span>{labels.max}</span>
      </div>
      <div className="relative h-3 rounded-full bg-gray-100 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-200 via-amber-200 to-red-300 opacity-40 rounded-full" />
        <div
          className={`absolute top-0 h-full w-2 rounded-full ${riskColor} shadow-sm transition-all`}
          style={{ left: `calc(${posPct}% - 4px)` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
        <span>{labels.safe}</span><span>{labels.caution}</span><span>{labels.warning}</span><span>{labels.danger}</span>
      </div>
    </div>
  );
}

export default function CreditBalanceTab() {
  const t = useTranslations('intelligence');
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
      <span className="text-sm">{t('cbLoading')}</span>
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
            <h3 className="text-sm font-bold text-cf-text-primary mb-1">{t('cbTitle')}</h3>
            <p className="text-xs text-cf-text-secondary leading-relaxed">{t('cbDesc')}</p>
          </div>
        </div>
      </div>

      {/* Global snapshot */}
      {globalSnapshot && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="cf-card p-3 text-center">
            <div className="text-lg font-extrabold text-cf-text-primary tabular-nums">${globalSnapshot.totalBalance.toFixed(0)}B</div>
            <div className="text-[10px] text-cf-text-secondary mt-0.5">{t('cbGlobalTotal')}</div>
          </div>
          <div className="cf-card p-3 text-center">
            <div className="text-lg font-extrabold text-amber-600 tabular-nums">{globalSnapshot.globalGdpRatio.toFixed(2)}%</div>
            <div className="text-[10px] text-cf-text-secondary mt-0.5">{t('cbGlobalGdp')}</div>
          </div>
          <div className="cf-card p-3 text-center">
            <div className="text-lg font-extrabold text-orange-600 tabular-nums">
              {(globalSnapshot.riskCounts['high'] ?? 0) + (globalSnapshot.riskCounts['extreme'] ?? 0)}
            </div>
            <div className="text-[10px] text-cf-text-secondary mt-0.5">{t('cbHighRiskCount')}</div>
          </div>
          <div className="cf-card p-3 text-center">
            <div className="text-base font-extrabold text-red-600 truncate">
              {globalSnapshot.fastestGrowing[0]?.flag} {globalSnapshot.fastestGrowing[0]?.country}
            </div>
            <div className="text-[10px] text-cf-text-secondary mt-0.5">{t('cbFastestGrowing')}</div>
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
          <button onClick={() => setViewMode('gdpRatio')} className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${viewMode === 'gdpRatio' ? 'bg-white shadow-sm text-cf-text-primary' : 'text-gray-500'}`}>{t('cbViewGdp')}</button>
          <button onClick={() => setViewMode('balance')} className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${viewMode === 'balance' ? 'bg-white shadow-sm text-cf-text-primary' : 'text-gray-500'}`}>{t('cbViewBalance')}</button>
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
                {t(RISK_KEYS[activeCountry.riskLevel])} ({t('cbLegacyPct', { p: activeCountry.histPercentile })})
              </span>
            </div>
            <p className="text-xs text-cf-text-secondary">{activeCountry.source} · {activeCountry.lastUpdated}</p>
          </div>
          <button
            onClick={() => setShowLayman(p => !p)}
            className={`flex-shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${showLayman ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-blue-50 border-blue-100 text-blue-600'}`}
          >
            {t('cbExplainTitle')}
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
            <div className="text-[10px] text-cf-text-secondary mb-1">{t('cbCurrentBalance')}</div>
            <div className="text-base font-extrabold text-cf-text-primary">{activeCountry.currentBalanceLocal}</div>
            <div className="text-[10px] text-gray-400">${activeCountry.currentBalance.toFixed(1)}B USD</div>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-[10px] text-cf-text-secondary mb-1">{t('cbGdpRatio')}</div>
            <div className={`text-base font-extrabold tabular-nums ${rc.text}`}>{activeCountry.gdpRatio.toFixed(2)}%</div>
            <GdpRatioGauge
              ratio={activeCountry.gdpRatio}
              peak={gdpRatioPeak}
              trough={gdpRatioTrough}
              percentile={activeCountry.histPercentile}
              labels={{
                min: t('cbGaugeMin', { v: gdpRatioTrough.toFixed(1) }),
                current: t('cbGaugeCurrent', { v: activeCountry.gdpRatio.toFixed(2) }),
                max: t('cbGaugeMax', { v: gdpRatioPeak.toFixed(1) }),
                safe: t('cbRiskLow'), caution: t('cbRiskMedium'), warning: t('cbRiskHigh'), danger: t('cbRiskExtreme'),
              }}
            />
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-[10px] text-cf-text-secondary mb-1">{t('cbYoY')}</div>
            <div className={`text-base font-extrabold tabular-nums ${activeCountry.changeYoY >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
              {activeCountry.changeYoY >= 0 ? '+' : ''}{activeCountry.changeYoY.toFixed(1)}%
            </div>
            <div className="text-[10px] text-gray-400">{t('cbYoYNote')}</div>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-[10px] text-cf-text-secondary mb-1">{t('cbPeak')}</div>
            <div className="text-base font-extrabold text-cf-text-primary">{activeCountry.peakPeriod}</div>
            <div className="text-[10px] text-gray-400">{t('cbPercentileNote', { p: activeCountry.histPercentile })}</div>
          </div>
        </div>

        {/* Historical bar chart */}
        <div className="mt-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-cf-text-primary">{t('cbHistTitle')}</p>
            <span className="text-[10px] text-cf-text-secondary">{viewMode === 'gdpRatio' ? t('cbHistAxisGdp') : t('cbHistAxisBal')}</span>
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
                      <div>{viewMode === 'gdpRatio' ? t('cbGaugeCurrent', { v: val.toFixed(2) }) : `$${val}B`}</div>
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
            <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-red-400" /><span className="text-cf-text-secondary">{t('cbLegendPeak')}</span></div>
            <div className="flex items-center gap-1"><div className={`w-2.5 h-2.5 rounded-sm ${rc.bar}`} /><span className="text-cf-text-secondary">{t('cbLegendCurrent')}</span></div>
            <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-blue-300" /><span className="text-cf-text-secondary">{t('cbLegendPast')}</span></div>
          </div>
        </div>

        {/* Risk reason */}
        <div className={`p-3 rounded-xl border text-xs leading-relaxed ${rc.bg} ${rc.text}`}>
          <span className="font-bold">{t('cbRiskAnalysis')}</span>{activeCountry.riskReason}
        </div>
      </div>

      {/* US long-term history */}
      {usLongHistory && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-1 flex items-center gap-2">
            {t('cbUsHistTitle')}
          </h3>
          <p className="text-xs text-cf-text-secondary mb-3">
            {t('cbUsHistDesc')}
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
                      <div>{t('cbTooltipFull', { v: val.toFixed(1), b: pt.balance })}</div>
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
              { period: '2000-2002', color: 'bg-red-50 border-red-100 text-red-700', label: t('cbEra1Label'), desc: t('cbEra1Desc') },
              { period: '2007-2009', color: 'bg-orange-50 border-orange-100 text-orange-700', label: t('cbEra2Label'), desc: t('cbEra2Desc') },
              { period: '2021-2022', color: 'bg-amber-50 border-amber-100 text-amber-700', label: t('cbEra3Label'), desc: t('cbEra3Desc') },
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
          <h3 className="text-sm font-bold text-cf-text-primary">{t('cbComparisonTitle')}</h3>
          <p className="text-xs text-cf-text-secondary">{t('cbComparisonDesc')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-cf-border bg-gray-50/50">
                <th className="text-left px-4 py-2 font-semibold text-cf-text-secondary">{t('cbThCountry')}</th>
                <th className="text-right px-3 py-2 font-semibold text-cf-text-secondary">{t('cbThBalance')}</th>
                <th className="text-right px-3 py-2 font-semibold text-cf-text-secondary">{t('cbThGdpRatio')}</th>
                <th className="text-right px-3 py-2 font-semibold text-cf-text-secondary">{t('cbYoY')}</th>
                <th className="text-center px-3 py-2 font-semibold text-cf-text-secondary">{t('cbThPercentile')}</th>
                <th className="text-center px-3 py-2 font-semibold text-cf-text-secondary">{t('cbThTrend')}</th>
                <th className="text-center px-3 py-2 font-semibold text-cf-text-secondary">{t('cbThRisk')}</th>
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
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${rc2.bg} ${rc2.text}`}>{t(RISK_KEYS[c.riskLevel])}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-[10px] text-cf-text-secondary border-t border-cf-border">
          {t('cbFootnote')}
        </div>
      </div>
    </div>
  );
}
