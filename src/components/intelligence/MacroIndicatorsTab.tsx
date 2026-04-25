'use client';

import { useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, TrendingUp, Activity, GitMerge, BarChart2 } from 'lucide-react';
import EconCalendarSection from './EconCalendarSection';
import VolatilityCard from '@/components/VolatilityCard';

// ── FedWatch ──────────────────────────────────────────────────────────────────
interface FomcMeeting {
  date: string; label: string;
  targetLow: number; targetHigh: number;
  probHike: number; probHold: number; probCut25: number; probCut50: number; probCut75: number;
  impliedRate: number; cumulativeCuts: number;
}
interface FedWatchData {
  currentTargetLow: number; currentTargetHigh: number; currentRateMid: number;
  meetings: FomcMeeting[];
  yearEndImpliedRate: number; totalImpliedCuts: number;
  updatedAt: string; source: string;
}

function FedWatchSection() {
  const t = useTranslations('macro');
  const [data, setData] = useState<FedWatchData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/fedwatch', { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) return (
    <div className="cf-card p-4 flex items-center gap-2 text-cf-text-secondary">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-xs">{t('fwLoading')}</span>
    </div>
  );
  if (!data) return null;

  const today = new Date();

  return (
    <div className="cf-card p-4">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🏛️</span>
            <h3 className="text-sm font-bold text-cf-text-primary">{t('fwTitle')}</h3>
          </div>
          <p className="text-xs text-cf-text-secondary">{t('fwDesc')}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-cf-text-secondary">{t('fwCurrentRate')}</span>
            <span className="text-base font-extrabold text-cf-text-primary tabular-nums">
              {data.currentTargetLow}–{data.currentTargetHigh}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-cf-text-secondary">{t('fwYearEnd')}</span>
            <span className="text-sm font-bold text-blue-600 tabular-nums">{data.yearEndImpliedRate.toFixed(2)}%</span>
            <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-semibold">
              {t('fwBpCut', { n: data.totalImpliedCuts })}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {data.meetings.map((m) => {
          const isPast = new Date(m.date) < today;
          const isNext = !isPast && data.meetings.findIndex(x => new Date(x.date) >= today) === data.meetings.indexOf(m);
          const dominantCut = m.probCut25 + m.probCut50 + m.probCut75;

          return (
            <div key={m.date} className={`rounded-xl border p-3 ${isNext ? 'border-cf-primary/40 bg-cf-primary/5' : 'border-cf-border bg-white'} ${isPast ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                <div className="flex items-center gap-2">
                  {isNext && <span className="text-[9px] font-bold bg-cf-primary text-white px-1.5 py-0.5 rounded-full">NEXT</span>}
                  <span className="text-xs font-bold text-cf-text-primary">{m.label}</span>
                  <span className="text-[10px] text-cf-text-secondary">{m.date}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-cf-text-secondary">{t('fwExpRate')}</span>
                  <span className="text-xs font-bold tabular-nums text-cf-text-primary">{m.impliedRate.toFixed(2)}%</span>
                  {m.cumulativeCuts > 0 && (
                    <span className="text-[10px] text-blue-600 font-semibold">-{m.cumulativeCuts}bp</span>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-16 flex-shrink-0">{t('fwHold')}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gray-400 rounded-full transition-all" style={{ width: `${m.probHold}%` }} />
                  </div>
                  <span className="text-[10px] font-bold text-gray-600 w-10 text-right tabular-nums">{m.probHold.toFixed(1)}%</span>
                </div>
                {m.probCut25 > 0.5 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-blue-600 w-16 flex-shrink-0">-25bp</span>
                    <div className="flex-1 h-4 bg-blue-50 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${m.probCut25}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-blue-600 w-10 text-right tabular-nums">{m.probCut25.toFixed(1)}%</span>
                  </div>
                )}
                {m.probCut50 > 0.5 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-indigo-600 w-16 flex-shrink-0">-50bp</span>
                    <div className="flex-1 h-4 bg-indigo-50 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${m.probCut50}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-indigo-600 w-10 text-right tabular-nums">{m.probCut50.toFixed(1)}%</span>
                  </div>
                )}
                {m.probCut75 > 0.5 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-purple-600 w-16 flex-shrink-0">-75bp+</span>
                    <div className="flex-1 h-4 bg-purple-50 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-400 rounded-full transition-all" style={{ width: `${m.probCut75}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-purple-600 w-10 text-right tabular-nums">{m.probCut75.toFixed(1)}%</span>
                  </div>
                )}
                {m.probHike > 0.5 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-red-600 w-16 flex-shrink-0">+25bp</span>
                    <div className="flex-1 h-4 bg-red-50 rounded-full overflow-hidden">
                      <div className="h-full bg-red-400 rounded-full transition-all" style={{ width: `${m.probHike}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-red-600 w-10 text-right tabular-nums">{m.probHike.toFixed(1)}%</span>
                  </div>
                )}
              </div>

              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  dominantCut > 60 ? 'bg-blue-100 text-blue-700' :
                  m.probHold > 60 ? 'bg-gray-100 text-gray-600' :
                  'bg-amber-50 text-amber-700'
                }`}>
                  {dominantCut > 60 ? t('fwCutDominant', { pct: dominantCut.toFixed(0) }) :
                   m.probHold > 60 ? t('fwHoldDominant', { pct: m.probHold.toFixed(0) }) :
                   t('fwMixed')}
                </span>
                {m.targetLow !== data.currentTargetLow && (
                  <span className="text-[10px] text-cf-text-secondary">
                    → {m.targetLow}–{m.targetHigh}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-[10px] text-cf-text-secondary">{t('fwFootnote')}</p>
        <span className="text-[10px] text-gray-400">{t('fwBasis', { date: data.updatedAt })}</span>
      </div>
    </div>
  );
}

// ── Macro Indicators Tab ──────────────────────────────────────────────────────
interface CascadeStep { asset: string; direction: 'up' | 'down' | 'mixed'; reason: string; magnitude: 'strong' | 'moderate' | 'weak'; }
interface MacroIndicator {
  id: string; name: string; category: string;
  actual: number | null; forecast: number | null; previous: number | null; unit: string;
  releaseDate: string; nextRelease?: string;
  liveData?: boolean;
  dataNote?: string;
  surprise: 'beat' | 'miss' | 'inline' | 'pending';
  rateImpact: 'hawkish' | 'dovish' | 'neutral';
  cascade: CascadeStep[]; summary: string;
}

const SURPRISE_BADGE_CLS: Record<string, string> = {
  beat:    'bg-red-50 text-red-700 border border-red-200',
  miss:    'bg-blue-50 text-blue-700 border border-blue-200',
  inline:  'bg-gray-50 text-gray-600 border border-gray-200',
  pending: 'bg-amber-50 text-amber-600 border border-amber-200',
};
const RATE_BADGE_CLS: Record<string, string> = {
  hawkish: 'bg-red-100 text-red-700',
  dovish:  'bg-blue-100 text-blue-700',
  neutral: 'bg-gray-100 text-gray-600',
};
const CASCADE_ICONS: Record<string, string> = { up: '▲', down: '▼', mixed: '↕' };
const MAG_OPACITY: Record<string, string> = { strong: 'opacity-100', moderate: 'opacity-70', weak: 'opacity-40' };
// 'up' = higher value is improvement; 'down' = lower is improvement
const POSITIVE_DIR: Record<string, 'up' | 'down'> = {
  cpi: 'down', pce: 'down', ppi: 'down',
  nfp: 'up', gdp: 'up', ism: 'up', retail: 'up', umcsent: 'up',
  unrate: 'down', iclaims: 'down',
  ig_spread: 'down', hy_spread: 'down',
};

// ── Macro Risk Signal ──────────────────────────────────────────────────────────
function MacroRiskSignal({ indicators, yieldCurve }: { indicators: MacroIndicator[]; yieldCurve: { inverted: boolean; spread10y2y: number | null } | null }) {
  const t = useTranslations('macro');
  const ig = indicators.find(i => i.id === 'ig_spread')?.actual ?? null;
  const hy = indicators.find(i => i.id === 'hy_spread')?.actual ?? null;
  const umc = indicators.find(i => i.id === 'umcsent')?.actual ?? null;
  const inverted = yieldCurve?.inverted ?? false;

  if (ig === null && hy === null && umc === null) return null;

  const riskOff = (hy != null && hy > 5.0) || (ig != null && ig > 1.5) ||
                  (inverted && (hy != null && hy > 4.0)) || (umc != null && umc < 50);
  const riskOn = (hy != null && hy < 3.5) && (ig != null && ig < 1.0) &&
                 !inverted && (umc != null && umc > 60);
  const signal = riskOff ? 'risk-off' : riskOn ? 'risk-on' : 'neutral';

  const CFG = {
    'risk-on':  { emoji: '🟢', label: t('mrRiskOnLabel'),  desc: t('mrRiskOnDesc'),  bg: 'bg-green-50 border-green-200',  text: 'text-green-800' },
    'neutral':  { emoji: '🟡', label: t('mrNeutralLabel'),  desc: t('mrNeutralDesc'),  bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-800' },
    'risk-off': { emoji: '🔴', label: t('mrRiskOffLabel'), desc: t('mrRiskOffDesc'), bg: 'bg-red-50 border-red-200',   text: 'text-red-800' },
  } as const;

  const cfg = CFG[signal];
  const pills = [
    { label: 'IG OAS', val: ig != null ? `${ig.toFixed(2)}%` : '?', ok: ig != null && ig < 1.0, warn: ig != null && ig > 1.5 },
    { label: 'HY OAS', val: hy != null ? `${hy.toFixed(2)}%` : '?', ok: hy != null && hy < 3.5, warn: hy != null && hy > 5.0 },
    { label: 'UMC',    val: umc != null ? umc.toFixed(1) : '?',       ok: umc != null && umc > 60, warn: umc != null && umc < 50 },
    { label: t('mrYieldCurve'), val: inverted ? t('mrInverted') : t('mrNormal'), ok: !inverted, warn: inverted },
  ];

  return (
    <div className={`cf-card p-4 border ${cfg.bg}`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none">{cfg.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-sm font-extrabold ${cfg.text}`}>{cfg.label}</span>
            <span className="text-[10px] text-cf-text-secondary">{t('mrSubtitle')}</span>
          </div>
          <p className={`text-xs ${cfg.text} opacity-80 mb-2`}>{cfg.desc}</p>
          <div className="flex flex-wrap gap-1.5">
            {pills.map(p => (
              <span key={p.label} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.warn ? 'bg-red-100 text-red-700' : p.ok ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                {p.label} {p.val}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const CAT_COLORS: Record<string, string> = { inflation: 'bg-orange-50 text-orange-700', employment: 'bg-green-50 text-green-700', growth: 'bg-blue-50 text-blue-700', monetary: 'bg-purple-50 text-purple-700', trade: 'bg-teal-50 text-teal-700', credit: 'bg-red-50 text-red-700' };

interface YieldPoint { label: string; value: number | null; }
interface YieldCurve { points: YieldPoint[]; inverted: boolean; spread10y2y: number | null; }

function LaymanBox({ id }: { id: string }) {
  const t = useTranslations('macro');
  const LAYMAN_T: Record<string, { what: string; why: string; good: string; bad: string }> = {
    cpi:       { what: t('lCpiWhat'),    why: t('lCpiWhy'),    good: t('lCpiGood'),    bad: t('lCpiBad') },
    pce:       { what: t('lPceWhat'),    why: t('lPceWhy'),    good: t('lPceGood'),    bad: t('lPceBad') },
    nfp:       { what: t('lNfpWhat'),    why: t('lNfpWhy'),    good: t('lNfpGood'),    bad: t('lNfpBad') },
    fomc:      { what: t('lFomcWhat'),   why: t('lFomcWhy'),   good: t('lFomcGood'),   bad: t('lFomcBad') },
    gdp:       { what: t('lGdpWhat'),    why: t('lGdpWhy'),    good: t('lGdpGood'),    bad: t('lGdpBad') },
    ism:       { what: t('lIsmWhat'),    why: t('lIsmWhy'),    good: t('lIsmGood'),    bad: t('lIsmBad') },
    retail:    { what: t('lRetailWhat'), why: t('lRetailWhy'), good: t('lRetailGood'), bad: t('lRetailBad') },
    ppi:       { what: t('lPpiWhat'),    why: t('lPpiWhy'),    good: t('lPpiGood'),    bad: t('lPpiBad') },
    unrate:    { what: t('lUnrateWhat'), why: t('lUnrateWhy'), good: t('lUnrateGood'), bad: t('lUnrateBad') },
    ig_spread: { what: t('lIgWhat'),     why: t('lIgWhy'),     good: t('lIgGood'),     bad: t('lIgBad') },
    hy_spread: { what: t('lHyWhat'),     why: t('lHyWhy'),     good: t('lHyGood'),     bad: t('lHyBad') },
  };
  const info = LAYMAN_T[id];
  if (!info) return null;
  return (
    <div className="mt-3 rounded-xl bg-blue-50 border border-blue-100 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none">💡</span>
        <div>
          <p className="text-xs font-bold text-blue-800 mb-0.5">{t('lbWhat')}</p>
          <p className="text-xs text-blue-700 leading-relaxed">{info.what}</p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none">🎯</span>
        <div>
          <p className="text-xs font-bold text-blue-800 mb-0.5">{t('lbWhy')}</p>
          <p className="text-xs text-blue-700 leading-relaxed">{info.why}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
        <div className="flex items-start gap-1.5 text-xs bg-green-50 border border-green-100 rounded-lg p-2">
          <span>✅</span>
          <span className="text-green-700 leading-relaxed">{info.good}</span>
        </div>
        <div className="flex items-start gap-1.5 text-xs bg-red-50 border border-red-100 rounded-lg p-2">
          <span>⚠️</span>
          <span className="text-red-700 leading-relaxed">{info.bad}</span>
        </div>
      </div>
    </div>
  );
}

// ── Sector ETF ──────────────────────────────────────────────────────────────
interface SectorPEEntry {
  ticker: string; name: string;
  price: number | null; changePct: number | null;
  ytdReturn: number | null; high52: number | null; low52: number | null;
  trailingPE: number | null; dividendYield: number | null;
}

function SectorPESection() {
  const t = useTranslations('macro');
  const [data, setData] = useState<SectorPEEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/sector-pe', { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !controller.signal.aborted) setData(d.sectors ?? []); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  if (loading) return (
    <div className="cf-card p-4 animate-pulse">
      <div className="h-4 bg-gray-100 rounded w-40 mb-3" />
      <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-3 bg-gray-50 rounded w-full" />)}</div>
    </div>
  );

  if (!data.length) return null;

  const sorted = [...data].sort((a, b) => (b.ytdReturn ?? -99) - (a.ytdReturn ?? -99));

  return (
    <div className="cf-card p-4">
      <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
        <BarChart2 className="w-4 h-4 text-cf-primary" />
        {t('spTitle')}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-cf-border text-cf-text-secondary">
              <th className="text-left py-1.5 pr-3 font-semibold">{t('spColSector')}</th>
              <th className="text-right py-1.5 px-2 font-semibold">{t('spColPrice')}</th>
              <th className="text-right py-1.5 px-2 font-semibold">{t('spColChange')}</th>
              <th className="text-right py-1.5 pl-2 font-semibold">YTD</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => {
              const ytd = s.ytdReturn != null ? s.ytdReturn * 100 : null;
              const chg = s.changePct;
              return (
                <tr key={s.ticker} className="border-b border-cf-border/40 hover:bg-gray-50/50 transition-colors">
                  <td className="py-1.5 pr-3">
                    <span className="font-mono font-bold text-cf-primary text-[11px]">{s.ticker}</span>
                    <span className="text-cf-text-secondary ml-1.5">{s.name}</span>
                  </td>
                  <td className="text-right py-1.5 px-2 tabular-nums font-semibold text-cf-text-primary">
                    {s.price != null ? `$${s.price.toFixed(2)}` : '—'}
                  </td>
                  <td className={`text-right py-1.5 px-2 tabular-nums font-semibold ${chg == null ? 'text-cf-text-secondary' : chg >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}
                  </td>
                  <td className={`text-right py-1.5 pl-2 tabular-nums font-semibold ${ytd == null ? 'text-cf-text-secondary' : ytd >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {ytd != null ? `${ytd >= 0 ? '+' : ''}${ytd.toFixed(1)}%` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-cf-text-secondary mt-2">{t('spFootnote')}</p>
    </div>
  );
}

export default function MacroIndicatorsTab() {
  const locale = useLocale();
  const t = useTranslations('macro');
  const [indicators, setIndicators] = useState<MacroIndicator[]>([]);
  const [yieldCurve, setYieldCurve] = useState<YieldCurve | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showLayman, setShowLayman] = useState<string | null>(null);

  const SURPRISE_LABEL: Record<string, string> = {
    beat: t('sbBeat'), miss: t('sbMiss'), inline: t('sbInline'), pending: t('sbPending'),
  };
  const RATE_LABEL: Record<string, string> = {
    hawkish: t('rbHawkish'), dovish: t('rbDovish'), neutral: t('rbNeutral'),
  };
  const CAT_LABELS_T: Record<string, string> = {
    inflation: t('catInflation'), employment: t('catEmployment'), growth: t('catGrowth'),
    monetary: t('catMonetary'), trade: t('catTrade'), credit: t('catCredit'),
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/macro-indicators', { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setIndicators(d.indicators ?? []); setYieldCurve(d.yieldCurve ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-cf-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">{t('miLoading')}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <EconCalendarSection />

      <div className="cf-card p-4 bg-gradient-to-r from-slate-50 to-blue-50 border-blue-100">
        <div className="flex items-start gap-3">
          <div className="text-2xl leading-none">📊</div>
          <div>
            <h3 className="text-sm font-bold text-cf-text-primary mb-1">{t('miTitle')}</h3>
            <p className="text-xs text-cf-text-secondary leading-relaxed">
              {t('miDesc')}
              <span className="font-semibold text-cf-primary ml-1">{t('miLaymanHint')}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Macro Risk Signal */}
      {indicators.length > 0 && (
        <MacroRiskSignal indicators={indicators} yieldCurve={yieldCurve} />
      )}

      {/* Yield Curve */}
      {yieldCurve && (
        <div className={`cf-card p-4 ${yieldCurve.inverted ? 'border-red-300 bg-red-50/30' : ''}`}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold text-cf-text-primary flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cf-primary" />
              {t('miYieldTitle')}
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              {yieldCurve.spread10y2y !== null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${yieldCurve.inverted ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                  10Y-2Y: {yieldCurve.spread10y2y > 0 ? '+' : ''}{yieldCurve.spread10y2y}%p
                </span>
              )}
              {yieldCurve.inverted && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                  {t('miYieldInverted')}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-end gap-2 h-24">
            {yieldCurve.points.map((pt) => {
              const val = pt.value ?? 0;
              const maxVal = Math.max(...yieldCurve.points.map(p => p.value ?? 0), 1);
              const heightPct = (val / maxVal) * 100;
              return (
                <div key={pt.label} className="flex flex-col items-center flex-1 gap-1">
                  <span className="text-[10px] font-bold text-cf-text-primary tabular-nums">{val.toFixed(2)}%</span>
                  <div
                    className={`w-full rounded-t ${yieldCurve.inverted ? 'bg-red-400' : 'bg-blue-400'} transition-all`}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  />
                  <span className="text-[10px] text-cf-text-secondary">{pt.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIX Term Structure */}
      <VolatilityCard />

      {/* FedWatch */}
      <FedWatchSection />

      {/* Sector P/E */}
      <SectorPESection />

      {/* Upcoming Releases Calendar */}
      {indicators.length > 0 && (() => {
        const now = new Date();
        const upcoming = indicators
          .filter(ind => ind.nextRelease)
          .map(ind => {
            const d = new Date(ind.nextRelease!);
            const daysUntil = Math.ceil((d.getTime() - now.getTime()) / 86400000);
            return { ...ind, releaseDate: d, daysUntil };
          })
          .filter(ind => ind.daysUntil >= 0)
          .sort((a, b) => a.daysUntil - b.daysUntil);
        if (!upcoming.length) return null;
        const CAT_DOT: Record<string, string> = {
          inflation: 'bg-orange-400', employment: 'bg-green-500',
          growth: 'bg-blue-500', monetary: 'bg-purple-500', trade: 'bg-teal-500', credit: 'bg-red-400',
        };
        return (
          <div className="cf-card p-4">
            <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-cf-primary" />
              {t('miUpcomingTitle')}
            </h3>
            <div className="space-y-2">
              {upcoming.map(ind => (
                <div key={ind.id} className="flex items-center gap-3 text-xs">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${CAT_DOT[ind.category] ?? 'bg-gray-400'}`} />
                  <div className="w-12 text-right flex-shrink-0">
                    {ind.daysUntil === 0
                      ? <span className="font-bold text-cf-primary">{t('miToday')}</span>
                      : ind.daysUntil === 1
                        ? <span className="font-semibold text-amber-600">{t('miTomorrow')}</span>
                        : <span className="text-cf-text-secondary">{t('miDaysLater', { days: ind.daysUntil })}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-cf-text-primary">{ind.name}</span>
                    {ind.forecast != null && (
                      <span className="text-cf-text-secondary ml-2">
                        {t('miConsensus', { value: ind.forecast, unit: ind.unit.includes('%') ? '%' : ` ${ind.unit}` })}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-cf-text-secondary flex-shrink-0">
                    {ind.releaseDate.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Indicators */}
      <div className="flex items-center gap-2 px-1">
        <Activity className="w-4 h-4 text-cf-primary" />
        <h3 className="text-sm font-bold text-cf-text-primary">{t('miIndicatorsTitle')}</h3>
        <span className="text-xs text-cf-text-secondary">{t('miClickHint')}</span>
      </div>

      <div className="space-y-3">
        {indicators.map((ind) => {
          const sbCls = SURPRISE_BADGE_CLS[ind.surprise];
          const rbCls = RATE_BADGE_CLS[ind.rateImpact];
          const isOpen = expanded === ind.id;
          const isLayman = showLayman === ind.id;
          return (
            <div key={ind.id} className="cf-card overflow-hidden">
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CAT_COLORS[ind.category] ?? 'bg-gray-50 text-gray-600'}`}>
                        {CAT_LABELS_T[ind.category] ?? ind.category}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${sbCls}`}>
                        {SURPRISE_LABEL[ind.surprise]}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${rbCls}`}>
                        {RATE_LABEL[ind.rateImpact]}
                      </span>
                      {ind.liveData && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 flex items-center gap-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                          LIVE
                        </span>
                      )}
                    </div>
                    <div className="font-bold text-cf-text-primary text-sm">{ind.name}</div>
                  </div>
                  <div className="flex items-end gap-3 flex-shrink-0 text-right">
                    {ind.actual !== null && (
                      <div>
                        <div className={`text-xl font-extrabold tabular-nums leading-tight ${ind.surprise === 'beat' ? 'text-red-600' : ind.surprise === 'miss' ? 'text-blue-600' : 'text-cf-text-primary'}`}>
                          {ind.actual.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-gray-400">{ind.unit} {t('miActual')}</div>
                        {ind.previous !== null && (() => {
                          const delta = parseFloat((ind.actual - ind.previous).toFixed(2));
                          const posDir = POSITIVE_DIR[ind.id];
                          const improving = posDir ? (posDir === 'up' ? delta > 0 : delta < 0) : null;
                          const cls = improving === null ? 'text-gray-400' : improving ? 'text-green-600' : 'text-red-500';
                          const sign = delta >= 0 ? '+' : '';
                          const fmt = (v: number) => Math.abs(v) >= 100 ? v.toLocaleString() : v.toFixed(2).replace(/\.?0+$/, '');
                          return (
                            <div className={`text-[10px] font-medium mt-0.5 ${cls}`}>
                              {sign}{fmt(delta)} ← {fmt(ind.previous)}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    {ind.forecast !== null && (
                      <div>
                        <div className="text-sm font-bold text-gray-400 tabular-nums">{ind.forecast.toLocaleString()}</div>
                        <div className="text-[10px] text-gray-400">{t('miEstimate')}</div>
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-xs text-cf-text-secondary mt-2 leading-relaxed">{ind.summary}</p>
                {ind.dataNote && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-1.5 leading-relaxed">
                    ⚠️ {ind.dataNote}
                  </p>
                )}

                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => setExpanded(isOpen ? null : ind.id)}
                    className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                      isOpen ? 'bg-cf-primary/10 border-cf-primary/30 text-cf-primary' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <GitMerge className="w-3 h-3" />
                    {isOpen ? t('miCascadeCollapse') : t('miCascadeExpand')}
                  </button>
                  {LAYMAN_IDS.has(ind.id) && (
                    <button
                      onClick={() => setShowLayman(isLayman ? null : ind.id)}
                      className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                        isLayman ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-100'
                      }`}
                    >
                      💡 {isLayman ? t('miLaymanCollapse') : t('miLaymanExpand')}
                    </button>
                  )}
                  <div className="ml-auto flex flex-col items-end gap-0.5">
                    {ind.releaseDate && (
                      <span className="text-[10px] font-semibold text-cf-text-secondary">
                        📅 {t('miReleaseDate')}: <span className="text-cf-text-primary">{ind.releaseDate}</span>
                      </span>
                    )}
                    {ind.nextRelease && (
                      <span className="text-[10px] text-gray-400">{t('miNextRelease')}: {ind.nextRelease}</span>
                    )}
                  </div>
                </div>

                {isLayman && <LaymanBox id={ind.id} />}
              </div>

              {isOpen && ind.cascade.length > 0 && (
                <div className="border-t border-cf-border bg-gray-50/50 px-4 py-3">
                  <div className="text-xs font-bold text-cf-text-secondary mb-2 flex items-center gap-1.5">
                    <GitMerge className="w-3 h-3" />
                    {t('miCascadeTitle')}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {ind.cascade.map((step, i) => (
                      <div key={i} className={`flex items-center gap-2 text-xs p-2.5 rounded-xl bg-white border ${MAG_OPACITY[step.magnitude]} ${
                        step.direction === 'up' ? 'border-green-100' : step.direction === 'down' ? 'border-red-100' : 'border-gray-100'
                      }`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                          step.direction === 'up' ? 'bg-green-50 text-green-600' : step.direction === 'down' ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-500'
                        }`}>
                          {CASCADE_ICONS[step.direction]}
                        </div>
                        <div>
                          <div className="font-bold text-cf-text-primary leading-tight">{step.asset}</div>
                          <div className="text-cf-text-secondary leading-tight mt-0.5">{step.reason}</div>
                        </div>
                        <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                          step.magnitude === 'strong' ? 'bg-red-50 text-red-500' : step.magnitude === 'moderate' ? 'bg-amber-50 text-amber-500' : 'bg-gray-50 text-gray-400'
                        }`}>
                          {step.magnitude === 'strong' ? t('miMagStrong') : step.magnitude === 'moderate' ? t('miMagMedium') : t('miMagWeak')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {isOpen && ind.cascade.length === 0 && (
                <div className="border-t border-cf-border bg-gray-50/50 px-4 py-3">
                  <p className="text-xs text-cf-text-secondary">
                    {t('miNoCascade')}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LAYMAN_IDS = new Set(['cpi', 'pce', 'nfp', 'fomc', 'gdp', 'ism', 'retail', 'ppi', 'unrate', 'ig_spread', 'hy_spread']);
