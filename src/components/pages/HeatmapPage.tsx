'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import type { HeatmapData, HeatmapSector, HeatmapStock } from '@/app/api/market-heatmap/route';

// ── Color scale: green for positive, red for negative, gray for neutral/null
function pctColor(pct: number | null): string {
  if (pct == null) return '#4a5568';
  if (pct >= 3)    return '#047857';
  if (pct >= 1.5)  return '#059669';
  if (pct >= 0.5)  return '#10b981';
  if (pct >= 0)    return '#166534';
  if (pct > -0.5)  return '#4c1d1d';
  if (pct > -1.5)  return '#ef4444';
  if (pct > -3)    return '#dc2626';
  return '#991b1b';
}

// ── 2026-06-12: Recharts 중첩 Treemap 이 200종목에서 세로 슬리버(라벨 0개 가시)로 붕괴
//    (사용자 "finviz 랑 똑같이 만들어봐. 지금 하나도 안 보인다") → squarified(Bruls) 직접 구현.
//    div 타일 + 자동 폰트 스케일 + 섹터 헤더 스트립 — Finviz 와 동일 구조.
interface Rect { x: number; y: number; w: number; h: number }
interface Sized { size: number }

function squarify<T extends Sized>(items: T[], rect: Rect): Array<{ item: T; x: number; y: number; w: number; h: number }> {
  const out: Array<{ item: T; x: number; y: number; w: number; h: number }> = [];
  const positive = items.filter(i => i.size > 0);
  const total = positive.reduce((s, i) => s + i.size, 0);
  if (total <= 0 || rect.w <= 1 || rect.h <= 1) return out;
  const scale = (rect.w * rect.h) / total;
  let { x, y, w, h } = rect;
  let row: T[] = [];

  const worstRatio = (candidate: T[], side: number): number => {
    if (!candidate.length || side <= 0) return Infinity;
    const areas = candidate.map(r => r.size * scale);
    const sum = areas.reduce((a, b) => a + b, 0);
    const mx = Math.max(...areas), mn = Math.min(...areas);
    if (sum <= 0 || mn <= 0) return Infinity;
    const s2 = sum * sum, side2 = side * side;
    return Math.max((side2 * mx) / s2, s2 / (side2 * mn));
  };

  const layoutRow = (r: T[]) => {
    const sum = r.reduce((a, it) => a + it.size * scale, 0);
    if (sum <= 0) return;
    if (w >= h) {
      // 세로 컬럼으로 배치 (왼쪽부터 채움)
      const colW = Math.min(sum / h, w);
      let cy = y;
      for (const it of r) { const ih = (it.size * scale) / colW; out.push({ item: it, x, y: cy, w: colW, h: ih }); cy += ih; }
      x += colW; w -= colW;
    } else {
      const rowH = Math.min(sum / w, h);
      let cx = x;
      for (const it of r) { const iw = (it.size * scale) / rowH; out.push({ item: it, x: cx, y, w: iw, h: rowH }); cx += iw; }
      y += rowH; h -= rowH;
    }
  };

  const sorted = [...positive].sort((a, b) => b.size - a.size);
  for (const it of sorted) {
    const side = Math.min(w, h);
    if (worstRatio([...row, it], side) <= worstRatio(row, side)) row.push(it);
    else { layoutRow(row); row = [it]; }
  }
  if (row.length) layoutRow(row);
  return out;
}

// ── 종목 타일 (div) — Finviz 식: 티커 볼드 + 등락% , 타일 크기에 폰트 자동 스케일
function StockTile({ s, x, y, w, h, onClick }: { s: HeatmapStock; x: number; y: number; w: number; h: number; onClick: (t: string) => void }) {
  const isNumeric = /^\d+$/.test(s.ticker);
  const label = isNumeric && s.name ? s.name : s.ticker;
  const short = label.length > 12 ? label.slice(0, 11) + '…' : label;
  const pctStr = s.changePct != null ? `${s.changePct > 0 ? '+' : ''}${s.changePct.toFixed(2)}%` : '-';
  // 폰트: 너비(글자수 비례)와 높이 모두에 맞춤
  const fontByW = (w - 6) / Math.max(short.length * 0.62, 1);
  const fontSize = Math.max(7, Math.min(fontByW, h * 0.32, 26));
  const showLabel = w >= 26 && h >= 14 && fontSize >= 7;
  const showPct = showLabel && h >= fontSize * 2.4 && w >= 34;
  return (
    <div
      onClick={() => onClick(s.ticker)}
      title={`${s.name ?? s.ticker} (${s.ticker}) ${pctStr}`}
      style={{
        position: 'absolute', left: x, top: y, width: Math.max(w - 1, 1), height: Math.max(h - 1, 1),
        backgroundColor: pctColor(s.changePct), outline: '1px solid rgba(15,23,42,0.9)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', cursor: 'pointer',
      }}
      className="hover:brightness-125 transition-[filter]"
    >
      {showLabel && (
        <span style={{ fontSize, lineHeight: 1.05, fontWeight: 800, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.55)', whiteSpace: 'nowrap' }}>
          {short}
        </span>
      )}
      {showPct && (
        <span style={{ fontSize: Math.max(7, fontSize * 0.72), lineHeight: 1.1, fontWeight: 600, color: 'rgba(255,255,255,0.92)', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
          {pctStr}
        </span>
      )}
    </div>
  );
}

// ── Finviz 트리맵: 섹터 squarify → 섹터 내부 종목 squarify + 섹터 헤더 스트립
function FinvizTreemap({ sectors, height, showSectorHeader = true }: { sectors: HeatmapSector[]; height: number; showSectorHeader?: boolean }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const measure = () => setWidth(wrapRef.current?.clientWidth ?? 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const layout = useMemo(() => {
    if (width < 10) return [];
    const secRects = squarify(
      sectors.map(s => ({ size: Math.max(s.totalMarketCap, 0.0001), sector: s })),
      { x: 0, y: 0, w: width, h: height },
    );
    return secRects.map(({ item, x, y, w, h }) => {
      const HEADER = showSectorHeader && h >= 52 && w >= 56 ? 15 : 0;
      const PAD = 1.5;
      const inner: Rect = { x: x + PAD, y: y + HEADER + PAD, w: w - PAD * 2, h: h - HEADER - PAD * 2 };
      const tiles = squarify(
        item.sector.stocks.map(st => ({ size: Math.max(st.marketCap, 0.0001), stock: st })),
        inner,
      );
      return { sector: item.sector, x, y, w, h, HEADER, tiles };
    });
  }, [sectors, width, height, showSectorHeader]);

  const go = (ticker: string) => {
    const t = /^\d{6}$/.test(ticker) ? `${ticker}.KS` : ticker;
    router.push(`/company/${t}`);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height, backgroundColor: '#0f172a' }}>
      {layout.map(({ sector, x, y, w, h, HEADER, tiles }) => (
        <div key={sector.sector}>
          {/* 섹터 경계 + 헤더 스트립 */}
          <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, outline: `1.5px solid ${sector.color}`, pointerEvents: 'none', zIndex: 2 }} />
          {HEADER > 0 && (
            <div style={{
              position: 'absolute', left: x, top: y, width: w, height: HEADER,
              backgroundColor: sector.color, color: '#fff', fontSize: 9.5, fontWeight: 800,
              padding: '1px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              textTransform: 'uppercase', letterSpacing: '0.02em', zIndex: 1,
            }}>
              {sector.sector}
              {sector.avgChangePct != null && (
                <span style={{ marginLeft: 5, fontWeight: 600, opacity: 0.9 }}>
                  {sector.avgChangePct > 0 ? '+' : ''}{sector.avgChangePct.toFixed(1)}%
                </span>
              )}
            </div>
          )}
          {tiles.map(({ item, x: tx, y: ty, w: tw, h: th }) => (
            <StockTile key={item.stock.ticker} s={item.stock} x={tx} y={ty} w={tw} h={th} onClick={go} />
          ))}
        </div>
      ))}
    </div>
  );
}

function IndexBar({ label, changePct, close }: { label: string; changePct: number | null; close: number | null }) {
  const isUp = (changePct ?? 0) >= 0;
  return (
    <div className="cf-card px-4 py-3 flex items-center justify-between gap-4">
      <div>
        <p className="text-xs text-cf-text-secondary">{label}</p>
        <p className="font-bold text-cf-text-primary">
          {close != null ? close.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
        </p>
      </div>
      <p className={`font-bold text-sm ${isUp ? 'text-green-500' : 'text-red-500'}`}>
        {changePct != null ? `${isUp ? '+' : ''}${changePct.toFixed(2)}%` : '-'}
      </p>
    </div>
  );
}

// 2026-06-12: 섹터명이 API 에서 한국어 고정 — 비-ko locale 은 영문 라벨 (금융 용어라 EN 공용)
const SECTOR_EN: Record<string, string> = {
  '반도체': 'Semiconductors', '소프트웨어': 'Software', '전자상거래': 'E-Commerce',
  '스트리밍': 'Streaming', 'EV·배터리': 'EV & Battery', '금융': 'Financials',
  '제약·바이오': 'Pharma & Biotech', '헬스케어': 'Healthcare', '소비재': 'Consumer',
  '에너지': 'Energy', '방산': 'Defense', '산업재': 'Industrials', '통신': 'Telecom',
  '암호화폐': 'Crypto', '유틸리티': 'Utilities', '소재': 'Materials',
};

const COUNTRY_FLAGS: Record<string, string> = {
  US: '🇺🇸', KR: '🇰🇷', JP: '🇯🇵', CN: '🇨🇳', EU: '🇪🇺', IN: '🇮🇳', TW: '🇹🇼',
};
const COUNTRY_IDS = ['US', 'KR', 'JP', 'CN', 'EU', 'IN', 'TW'] as const;

export default function HeatmapPage() {
  const t = useTranslations('heatmap');
  const locale = useLocale();
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [country, setCountry] = useState<string>('US');
  const [viewMode, setViewMode] = useState<'sectors' | 'overview'>('overview');

  const COUNTRY_LABELS: Record<string, string> = {
    US: 'S&P 500', KR: t('cKR'), JP: t('cJP'), CN: t('cCN'),
    EU: t('cEU'), IN: t('cIN'), TW: t('cTW'),
  };

  const load = async (force = false, ctry = country, signal?: AbortSignal) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`/api/market-heatmap?country=${ctry}`, signal ? { signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (signal?.aborted) return;
      setData(json);
    } catch {
      // abort is expected on cleanup; other errors leave previous data visible
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    load(false, country, controller.signal);
    const iv = setInterval(() => load(false, country, controller.signal), 15 * 60 * 1000);
    return () => {
      controller.abort();
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  const stats = useMemo(() => {
    if (!data) return { up: 0, down: 0, total: 0 };
    const all = data.sectors.flatMap(s => s.stocks);
    return {
      up: all.filter(s => (s.changePct ?? 0) > 0).length,
      down: all.filter(s => (s.changePct ?? 0) < 0).length,
      total: all.length,
    };
  }, [data]);

  // 비-ko locale 섹터명 영문화 (데이터 자체는 동일 — 라벨만)
  const sectorsView = useMemo(() => {
    if (!data) return [];
    return locale === 'ko' ? data.sectors : data.sectors.map(s => ({ ...s, sector: SECTOR_EN[s.sector] ?? s.sector }));
  }, [data, locale]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] gap-3 text-cf-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>{t('loading')}</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-cf-text-secondary">
        {t('error')}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cf-text-primary">{t('pageTitle')}</h1>
          <p className="text-sm text-cf-text-secondary mt-1">
            {t('pageDesc', { count: data?.totalStocks ?? 0 })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-green-500">{t('statsUp', { count: stats.up })}</span>
          <span className="text-xs text-red-500">{t('statsDown', { count: stats.down })}</span>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {t('refresh')}
          </button>
        </div>
      </div>

      {/* Country tabs + view mode toggle */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-1 overflow-x-auto pb-1 flex-1">
          {COUNTRY_IDS.map(id => (
            <button
              key={id}
              onClick={() => setCountry(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0
                ${country === id ? 'bg-cf-accent text-white shadow-sm' : 'bg-white/5 text-cf-text-secondary hover:bg-white/10'}`}
            >
              <span className="text-base">{COUNTRY_FLAGS[id]}</span>
              {COUNTRY_LABELS[id]}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={() => setViewMode('sectors')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
              ${viewMode === 'sectors' ? 'bg-white/15 text-white' : 'bg-white/5 text-cf-text-secondary hover:bg-white/10'}`}
          >
            {t('viewSectors')}
          </button>
          <button
            onClick={() => setViewMode('overview')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
              ${viewMode === 'overview' ? 'bg-white/15 text-white' : 'bg-white/5 text-cf-text-secondary hover:bg-white/10'}`}
          >
            {t('viewOverview')}
          </button>
        </div>
      </div>

      {/* Indices */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {data.indices.map(idx => (
          <IndexBar key={idx.symbol} label={idx.label} changePct={idx.changePct} close={idx.close} />
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mb-4 text-[10px] text-cf-text-secondary flex-wrap">
        <span>{t('colorSpectrum')}</span>
        {[-3, -1.5, -0.5, 0, 0.5, 1.5, 3].map(v => (
          <span key={v} className="inline-flex items-center gap-1">
            <span className="w-4 h-3 rounded-sm" style={{ backgroundColor: pctColor(v) }} />
            {v > 0 ? `+${v}%` : `${v}%`}
          </span>
        ))}
      </div>

      {/* Treemap view — squarified custom (Finviz-style) */}
      {viewMode === 'overview' ? (
        <div className="cf-card p-2 overflow-hidden" style={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}>
          <div className="flex items-center gap-3 mb-2 px-1">
            <span className="text-sm font-bold text-white">{t('totalMarket', { count: data.totalStocks })}</span>
          </div>
          <FinvizTreemap sectors={sectorsView} height={Math.min(720, Math.max(480, data.totalStocks * 3))} />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sectorsView.map(s => (
            <div key={s.sector} className="cf-card overflow-hidden" style={{ backgroundColor: '#0f172a', borderColor: s.color, borderWidth: 1 }}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-5 rounded" style={{ backgroundColor: s.color }} />
                  <h3 className="text-sm font-extrabold text-white">{s.sector}</h3>
                  <span className="text-[10px] text-slate-500 font-mono">{s.stocks.length}{t('stockUnit')}</span>
                </div>
                {s.avgChangePct != null && (
                  <span className="text-xs font-bold font-mono" style={{ color: s.avgChangePct >= 0 ? '#10b981' : '#ef4444' }}>
                    {s.avgChangePct > 0 ? '+' : ''}{s.avgChangePct.toFixed(2)}%
                  </span>
                )}
              </div>
              <div className="p-1">
                <FinvizTreemap sectors={[s]} height={Math.max(160, Math.min(380, 60 + s.stocks.length * 18))} showSectorHeader={false} />
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-cf-text-secondary/40 mt-4">
        {t('sourceBase', { source: data.source })}
        {data.dataDate ? ` · ${t('sourceDate', { date: data.dataDate })}` : ''}
        {` · ${t('sourceCache')}`}
      </p>
    </div>
  );
}
