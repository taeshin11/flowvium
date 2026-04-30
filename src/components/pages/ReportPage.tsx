'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { RefreshCw, Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle, ChevronDown, ChevronUp, BarChart3, Target, Shield } from 'lucide-react';
import Sparkline from '@/components/Sparkline';
import type { InvestmentStrategy, PortfolioItem, SectorWeight, RiskEvent } from '@/app/api/investment-strategy/route';

// ── KPI types ─────────────────────────────────────────────────────────────────
interface KpiState<T> { loading: boolean; error: boolean; value: T | null; }

type Tr = (k: string, vals?: Record<string, string | number | Date>) => string;

function humanAge(ms: number, t: Tr): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return t('ageJustNow');
  const m = Math.floor(s / 60);
  if (m < 60) return t('ageMin', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('ageHour', { n: h });
  return t('ageDay', { n: Math.floor(h / 24) });
}

function freshnessDot(ms: number): string {
  if (ms < 10 * 60 * 1000) return 'bg-emerald-500';
  if (ms < 60 * 60 * 1000) return 'bg-amber-400';
  return 'bg-gray-400';
}

// ── Stance config — no label (computed in component with t()) ─────────────────
function stanceConfig(stance: string) {
  if (stance === 'bullish') return { icon: <TrendingUp className="w-5 h-5" />, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' };
  if (stance === 'bearish') return { icon: <TrendingDown className="w-5 h-5" />, color: 'text-red-600', bg: 'bg-red-50 border-red-200' };
  return { icon: <Minus className="w-5 h-5" />, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' };
}

function riskConfig(level: string) {
  if (level === 'high') return { color: 'text-red-600', bg: 'bg-red-50 border-red-200' };
  if (level === 'low') return { color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' };
  return { color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' };
}

function confidenceBadge(c: string) {
  if (c === 'high') return 'bg-emerald-100 text-emerald-700';
  if (c === 'low') return 'bg-gray-100 text-gray-500';
  return 'bg-amber-100 text-amber-700';
}

function parseEntryZone(zone: string): { lower: number | null; upper: number | null } {
  const rangeMatch = zone.match(/\$?([\d,]+(?:\.\d+)?)\s*[-–]\s*\$?([\d,]+(?:\.\d+)?)/);
  if (rangeMatch) {
    return {
      lower: parseFloat(rangeMatch[1].replace(',', '')),
      upper: parseFloat(rangeMatch[2].replace(',', '')),
    };
  }
  const single = zone.match(/\$?([\d,]+(?:\.\d+)?)/);
  if (single) {
    const v = parseFloat(single[1].replace(',', ''));
    return { lower: v * 0.98, upper: v * 1.02 };
  }
  return { lower: null, upper: null };
}

function safetyBadge(currentPrice: number | undefined, entryZone: string, t: Tr): { label: string; cls: string } | null {
  if (!currentPrice) return null;
  const { lower, upper } = parseEntryZone(entryZone);
  if (!upper) return null;
  if (currentPrice > upper * 1.03) {
    const overPct = Math.round((currentPrice - upper) / upper * 100);
    return { label: t('priceExpensive', { pct: overPct }), cls: 'bg-red-50 text-red-600 border border-red-200' };
  }
  if (!lower || currentPrice >= lower * 0.97) {
    return { label: t('priceEntry'), cls: 'bg-amber-50 text-amber-700 border border-amber-200' };
  }
  const discPct = Math.round((lower - currentPrice) / lower * 100);
  return { label: t('priceCheap', { pct: discPct }), cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
}

function impactBadge(impact: string) {
  if (impact === 'high') return 'bg-red-100 text-red-700';
  if (impact === 'low') return 'bg-gray-100 text-gray-600';
  return 'bg-amber-100 text-amber-700';
}

// ── KPI Pill ──────────────────────────────────────────────────────────────────
function Pill({ loading, error, label, body, cls, sparkline, tooltip }: {
  loading: boolean; error: boolean; label: string; body: string; cls: string;
  sparkline?: number[] | null; tooltip?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div
        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap select-none
          ${loading ? 'bg-gray-50 border-gray-200 text-gray-400' : error ? 'bg-gray-50 border-gray-200 text-gray-400' : cls}
          ${tooltip ? 'cursor-pointer' : ''}`}
        onMouseEnter={() => tooltip && setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => tooltip && setOpen(v => !v)}
      >
        {sparkline && sparkline.length > 3 && (
          <span className="inline-block w-10 h-4 mr-0.5 flex-shrink-0">
            <Sparkline values={sparkline} width={40} height={16} />
          </span>
        )}
        <span className="text-[10px] font-normal opacity-70">{label}</span>
        <span>{loading ? '…' : error ? '-' : body}</span>
        {tooltip && <span className="text-[9px] opacity-50 ml-0.5">?</span>}
      </div>
      {open && tooltip && (
        <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-gray-200 bg-white shadow-lg p-2.5 text-xs text-gray-700 leading-relaxed pointer-events-none">
          {tooltip}
        </div>
      )}
    </div>
  );
}

// ── Portfolio Card ────────────────────────────────────────────────────────────
function PortfolioCard({ item, rank }: { item: PortfolioItem; rank: number }) {
  const t = useTranslations('report');
  const [expanded, setExpanded] = useState(false);
  const confidenceLabel = item.confidence === 'high' ? t('confidenceHigh') : item.confidence === 'low' ? t('confidenceLow') : t('confidenceMedium');
  const badge = safetyBadge(item.currentPrice, item.entryZone, t as Tr);
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {rank}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-gray-900">{item.ticker}</span>
                {item.action === 'buy' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-500 text-white">{t('actionBuy')}</span>
                )}
                {item.action === 'watch' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700">{t('actionWatch')}</span>
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${confidenceBadge(item.confidence)}`}>
                  {confidenceLabel}
                </span>
              </div>
              <p className="text-xs text-gray-500">{item.name} · {item.sector}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-violet-600 text-sm">{item.allocation}%</p>
            <p className="text-[10px] text-gray-400">{t('allocWeight')}</p>
          </div>
        </div>
        {/* Current price — prominent */}
        {item.currentPrice != null && (
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-lg font-bold text-gray-900 font-mono">${item.currentPrice.toFixed(item.currentPrice >= 100 ? 2 : 2)}</span>
            <span className="text-xs text-gray-400">현재가</span>
          </div>
        )}
        <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{item.rationale}</p>

        {/* Entry zone + target — always visible */}
        <div className="mt-2.5 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-400">{t('entryZone')}</span>
            <span className="font-semibold text-gray-800 font-mono">{item.entryZone}</span>
          </div>
          <span className="text-gray-200">·</span>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-400">{t('targetPrice')}</span>
            <span className="font-semibold text-emerald-600 font-mono">{item.target}</span>
          </div>
          {badge && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${badge.cls}`}>{badge.label}</span>
          )}
        </div>
      </div>

      {/* Expanded: stop loss only */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-2.5 flex items-center gap-2 text-xs">
          <span className="text-gray-400">{t('stopLoss')}</span>
          <span className="font-semibold text-red-600 font-mono">{item.stopLoss}</span>
        </div>
      )}
      <div className="px-4 pb-2 flex justify-end">
        <button onClick={() => setExpanded(v => !v)} className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
          {expanded ? <><ChevronUp className="w-3 h-3" />{t('collapse')}</> : <><ChevronDown className="w-3 h-3" />{t('expandStopLoss')}</>}
        </button>
      </div>
    </div>
  );
}

// ── Sector Bar ────────────────────────────────────────────────────────────────
function SectorBar({ item }: { item: SectorWeight }) {
  const t = useTranslations('report');
  const stanceColor = item.stance === 'overweight' ? 'bg-emerald-500' : item.stance === 'underweight' ? 'bg-red-400' : 'bg-gray-400';
  const stanceTxt = item.stance === 'overweight' ? 'text-emerald-600' : item.stance === 'underweight' ? 'text-red-500' : 'text-gray-500';
  const stanceLabel = item.stance === 'overweight' ? t('sectorOverweight') : item.stance === 'underweight' ? t('sectorUnderweight') : t('sectorNeutral');
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0">
        <p className="text-xs font-medium text-gray-700 truncate">{item.sector}</p>
        <p className={`text-[10px] ${stanceTxt}`}>{stanceLabel}</p>
      </div>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${stanceColor}`} style={{ width: `${Math.min(item.pct, 100)}%` }} />
      </div>
      <span className="text-xs font-bold text-gray-600 w-8 text-right shrink-0">{item.pct}%</span>
      <p className="text-[10px] text-gray-400 hidden sm:block truncate max-w-[140px]">{item.reason}</p>
    </div>
  );
}

// ── Risk Event Row ────────────────────────────────────────────────────────────
function RiskEventRow({ event }: { event: RiskEvent }) {
  const t = useTranslations('report');
  const impactLabel = event.impact === 'high' ? t('impactHigh') : event.impact === 'medium' ? t('impactMedium') : t('impactLow');
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex flex-col items-center shrink-0 pt-0.5">
        <span className="text-[10px] font-bold text-gray-400">{event.date.slice(5)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-gray-800">{event.event}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${impactBadge(event.impact)}`}>
            {impactLabel}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{event.watchFor}</p>
      </div>
    </div>
  );
}

// ── Source badge ──────────────────────────────────────────────────────────────
function sourceBadge(src: string): { label: string; cls: string } {
  const s = src.toLowerCase();
  if (s.includes('70b') || s.includes('groq')) return { label: 'GROQ 70b', cls: 'bg-violet-100 text-violet-700 border-violet-200' };
  if (s.includes('gemini')) return { label: 'Gemini', cls: 'bg-blue-100 text-blue-700 border-blue-200' };
  if (s.includes('fallback') || s.includes('data')) return { label: 'Fallback', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  return { label: src || 'AI', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ReportPage() {
  const t = useTranslations('report');
  const locale = useLocale();

  const [data, setData] = useState<InvestmentStrategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const abortRef = useRef<AbortController | null>(null);

  // KPI strip
  const [fg,    setFg]    = useState<KpiState<{ score: number }>>({ loading: true, error: false, value: null });
  const [spy,   setSpy]   = useState<KpiState<{ ret1w: number }>>({ loading: true, error: false, value: null });
  const [curve, setCurve] = useState<KpiState<{ spread: number; inverted: boolean }>>({ loading: true, error: false, value: null });
  const [vix,   setVix]   = useState<KpiState<{ level: number | null }>>({ loading: true, error: false, value: null });
  const [fomc,  setFomc]  = useState<KpiState<{ label: string; probCut: number }>>({ loading: true, error: false, value: null });
  const [spySpark, setSpySpark] = useState<number[] | null>(null);
  const kpiAbortRef = useRef<AbortController | null>(null);

  const fetchStrategy = useCallback(async (force = false) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams();
      if (force) params.set('force', '1');
      params.set('locale', locale);
      const res = await fetch(`/api/investment-strategy?${params}`, { signal: ctrl.signal, cache: 'no-store' });
      if (ctrl.signal.aborted) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as InvestmentStrategy;
      if (!ctrl.signal.aborted) setData(json);
    } catch {
      // leave previous data visible on refresh fail
    } finally {
      if (!ctrl.signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, [locale]);

  const fetchKpis = useCallback(async () => {
    kpiAbortRef.current?.abort();
    const ctrl = new AbortController();
    kpiAbortRef.current = ctrl;
    const { signal } = ctrl;

    setFg({ loading: true, error: false, value: null });
    setSpy({ loading: true, error: false, value: null });
    setCurve({ loading: true, error: false, value: null });
    setVix({ loading: true, error: false, value: null });
    setFomc({ loading: true, error: false, value: null });

    void fetch('/api/fear-greed', { signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(j => {
      const us = (j?.byCountry ?? []).find((x: { id?: string }) => x?.id === 'us');
      if (!signal.aborted) setFg({ loading: false, error: !us, value: us ? { score: us.score } : null });
    }).catch(() => { if (!signal.aborted) setFg({ loading: false, error: true, value: null }); });

    void fetch('/api/capital-flows', { signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(j => {
      const assets: Array<{ ticker?: string; ret1w?: number }> = j?.assets ?? [];
      const spyRow = assets.find(a => a.ticker === 'SPY');
      if (!signal.aborted) setSpy({ loading: false, error: !spyRow, value: spyRow ? { ret1w: spyRow.ret1w ?? 0 } : null });
    }).catch(() => { if (!signal.aborted) setSpy({ loading: false, error: true, value: null }); });

    void fetch('/api/yield-curve', { signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(j => {
      const raw = j?.spread2s10sCurrent ?? j?.spread ?? j?.spreadBp;
      // spread2s10sCurrent is in % (e.g. 0.51 = 51bp); legacy spreadBp already in bp
      const sp = raw != null ? (j?.spread2s10sCurrent != null ? Math.round(raw * 100) : raw) : null;
      if (!signal.aborted) setCurve({ loading: false, error: sp == null, value: sp != null ? { spread: sp, inverted: sp < 0 } : null });
    }).catch(() => { if (!signal.aborted) setCurve({ loading: false, error: true, value: null }); });

    void fetch('/api/volatility', { signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(j => {
      const level = j?.vix30d ?? j?.vix ?? null;
      if (!signal.aborted) setVix({ loading: false, error: level == null, value: { level } });
    }).catch(() => { if (!signal.aborted) setVix({ loading: false, error: true, value: null }); });

    void fetch('/api/fedwatch', { signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(j => {
      const next = (j?.meetings ?? [])[0];
      if (!signal.aborted) setFomc({ loading: false, error: !next, value: next ? { label: next.label, probCut: next.probCut25 ?? 0 } : null });
    }).catch(() => { if (!signal.aborted) setFomc({ loading: false, error: true, value: null }); });

    void fetch('/api/price-history?ticker=SPY&days=30', { signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(j => {
      const closes = (j?.prices ?? []).map((p: { close?: number }) => p.close).filter(Boolean);
      if (!signal.aborted && closes.length > 3) setSpySpark(closes);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchStrategy();
    fetchKpis();
    const iv = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => {
      clearInterval(iv);
      abortRef.current?.abort();
      kpiAbortRef.current?.abort();
    };
  }, [fetchStrategy, fetchKpis]);

  const ageMs = data ? nowTick - new Date(data.generatedAt).getTime() : 0;
  const sb = data ? sourceBadge(data.source) : null;

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex flex-col items-center gap-4 text-gray-400 py-20">
          <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
          <p className="text-sm">{t('loadingDetail')}</p>
          <p className="text-xs text-gray-300">{t('loadingDesc')}</p>
        </div>
      </div>
    );
  }

  const stanceCfg = data ? stanceConfig(data.stance) : null;
  const riskCfg = data ? riskConfig(data.riskLevel) : null;
  const stanceLabel = data ? (data.stance === 'bullish' ? t('stanceBullish') : data.stance === 'bearish' ? t('stanceBearish') : t('stanceNeutral')) : '';
  const riskLevelLabel = data ? (data.riskLevel === 'high' ? t('riskHigh') : data.riskLevel === 'low' ? t('riskLow') : t('riskMedium')) : '';

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('pageTitle')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('pageDesc')}</p>
        </div>
        <div className="flex items-center gap-2">
          {sb && (
            <span className={`text-[10px] px-2 py-1 rounded border font-medium ${sb.cls}`}>{sb.label}</span>
          )}
          {data && (
            <span className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className={`w-1.5 h-1.5 rounded-full ${freshnessDot(ageMs)}`} />
              {humanAge(ageMs, t)}
            </span>
          )}
          <button
            onClick={() => fetchStrategy(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {t('refresh')}
          </button>
        </div>
      </div>

      {/* ── KPI Strip ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-5">
        <Pill loading={fg.loading} error={fg.error} label="F&G" cls={`${fg.value && fg.value.score > 70 ? 'bg-red-50 text-red-700 border-red-200' : fg.value && fg.value.score >= 45 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}
          body={fg.value ? `${fg.value.score}` : '-'} tooltip={t('tipFg')} />
        <Pill loading={spy.loading} error={spy.error} label="SPY" cls={`${spy.value && spy.value.ret1w >= 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}
          body={spy.value ? `${spy.value.ret1w > 0 ? '+' : ''}${spy.value.ret1w.toFixed(2)}%` : '-'} sparkline={spySpark} tooltip={t('tipSpy')} />
        <Pill loading={curve.loading} error={curve.error} label="10Y-2Y" cls={`${curve.value && curve.value.inverted ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}
          body={curve.value ? `${curve.value.spread > 0 ? '+' : ''}${curve.value.spread}bp` : '-'} tooltip={t('tipCurve')} />
        <Pill loading={vix.loading} error={vix.error} label="VIX" cls={`${vix.value && (vix.value.level ?? 0) > 25 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-700 border-gray-200'}`}
          body={vix.value?.level != null ? `${vix.value.level.toFixed(1)}` : '-'} tooltip={t('tipVix')} />
        <Pill loading={fomc.loading} error={fomc.error} label="FOMC" cls="bg-violet-50 text-violet-700 border-violet-200"
          body={fomc.value ? `${fomc.value.label} ${fomc.value.probCut}%` : '-'} tooltip={t('tipFomc')} />
      </div>

      {/* ── No data fallback ──────────────────────────────────────────────── */}
      {!data && (
        <div className="text-center py-12 text-gray-400">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-400" />
          <p>{t('error')}</p>
        </div>
      )}

      {data && (
        <>
          {/* ── Investment Stance Hero ─────────────────────────────────────── */}
          <div className={`rounded-2xl border p-5 mb-5 ${stanceCfg!.bg}`}>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <div className={`flex items-center gap-2 font-bold text-lg ${stanceCfg!.color}`}>
                {stanceCfg!.icon}
                <span>{stanceLabel}</span>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${riskCfg!.bg} ${riskCfg!.color}`}>
                {t('riskLabel')} {riskLevelLabel}
              </span>
              {data.cached && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{t('cached')}</span>}
            </div>
            {data.dataAsOf && (
              <p className="text-[10px] text-gray-400 mt-0.5 mb-1.5">
                {t('dataAsOf')} {new Date(data.dataAsOf).toLocaleString()}
              </p>
            )}
            <p className="text-sm font-medium text-gray-800 leading-relaxed">{data.thesis}</p>
          </div>

          {/* ── Buy Recommendations strip ─────────────────────────────────── */}
          {data.portfolio.some(p => p.action === 'buy') && (
            <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3 flex-wrap">
              <span className="text-xs font-bold text-emerald-700 shrink-0">{t('buyNow')}</span>
              {data.portfolio.filter(p => p.action === 'buy').map(p => (
                <span key={p.ticker} className="inline-flex items-center gap-1 text-xs font-semibold bg-emerald-600 text-white px-2.5 py-1 rounded-full">
                  {p.ticker}
                  <span className="font-normal opacity-80 text-[10px]">{p.allocation}%</span>
                </span>
              ))}
              {data.dataAsOf && (
                <span className="ml-auto text-[10px] text-emerald-600 opacity-70 shrink-0">
                  {t('dataAsOf')} {new Date(data.dataAsOf).toLocaleString()}
                </span>
              )}
            </div>
          )}

          {/* ── 3-col analysis ────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <BarChart3 className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-blue-700">{t('analysisMacro')}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{data.macroAnalysis}</p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Target className="w-4 h-4 text-violet-600" />
                <span className="text-xs font-bold text-violet-700">{t('analysisTechnical')}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{data.technicalAnalysis}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Shield className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-700">{t('analysisFundamental')}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{data.fundamentalAnalysis}</p>
            </div>
          </div>

          {/* ── Portfolio ─────────────────────────────────────────────────── */}
          {data.portfolio.length > 0 && (
            <div className="mb-5">
              <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-violet-500" />
                {t('portfolioTitle')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.portfolio.map((item, i) => (
                  <PortfolioCard key={item.ticker} item={item} rank={i + 1} />
                ))}
              </div>
            </div>
          )}

          {/* ── Sector Allocation ─────────────────────────────────────────── */}
          {data.sectorAllocation.length > 0 && (
            <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-gray-500" />
                {t('sectorTitle')}
              </h2>
              <div className="space-y-3">
                {data.sectorAllocation.map(item => (
                  <SectorBar key={item.sector} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* ── Risk Events ───────────────────────────────────────────────── */}
          {data.riskEvents.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                {t('riskEventsTitle')}
              </h2>
              <div>
                {data.riskEvents.map((ev, i) => (
                  <RiskEventRow key={i} event={ev} />
                ))}
              </div>
            </div>
          )}

          {/* ── Disclaimer ────────────────────────────────────────────────── */}
          <p className="text-[10px] text-gray-400 mt-4 leading-relaxed">
            {t('disclaimer')}
          </p>
        </>
      )}
    </div>
  );
}
