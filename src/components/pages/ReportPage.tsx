'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import Sparkline from '@/components/Sparkline';
import dynamic from 'next/dynamic';
const YieldCurveCard = dynamic(() => import('@/components/YieldCurveCard'), { ssr: false });
const VolatilityCard = dynamic(() => import('@/components/VolatilityCard'), { ssr: false });

type Timeframe = '1w' | '4w' | '13w';

interface Section {
  title: string;
  bullets: string[];
}

interface BriefData {
  generatedAt: string;
  timeframe: Timeframe;
  market: Section;
  capital: Section;
  company: Section;
  signals: Section;
  outlook: string;
  source: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

// ── KPI strip types ──────────────────────────────────────────────────────────
interface KpiState<T> {
  loading: boolean;
  error: boolean;
  value: T | null;
}
type SectionKey = 'market' | 'capital' | 'company' | 'signals';

type Tr = (k: string, vals?: Record<string, string | number | Date>) => string;

function humanAge(ms: number, t: Tr): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return t('ageJustNow');
  const m = Math.floor(s / 60);
  if (m < 60) return t('ageMin', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('ageHour', { n: h });
  const d = Math.floor(h / 24);
  return t('ageDay', { n: d });
}

function freshnessDot(ms: number): string {
  if (ms < 10 * 60 * 1000) return 'bg-emerald-500';
  if (ms < 60 * 60 * 1000) return 'bg-amber-400';
  return 'bg-gray-400';
}

function sourceBadge(src: string | undefined): { label: string; cls: string } {
  const s = (src || '').toLowerCase();
  if (s.includes('70b')) return { label: 'GROQ 70b', cls: 'bg-violet-100 text-violet-700 border-violet-200' };
  if (s.includes('8b')) return { label: 'GROQ 8b', cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' };
  if (s.includes('gemini')) return { label: 'Gemini', cls: 'bg-blue-100 text-blue-700 border-blue-200' };
  if (s.includes('exaone') || s.includes('vllm')) return { label: 'EXAONE', cls: 'bg-teal-100 text-teal-700 border-teal-200' };
  if (s.includes('fallback') || s.includes('data')) return { label: 'data', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  return { label: src || 'AI', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
}

function fgColor(score: number): string {
  if (score > 70) return 'bg-red-50 text-red-700 border-red-200';
  if (score > 55) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (score >= 45) return 'bg-gray-50 text-gray-700 border-gray-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

function riskPill(level: 'low' | 'medium' | 'high' | undefined, t: Tr): { label: string; cls: string } | null {
  if (!level) return null;
  if (level === 'high') return { label: t('riskHigh'), cls: 'bg-red-100 text-red-700 border-red-200' };
  if (level === 'low') return { label: t('riskLow'), cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  return { label: t('riskMedium'), cls: 'bg-amber-100 text-amber-700 border-amber-200' };
}

export default function ReportPage() {
  const t = useTranslations('report');
  const locale = useLocale();

  const TF_LABELS: Record<Timeframe, string> = {
    '1w': t('week1'),
    '4w': t('week4'),
    '13w': t('week13'),
  };

  const SECTION_CONFIG: Array<{ key: SectionKey; label: string; icon: string; color: string; href: string }> = [
    { key: 'market',  label: t('sectionMarket'),  icon: '📊', color: 'bg-blue-50 border-blue-200',       href: `/${locale}/heatmap` },
    { key: 'capital', label: t('sectionCapital'), icon: '💰', color: 'bg-emerald-50 border-emerald-200', href: `/${locale}/intelligence?tab=capital` },
    { key: 'company', label: t('sectionCompany'), icon: '🏢', color: 'bg-violet-50 border-violet-200',   href: `/${locale}/signals` },
    { key: 'signals', label: t('sectionSignals'), icon: '📡', color: 'bg-amber-50 border-amber-200',     href: `/${locale}/insider` },
  ];

  const [tf, setTf] = useState<Timeframe>('1w');
  const [data, setData] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [nowTick, setNowTick] = useState<number>(Date.now());

  // KPI strip state (each pill fails independently)
  const [fg,     setFg]     = useState<KpiState<{ score: number }>>({ loading: true, error: false, value: null });
  const [spy,    setSpy]    = useState<KpiState<{ ret1w: number }>>({ loading: true, error: false, value: null });
  const [curve,  setCurve]  = useState<KpiState<{ spread: number; inverted: boolean }>>({ loading: true, error: false, value: null });
  const [vix,    setVix]    = useState<KpiState<{ ret1w: number; level: number | null }>>({ loading: true, error: false, value: null });
  const [fomc,   setFomc]   = useState<KpiState<{ label: string; probCut: number }>>({ loading: true, error: false, value: null });
  // Sparkline data — 30일 종가. Null-safe, 실패해도 pill 자체엔 영향 없음.
  const [spySpark, setSpySpark] = useState<number[] | null>(null);
  const [vixSpark, setVixSpark] = useState<number[] | null>(null);

  const fetchBrief = useCallback(async (timeframe: Timeframe) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/daily-brief?tf=${timeframe}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setExpanded({ market: true, capital: true, company: true, signals: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  // KPI parallel fetcher — each pill fails independently
  const fetchKpis = useCallback(async () => {
    setFg({ loading: true, error: false, value: null });
    setSpy({ loading: true, error: false, value: null });
    setCurve({ loading: true, error: false, value: null });
    setVix({ loading: true, error: false, value: null });
    setFomc({ loading: true, error: false, value: null });

    const pFg = fetch('/api/fear-greed').then(r => r.json()).then(j => {
      const us = Array.isArray(j?.byCountry) ? j.byCountry.find((x: { id?: string }) => x?.id === 'us') : null;
      const score = us?.score;
      if (typeof score !== 'number') throw new Error('no us score');
      setFg({ loading: false, error: false, value: { score } });
    }).catch(() => setFg({ loading: false, error: true, value: null }));

    const pCap = fetch('/api/capital-flows').then(r => r.json()).then(j => {
      const assets: Array<{ ticker?: string; ret1w?: number }> = Array.isArray(j?.assets) ? j.assets : [];
      const spyRow = assets.find(a => a?.ticker === 'SPY');
      if (!spyRow || typeof spyRow.ret1w !== 'number') {
        setSpy({ loading: false, error: true, value: null });
      } else {
        setSpy({ loading: false, error: false, value: { ret1w: spyRow.ret1w } });
      }
      // VIX — capital-flows doesn't list VIX directly, try VIXY/VXX/^VIX
      const vixRow = assets.find(a => a?.ticker === 'VIXY' || a?.ticker === 'VXX' || a?.ticker === '^VIX');
      if (!vixRow || typeof vixRow.ret1w !== 'number') {
        setVix({ loading: false, error: true, value: null });
      } else {
        setVix({ loading: false, error: false, value: { ret1w: vixRow.ret1w, level: null } });
      }
    }).catch(() => {
      setSpy({ loading: false, error: true, value: null });
      setVix({ loading: false, error: true, value: null });
    });

    const pMacro = fetch('/api/macro-indicators').then(r => r.json()).then(j => {
      const spread = j?.yieldCurve?.spread10y2y;
      if (typeof spread !== 'number') throw new Error('no spread');
      setCurve({ loading: false, error: false, value: { spread, inverted: !!j.yieldCurve?.inverted } });
    }).catch(() => setCurve({ loading: false, error: true, value: null }));

    const pFed = fetch('/api/fedwatch').then(r => r.json()).then(j => {
      const m = Array.isArray(j?.meetings) ? j.meetings[0] : null;
      if (!m) throw new Error('no meeting');
      const probCut = (m.probCut25 ?? 0) + (m.probCut50 ?? 0) + (m.probCut75 ?? 0);
      setFomc({ loading: false, error: false, value: { label: m.label ?? m.date ?? '?', probCut } });
    }).catch(() => setFomc({ loading: false, error: true, value: null }));

    // 30d sparklines — independent, non-blocking. 실패 시 해당 pill 만 sparkline 미표시.
    const fetchSpark = async (ticker: string): Promise<number[] | null> => {
      try {
        const r = await fetch(`/api/price-history?ticker=${encodeURIComponent(ticker)}&days=30`);
        const j = await r.json();
        const pts: Array<{ close?: number }> = Array.isArray(j?.points) ? j.points : [];
        const vals = pts.map(p => p?.close).filter((v): v is number => typeof v === 'number');
        return vals.length >= 2 ? vals : null;
      } catch { return null; }
    };
    const pSpark = fetchSpark('SPY').then(v => { if (v) setSpySpark(v); });
    // Volatility endpoint — VIX current level + regime
    const pVol = fetch('/api/volatility').then(r => r.json()).then(j => {
      const level: number | null = typeof j?.vix === 'number' ? j.vix : null;
      setVix(prev => ({
        loading: false, error: level == null,
        value: level != null ? { ret1w: prev.value?.ret1w ?? 0, level } : null,
      }));
    }).catch(() => { /* keep existing state */ });

    const pVixSpark = fetchSpark('^VIX').then(v => {
      if (!v) return;
      setVixSpark(v);
      if (v.length >= 6) {
        const last = v[v.length - 1];
        const wkAgo = v[v.length - 6];
        const ret1w = ((last - wkAgo) / wkAgo) * 100;
        setVix(prev => ({
          loading: false, error: prev.error && prev.value == null,
          value: prev.value ? { ...prev.value, ret1w } : { ret1w, level: null },
        }));
      }
    });

    await Promise.allSettled([pFg, pCap, pMacro, pFed, pSpark, pVixSpark, pVol]);
  }, []);

  useEffect(() => {
    fetchBrief(tf);
    fetchKpis();
  }, [tf, fetchBrief, fetchKpis]);

  // Tick every 30s so "age" text auto-refreshes
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const toggleSection = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const ageMs = data ? Math.max(0, nowTick - new Date(data.generatedAt).getTime()) : 0;
  const srcBadge = data ? sourceBadge(data.source) : null;
  const risk = data ? riskPill(data.riskLevel, t) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">{t('title')}</h1>
            <p className="text-xs text-gray-500 mt-0.5">{t('subtitle')}</p>
          </div>
          <button
            onClick={() => { fetchBrief(tf); fetchKpis(); }}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-400 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40 bg-white"
          >
            <span className={loading ? 'animate-spin inline-block' : ''}>↻</span>
            {t('refresh')}
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Timeframe selector */}
        <div className="flex gap-2 mb-6">
          {(Object.keys(TF_LABELS) as Timeframe[]).map(key => (
            <button
              key={key}
              onClick={() => setTf(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tf === key
                  ? 'bg-violet-600 text-white shadow-md'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-violet-300 hover:text-violet-600'
              }`}
            >
              {TF_LABELS[key]}
            </button>
          ))}
        </div>

        {/* KPI strip */}
        <div className="flex flex-wrap gap-2 mb-6">
          {/* F&G */}
          <Pill
            loading={fg.loading}
            error={fg.error}
            label={t('kpiFg')}
            body={fg.value ? `${fg.value.score}` : '—'}
            cls={fg.value ? fgColor(fg.value.score) : ''}
          />
          {/* SPY — with 30d sparkline */}
          <Pill
            loading={spy.loading}
            error={spy.error}
            label="SPY 1w"
            body={spy.value ? `${spy.value.ret1w >= 0 ? '+' : ''}${spy.value.ret1w.toFixed(2)}%` : '—'}
            cls={spy.value ? (spy.value.ret1w >= 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200') : ''}
            sparkline={spySpark}
          />
          {/* 10Y-2Y */}
          <Pill
            loading={curve.loading}
            error={curve.error}
            label="10Y-2Y"
            body={curve.value ? `${(curve.value.spread * 100).toFixed(0)}bp` : '—'}
            cls={curve.value ? (curve.value.inverted ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-700 border-gray-200') : ''}
          />
          {/* VIX — level from volatility endpoint, change from price-history sparkline */}
          <Pill
            loading={vix.loading}
            error={vix.error}
            label="VIX"
            body={vix.value?.level != null
              ? `${vix.value.level.toFixed(1)}${vix.value.ret1w ? ` (${vix.value.ret1w >= 0 ? '+' : ''}${vix.value.ret1w.toFixed(1)}%)` : ''}`
              : vix.value?.ret1w != null ? `${vix.value.ret1w >= 0 ? '+' : ''}${vix.value.ret1w.toFixed(1)}%` : '—'}
            cls={vix.value?.level != null
              ? (vix.value.level > 25 ? 'bg-red-50 text-red-700 border-red-200' : vix.value.level > 15 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200')
              : vix.value ? (vix.value.ret1w >= 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-gray-50 text-gray-700 border-gray-200') : ''}
            sparkline={vixSpark}
          />
          {/* FOMC */}
          <Pill
            loading={fomc.loading}
            error={fomc.error}
            label={`FOMC ${fomc.value?.label ?? ''}`}
            body={fomc.value ? t('kpiCutProb', { pct: fomc.value.probCut.toFixed(0) }) : '—'}
            cls={fomc.value ? 'bg-violet-50 text-violet-700 border-violet-200' : ''}
          />
        </div>

        {/* Yield Curve + Volatility (side-by-side on large screens) */}
        <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <YieldCurveCard />
          <VolatilityCard />
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-10 h-10 border-2 border-violet-200 border-t-violet-500 rounded-full animate-spin" />
            <p className="text-sm text-gray-500">{t('loading')}</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-red-600 text-sm">{error}</p>
            <button
              onClick={() => fetchBrief(tf)}
              className="mt-3 text-xs text-red-500 hover:text-red-700 underline"
            >
              {t('retry')}
            </button>
          </div>
        )}

        {/* Content */}
        {!loading && data && (
          <>
            {/* Meta row */}
            <div className="flex items-center flex-wrap gap-2 mb-6 text-xs text-gray-500">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border ${srcBadge?.cls ?? ''}`}>
                <span className="font-medium">{srcBadge?.label}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${freshnessDot(ageMs)}`} />
                <span>{humanAge(ageMs, t)}</span>
              </span>
              <span className="text-gray-300">·</span>
              <span>{new Date(data.generatedAt).toLocaleString()}</span>
              {risk && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${risk.cls}`}>
                    {t('riskLabel')}: {risk.label}
                  </span>
                </>
              )}
            </div>

            {/* Section grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {SECTION_CONFIG.map(({ key, label, icon, color, href }) => {
                const section = data[key] as Section | undefined;
                if (!section) return null;
                const isOpen = expanded[key];
                return (
                  <div
                    key={key}
                    className={`rounded-xl border ${color} p-5 transition-all hover:shadow-md`}
                  >
                    <div
                      className="flex items-center justify-between mb-3 cursor-pointer"
                      onClick={() => toggleSection(key)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{icon}</span>
                        <span className="text-sm font-semibold text-gray-800">{label}</span>
                      </div>
                      <span className="text-gray-400 text-sm transition-transform inline-block" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
                    </div>
                    <p className="text-sm text-gray-600 font-medium mb-2 cursor-pointer" onClick={() => toggleSection(key)}>{section.title}</p>
                    {isOpen && section.bullets && section.bullets.length > 0 && (
                      <>
                        <ul className="space-y-2 mt-3 border-t border-gray-200 pt-3">
                          {section.bullets.map((b, i) => (
                            <li key={i} className="flex gap-2 text-sm text-gray-700">
                              <span className="text-gray-400 mt-0.5 shrink-0">•</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 pt-2 border-t border-gray-100">
                          <Link
                            href={href}
                            className="text-xs text-violet-600 hover:text-violet-800 hover:underline inline-flex items-center gap-1"
                          >
                            {t('viewDetails')} <span>→</span>
                          </Link>
                        </div>
                      </>
                    )}
                    {!isOpen && (
                      <p className="text-xs text-gray-400 mt-1 cursor-pointer" onClick={() => toggleSection(key)}>{t('collapse')}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Outlook bar */}
            {data.outlook && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">🔮</span>
                  <span className="text-sm font-semibold text-violet-700">{t('aiOutlook')}</span>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">{data.outlook}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Pill subcomponent ────────────────────────────────────────────────────────
function Pill({ loading, error, label, body, cls, sparkline }: { loading: boolean; error: boolean; label: string; body: string; cls: string; sparkline?: number[] | null }) {
  const base = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium';
  if (loading) {
    return (
      <span className={`${base} bg-gray-50 text-gray-400 border-gray-200`}>
        <span className="w-3 h-3 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin inline-block" />
        <span>{label}</span>
      </span>
    );
  }
  if (error) {
    return (
      <span className={`${base} bg-gray-50 text-gray-400 border-gray-200`}>
        <span className="opacity-60">{label}</span>
        <span className="font-semibold">—</span>
      </span>
    );
  }
  return (
    <span className={`${base} ${cls}`}>
      <span className="opacity-70">{label}</span>
      <span className="font-semibold">{body}</span>
      {sparkline && sparkline.length >= 2 && (
        <Sparkline values={sparkline} width={48} height={14} className="opacity-80 ml-0.5" />
      )}
    </span>
  );
}
