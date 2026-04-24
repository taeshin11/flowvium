'use client';

import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { Treemap, ResponsiveContainer } from 'recharts';
import { Link } from '@/i18n/routing';
import type { HeatmapData, HeatmapStock, HeatmapSector } from '@/app/api/market-heatmap/route';

// ── Color scale: green for positive, red for negative, gray for neutral/null
function pctColor(pct: number | null): string {
  if (pct == null) return '#334155';
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
  ticker?: string; changePct?: number | null; name?: string;
}
function StockBox(props: BoxProps) {
  const { x = 0, y = 0, width = 0, height = 0, ticker, changePct, name } = props;
  if (width < 1 || height < 1) return null;
  const bg = pctColor(changePct ?? null);
  const tc = textColor(changePct ?? null);
  const pctStr = changePct != null
    ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%`
    : '-';

  // Scale font size to box size
  const tickerFont = Math.min(Math.max(width / 5.5, 9), 32);
  const pctFont = Math.min(Math.max(width / 7.5, 8), 20);
  const showText = width > 28 && height > 18;
  const showPct = width > 42 && height > 34;
  const showName = width > 85 && height > 60;

  // SVG text-shadow via paint-order (stroke behind fill) for readability
  const textProps = { paintOrder: 'stroke' as const, stroke: bg, strokeWidth: 3, strokeLinejoin: 'round' as const };

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={bg} stroke="#0f172a" strokeWidth={1.5} rx={1} />
      {showText && ticker && (
        <text x={x + width / 2} y={y + height / 2 + (showPct ? -4 : 4)}
              textAnchor="middle" fill={tc} fontSize={tickerFont} fontWeight={700} {...textProps}>
          {ticker}
        </text>
      )}
      {showPct && (
        <text x={x + width / 2} y={y + height / 2 + tickerFont / 2 + 4}
              textAnchor="middle" fill={tc} fontSize={pctFont} fontWeight={500} {...textProps}>
          {pctStr}
        </text>
      )}
      {showName && name && (
        <text x={x + width / 2} y={y + height - 6}
              textAnchor="middle" fill={tc} fontSize={Math.min(pctFont * 0.7, 11)} opacity={0.75} {...textProps}>
          {name.length > 20 ? name.slice(0, 18) + '…' : name}
        </text>
      )}
    </g>
  );
}

// ── Sector block: internal treemap of its constituent stocks
function SectorBlock({ sector }: { sector: HeatmapSector }) {
  const avgColor = pctColor(sector.avgChangePct);
  const treeData = sector.stocks.map(s => ({
    name: s.ticker,
    size: s.marketCap,
    ticker: s.ticker,
    changePct: s.changePct,
    fullName: s.name,
  }));

  return (
    <div className="cf-card p-3" style={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full" style={{ backgroundColor: sector.color }} />
          <h3 className="text-sm font-bold text-white">{sector.sector}</h3>
          <span className="text-[10px] text-slate-500">({sector.stocks.length}종목)</span>
        </div>
        {sector.avgChangePct != null && (
          <span
            className="text-xs font-bold px-2 py-0.5 rounded"
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

const COUNTRIES = [
  { id: 'US', flag: '🇺🇸', label: 'S&P 500' },
  { id: 'KR', flag: '🇰🇷', label: '한국' },
  { id: 'JP', flag: '🇯🇵', label: '일본' },
  { id: 'CN', flag: '🇨🇳', label: '중국' },
  { id: 'EU', flag: '🇪🇺', label: '유럽' },
  { id: 'IN', flag: '🇮🇳', label: '인도' },
  { id: 'TW', flag: '🇹🇼', label: '대만' },
];

export default function HeatmapPage() {
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [country, setCountry] = useState<string>('US');
  const [viewMode, setViewMode] = useState<'sectors' | 'overview'>('sectors');

  const load = async (force = false, ctry = country, signal?: AbortSignal) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`/api/market-heatmap?country=${ctry}`, signal ? { signal } : undefined);
      const json = await res.json();
      if (signal?.aborted) return;
      setData(json);
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
        <span>시장 데이터 수신 중...</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-cf-text-secondary">
        데이터를 불러올 수 없습니다
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cf-text-primary">시장 히트맵</h1>
          <p className="text-sm text-cf-text-secondary mt-1">
            박스 크기 = 시가총액 · 색상 = 등락률 · {data?.totalStocks ?? 0}개 종목
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-green-500">▲ {stats.up}종목</span>
          <span className="text-xs text-red-500">▼ {stats.down}종목</span>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            갱신
          </button>
        </div>
      </div>

      {/* Country tabs + view mode toggle */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-1 overflow-x-auto pb-1 flex-1">
          {COUNTRIES.map(c => (
            <button
              key={c.id}
              onClick={() => setCountry(c.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0
                ${country === c.id ? 'bg-cf-accent text-white shadow-sm' : 'bg-white/5 text-cf-text-secondary hover:bg-white/10'}`}
            >
              <span className="text-base">{c.flag}</span>
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={() => setViewMode('sectors')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
              ${viewMode === 'sectors' ? 'bg-white/15 text-white' : 'bg-white/5 text-cf-text-secondary hover:bg-white/10'}`}
          >
            섹터별
          </button>
          <button
            onClick={() => setViewMode('overview')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
              ${viewMode === 'overview' ? 'bg-white/15 text-white' : 'bg-white/5 text-cf-text-secondary hover:bg-white/10'}`}
          >
            전체보기
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
        <span>색상 스펙트럼:</span>
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
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="text-sm font-bold text-white">전체 시장 ({data.totalStocks}종목)</span>
            <div className="flex gap-2 flex-wrap">
              {data.sectors.map(s => (
                <span key={s.sector} className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                  {s.sector}
                </span>
              ))}
            </div>
          </div>
          <div style={{ height: Math.min(700, Math.max(400, data.totalStocks * 3.2)) }}>
            <ResponsiveContainer>
              <Treemap
                data={data.sectors.flatMap(s =>
                  s.stocks.map(st => ({
                    name: st.ticker,
                    size: st.marketCap,
                    ticker: st.ticker,
                    changePct: st.changePct,
                    fullName: st.name,
                  }))
                )}
                dataKey="size"
                aspectRatio={1.6}
                stroke="#0f172a"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                content={<StockBox /> as any}
                animationDuration={300}
              />
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.sectors.map(s => <SectorBlock key={s.sector} sector={s} />)}
        </div>
      )}

      <p className="text-[10px] text-cf-text-secondary/40 mt-4">
        출처: {data.source}
        {data.dataDate ? ` · ${data.dataDate} 세션` : ''}
        {' · 15분 캐시'}
      </p>
    </div>
  );
}
