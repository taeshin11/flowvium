'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw, Loader2 } from 'lucide-react';
import { Treemap, ResponsiveContainer } from 'recharts';
import { Link } from '@/i18n/routing';
import type { HeatmapData, HeatmapStock, HeatmapSector } from '@/app/api/market-heatmap/route';
// module-level sector bounds cache — populated during Treemap render, read by SVG overlay
const _sectorBoundsCache = new Map<string, {x:number;y:number;w:number;h:number;color:string}>();


// ── Color scale: green for positive, red for negative, gray for neutral/null
function pctColor(pct: number | null): string {
  if (pct == null) return '#4a5568';
  if (pct >= 3)    return '#047857';
  if (pct >= 1.5)  return '#059669';
  if (pct >= 0.5)  return '#10b981';
  if (pct >= 0)    return '#166534';  // was #14532d — slightly brighter for contrast
  if (pct > -0.5)  return '#4c1d1d';  // was #3f1d1d — slightly brighter
  if (pct > -1.5)  return '#ef4444';
  if (pct > -3)    return '#dc2626';
  return '#991b1b';
}

function textColor(pct: number | null): string {
  return pct == null || Math.abs(pct) < 0.3 ? '#94a3b8' : '#fff';
}

// ── Recharts Treemap content — one box per stock
interface BoxProps {
  x?: number; y?: number; width?: number; height?: number;
  ticker?: string; changePct?: number | null; name?: string; fullName?: string;
}
function StockBox(props: BoxProps) {
  const { x = 0, y = 0, width = 0, height = 0, ticker, changePct, fullName } = props;
  if (width < 1 || height < 1) return null;
  const bg = pctColor(changePct ?? null);
  const tc = textColor(changePct ?? null);
  const pctStr = changePct != null
    ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%`
    : '-';

  // Display: prefer fullName (company name) over ticker for non-US / numeric tickers
  const isNumericTicker = ticker != null && /^\d+$/.test(ticker);
  const displayLabel = isNumericTicker && fullName ? fullName : (ticker ?? '');
  // Short version for large labels — 16 chars before truncating (was 12)
  const shortLabel = displayLabel.length > 16 ? displayLabel.slice(0, 14) + '…' : displayLabel;

  const tickerFont = Math.min(Math.max(width / 5, 9), 32);
  const pctFont = Math.min(Math.max(width / 7, 8), 20);
  const showText = width > 22 && height > 14;
  const showPct = width > 36 && height > 28;
  const showCompany = width > 85 && height > 60 && fullName && !isNumericTicker;

  // SVG text-shadow via paint-order (stroke behind fill) for readability
  const textProps = { paintOrder: 'stroke' as const, stroke: bg, strokeWidth: 3, strokeLinejoin: 'round' as const };

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={bg} stroke="#0f172a" strokeWidth={1.5} rx={1} />
      {showText && (
        <text x={x + width / 2} y={y + height / 2 + (showPct ? -4 : 4)}
              textAnchor="middle" fill={tc} fontSize={tickerFont} fontWeight={700} {...textProps}>
          {shortLabel}
        </text>
      )}
      {showPct && (
        <text x={x + width / 2} y={y + height / 2 + tickerFont / 2 + 4}
              textAnchor="middle" fill={tc} fontSize={pctFont} fontWeight={500} {...textProps}>
          {pctStr}
        </text>
      )}
      {showCompany && (
        <text x={x + width / 2} y={y + height - 6}
              textAnchor="middle" fill={tc} fontSize={Math.min(pctFont * 0.7, 11)} opacity={0.75} {...textProps}>
          {fullName!.length > 20 ? fullName!.slice(0, 18) + '…' : fullName}
        </text>
      )}
    </g>
  );
}

// ── Finviz-style: depth=1 fills sector color as background "grout", depth=2 stocks are inset
interface SectorContentProps {
  x?: number; y?: number; width?: number; height?: number;
  depth?: number; name?: string; sectorColor?: string;
  ticker?: string; changePct?: number | null; fullName?: string;
}
function SectorTreemapContent(props: SectorContentProps) {
  const { x = 0, y = 0, width = 0, height = 0, depth, name, sectorColor, ticker, changePct, fullName } = props;
  if (width < 1 || height < 1) return null;

  if (depth === 1) {
    // Sector 배경 — 사용자 피드백: 'boundary 안 보임' (2026-05-24)
    // opacity 0.85 → 1.0 + 굵은 stroke 추가로 sector 경계 명확화
    const color = sectorColor ?? '#475569';
    _sectorBoundsCache.set(name ?? '', { x, y, w: width, h: height, color });
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={color} opacity={1.0} />
        {/* Sector border — 검은 외곽선 3px + sector color 자체로 시각적 분리 */}
        <rect x={x} y={y} width={width} height={height} fill="none" stroke="#000" strokeWidth={3} />
      </g>
    );
  }

  if (depth === 2) {
    // GAP 2 → 6: sector 색 grout 6px 노출 (이전 2px 은 거의 안 보임)
    const GAP = 6;
    return <StockBox x={x + GAP} y={y + GAP} width={width - GAP * 2} height={height - GAP * 2}
                     ticker={ticker} changePct={changePct} fullName={fullName} />;
  }

  return null;
}

// ── Sector block: internal treemap of its constituent stocks
function SectorBlock({ sector }: { sector: HeatmapSector }) {
  const t = useTranslations('heatmap');
  const avgColor = pctColor(sector.avgChangePct);
  const treeData = sector.stocks.map(s => ({
    name: s.ticker,
    size: s.marketCap,
    ticker: s.ticker,
    changePct: s.changePct,
    fullName: s.name,
  }));

  return (
    <div
      className="cf-card relative overflow-hidden"
      style={{
        backgroundColor: '#0f172a',
        borderColor: sector.color,
        borderWidth: '1px',
        borderStyle: 'solid',
      }}
    >
      {/* Sector color band — 카드 상단 전체 너비 (4px) */}
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ backgroundColor: sector.color }}
      />
      <div className="p-3 pt-3.5">
        <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-7 rounded" style={{ backgroundColor: sector.color }} />
            <div>
              <h3 className="text-base font-extrabold text-white tracking-tight leading-tight">{sector.sector}</h3>
              <span className="text-[10px] text-slate-500 font-mono">{sector.stocks.length}{t('stockUnit')}</span>
            </div>
          </div>
          {sector.avgChangePct != null && (
            <span
              className="text-sm font-bold px-2.5 py-1 rounded font-mono"
              style={{ backgroundColor: avgColor + '40', color: sector.avgChangePct >= 0 ? '#10b981' : '#ef4444' }}
            >
              {sector.avgChangePct > 0 ? '+' : ''}{sector.avgChangePct.toFixed(2)}%
            </span>
          )}
        </div>
        <div style={{ height: Math.max(180, Math.min(420, 80 + sector.stocks.length * 22)) }}>
          <ResponsiveContainer>
            <Treemap
              data={treeData}
              dataKey="size"
              aspectRatio={1.4}
              stroke="#0f172a"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              content={<StockBox /> as any}
              animationDuration={400}
            />
          </ResponsiveContainer>
        </div>
      </div>
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

const COUNTRY_FLAGS: Record<string, string> = {
  US: '🇺🇸', KR: '🇰🇷', JP: '🇯🇵', CN: '🇨🇳', EU: '🇪🇺', IN: '🇮🇳', TW: '🇹🇼',
};
const COUNTRY_IDS = ['US', 'KR', 'JP', 'CN', 'EU', 'IN', 'TW'] as const;

export default function HeatmapPage() {
  const t = useTranslations('heatmap');
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

      {/* Treemap view */}
      {viewMode === 'overview' ? (
        <div className="cf-card p-3" style={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-sm font-bold text-white">{t('totalMarket', { count: data.totalStocks })}</span>
            <span className="text-[10px] text-slate-500">섹터 경계선 색상 = 섹터 구분</span>
          </div>
          {/* Clear sector bounds cache before each render so overlay reads fresh data */}
          {(() => { _sectorBoundsCache.clear(); return null; })()}
          <div style={{ position: 'relative', height: Math.min(650, Math.max(460, data.totalStocks * 2.5)) }}>
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={data.sectors.map(s => ({
                  name: s.sector,
                  size: s.totalMarketCap,
                  sectorColor: s.color,
                  children: s.stocks.map(st => ({
                    name: st.ticker,
                    size: st.marketCap,
                    ticker: st.ticker,
                    changePct: st.changePct,
                    fullName: st.name,
                    sectorColor: s.color,
                  })),
                }))}
                dataKey="size"
                aspectRatio={1.6}
                stroke="#0f172a"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                content={<SectorTreemapContent /> as any}
                animationDuration={300}
              />
            </ResponsiveContainer>
            {/* Sector label overlay — drawn after Treemap so labels appear on top */}
            <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              {Array.from(_sectorBoundsCache.entries()).map(([sName, b]) =>
                b.w > 70 && b.h > 20 ? (
                  <g key={sName}>
                    <text x={b.x + 6} y={b.y + 14} fill="rgba(0,0,0,0.6)"
                          fontSize={11} fontWeight={800} style={{ userSelect: 'none' }}>
                      {sName.toUpperCase()}
                    </text>
                    <text x={b.x + 5} y={b.y + 13} fill="white"
                          fontSize={11} fontWeight={800} style={{ userSelect: 'none' }}>
                      {sName.toUpperCase()}
                    </text>
                  </g>
                ) : null
              )}
            </svg>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.sectors.map(s => <SectorBlock key={s.sector} sector={s} />)}
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
