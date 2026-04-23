import { logger, loggedRedisSet} from '@/lib/logger';
export const maxDuration = 60; // 200 tickers × batched Yahoo v8 fetch needs up to ~20s
/**
 * /api/market-heatmap?country=US|KR|JP|CN|EU|IN|TW
 *
 * TradingView-style treemap data per country. Uses iShares ETF holdings CSV
 * (public, no auth) for constituents + market cap weights, then Stooq for
 * live price changes (US only — non-US stocks use iShares intraday price).
 *
 * Redis cache: 15 minutes per country.
 * Redis-less fallback: module-level memory cache (10min TTL) — keeps warm
 * instance responses <50ms instead of 3+s upstream re-fetch every call.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { fetchYFHeatmapQuotes } from '@/lib/yahoo-finance';
import { fetchIShareHoldings, ISHARES_ETFS } from '@/lib/ishares-holdings';
import { SECTOR_COLORS } from '@/data/heatmap-stocks';
import { createMemoryCache } from '@/lib/memory-cache';

const CACHE_TTL = 15 * 60;
const MEMORY_CACHE = createMemoryCache<HeatmapData>('market-heatmap', 10 * 60_000);

const INDICES_BY_COUNTRY: Record<string, Array<{ symbol: string; label: string }>> = {
  US: [
    { symbol: 'SPY', label: 'S&P 500' },
    { symbol: 'QQQ', label: 'NASDAQ 100' },
    { symbol: 'IWM', label: 'Russell 2000' },
    { symbol: 'DIA', label: 'Dow Jones' },
  ],
  KR: [{ symbol: 'EWY', label: 'Korea (EWY)' }],
  JP: [{ symbol: 'EWJ', label: 'Japan (EWJ)' }],
  CN: [{ symbol: 'MCHI', label: 'China (MCHI)' }, { symbol: 'FXI', label: 'FXI' }],
  EU: [{ symbol: 'EZU', label: 'Eurozone (EZU)' }, { symbol: 'VGK', label: 'VGK' }],
  IN: [{ symbol: 'INDA', label: 'India (INDA)' }, { symbol: 'SMIN', label: 'SMIN' }],
  TW: [{ symbol: 'EWT', label: 'Taiwan (EWT)' }],
};

export interface HeatmapStock {
  ticker: string;
  name: string;
  sector: string;
  marketCap: number;
  changePct: number | null;
  close: number | null;
}

export interface HeatmapSector {
  sector: string;
  color: string;
  stocks: HeatmapStock[];
  totalMarketCap: number;
  avgChangePct: number | null;
}

export interface HeatmapIndex {
  symbol: string;
  label: string;
  changePct: number | null;
  close: number | null;
}

export interface HeatmapData {
  country: string;
  countryLabel: string;
  sectors: HeatmapSector[];
  indices: HeatmapIndex[];
  totalStocks: number;
  updatedAt: string;
  dataDate: string | null;
  source: string;
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const SUPPORTED = ['US', 'KR', 'JP', 'CN', 'EU', 'IN', 'TW'];

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rawCountry = (url.searchParams.get('country') ?? 'US').toUpperCase();
  const country = SUPPORTED.includes(rawCountry) ? rawCountry : 'US';
  const force = url.searchParams.get('refresh') === '1';
  const cfg = ISHARES_ETFS[country];
  const hour = new Date().toISOString().slice(0, 13);
  const cacheKey = `flowvium:heatmap:v6:${country}:${hour}`;  // v6: Yahoo v8 batched
  const redis = createRedis();

  if (!force) {
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return NextResponse.json({ ...(cached as object), cached: true });
      } catch { /* non-fatal */ }
    } else {
      const mem = MEMORY_CACHE.get(country);
      if (mem) return NextResponse.json({ ...mem, cached: true, cacheLayer: 'memory' });
    }
  }

  // 1. Fetch ETF constituents (includes market cap weights)
  const holdings = await fetchIShareHoldings(country);

  // Filter out tiny holdings — top stocks by market value, cap at 200
  const topHoldings = holdings
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, country === 'US' ? 200 : 80);

  // 2. Fetch Yahoo Finance v8 quotes for all tickers (stocks + indices in one burst).
  //    v8/chart endpoint works from Vercel and includes pre-market/post-market data.
  //    Non-US stock prices fall back to iShares EOD; only index ETFs use Yahoo for non-US.
  const indexConfigs = INDICES_BY_COUNTRY[country] ?? [];
  const yahooTickers = [
    ...(country === 'US' ? topHoldings.map(h => h.ticker) : []),
    ...indexConfigs.map(i => i.symbol),
  ];
  const yahooQuotes = await fetchYFHeatmapQuotes(Array.from(new Set(yahooTickers)));
  const quoteMap = new Map(yahooQuotes.map(q => [q.symbol, q]));

  // 3. Build HeatmapStock list
  const stocks: HeatmapStock[] = topHoldings.map(h => {
    const live = country === 'US' ? quoteMap.get(h.ticker) : null;
    return {
      ticker: h.ticker,
      name: h.name,
      sector: h.sector,
      marketCap: h.marketValue / 1e9,   // USD billions for display; treemap uses raw marketCap
      changePct: live?.changePct ?? null,
      close: live?.close ?? (h.price || null),
    };
  });

  // 4. Group by sector
  const bySector: Record<string, HeatmapStock[]> = {};
  for (const s of stocks) {
    if (!bySector[s.sector]) bySector[s.sector] = [];
    bySector[s.sector].push(s);
  }

  const sectors: HeatmapSector[] = Object.entries(bySector).map(([name, ss]) => {
    const valid = ss.filter(x => x.changePct != null);
    const totalMC = ss.reduce((s, x) => s + x.marketCap, 0);
    const weighted = valid.length
      ? valid.reduce((s, x) => s + (x.changePct! * x.marketCap), 0) / valid.reduce((s, x) => s + x.marketCap, 0)
      : null;
    return {
      sector: name,
      color: SECTOR_COLORS[name] ?? '#64748b',
      stocks: ss.sort((a, b) => b.marketCap - a.marketCap),
      totalMarketCap: totalMC,
      avgChangePct: weighted != null ? parseFloat(weighted.toFixed(2)) : null,
    };
  }).sort((a, b) => b.totalMarketCap - a.totalMarketCap);

  // 5. Build indices from already-fetched quoteMap
  const indices: HeatmapIndex[] = indexConfigs.map(i => {
    const q = quoteMap.get(i.symbol);
    return { symbol: i.symbol, label: i.label, changePct: q?.changePct ?? null, close: q?.close ?? null };
  });

  const dataDate = new Date().toISOString().slice(0, 10);
  const data: HeatmapData = {
    country,
    countryLabel: cfg?.countryLabel ?? country,
    sectors,
    indices,
    totalStocks: stocks.length,
    updatedAt: new Date().toISOString(),
    dataDate,
    source: country === 'US'
      ? 'iShares IVV (구성) + Yahoo Finance v8 (시세, 프리장 포함)'
      : `iShares ${cfg?.etfTicker} 보유종목 (EOD)`,
  };

  if (redis) {
    const t0 = Date.now();
    try {
      logger.info('market-heatmap', 'save_start', { key: cacheKey, ttl: CACHE_TTL });
      await loggedRedisSet(redis, 'api.market-heatmap', cacheKey, data, { ex: CACHE_TTL });
      logger.info('market-heatmap', 'save_ok', { key: cacheKey, durationMs: Date.now() - t0 });
    } catch (err) {
      logger.error('market-heatmap', 'save_failed', { key: cacheKey, error: err });
    }
  } else if (stocks.length > 0) {
    // Only cache non-empty to avoid pinning a failed upstream fetch
    MEMORY_CACHE.set(country, data);
  }

  return NextResponse.json({ ...data, cached: false });
}
