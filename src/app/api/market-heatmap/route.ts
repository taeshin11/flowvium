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
import { fetchCNBCQuotes } from '@/lib/yahoo-finance';
import { fetchStooqQuotes, fetchStooqNonUS } from '@/lib/stooq';
import { fetchIShareHoldings, ISHARES_ETFS } from '@/lib/ishares-holdings';
import { SECTOR_COLORS } from '@/data/heatmap-stocks';
import { createMemoryCache } from '@/lib/memory-cache';

const CACHE_TTL = 15 * 60;
const MEMORY_CACHE = createMemoryCache<HeatmapData>('market-heatmap', 10 * 60_000);
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=60' };

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
  const cacheKey = `flowvium:heatmap:v11:${country}:${hour}`; // v11: Stooq for non-US (Yahoo rate-limited)
  const redis = createRedis();

  if (!force) {
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
      } catch { /* non-fatal */ }
    } else {
      const mem = MEMORY_CACHE.get(country);
      if (mem) return NextResponse.json({ ...mem, cached: true, cacheLayer: 'memory' }, { headers: CDN_HEADERS });
    }
  }

  // 1. Fetch ETF constituents (includes market cap weights)
  const holdings = await fetchIShareHoldings(country);

  // Filter out tiny holdings — top stocks by market value, cap at 200
  const topHoldings = holdings
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, country === 'US' ? 200 : 80);

  // 2. Fetch quotes — hybrid approach:
  //    US stocks: Stooq batch (35/req, ~6 requests total, reliable from Vercel)
  //    Indices (SPY/QQQ/EWY etc.): Yahoo v8 (4 requests, correct prev-close day-change)
  //    Non-US stocks: iShares EOD price (no live source available)
  const indexConfigs = INDICES_BY_COUNTRY[country] ?? [];

  // Stooq for US equity constituents
  const stooqMap = new Map<string, { changePct: number | null; close: number | null }>();
  if (country === 'US') {
    const stooqTickers = topHoldings.map(h => h.ticker.replace('.', '-'));
    const stooqQuotes = await fetchStooqQuotes(stooqTickers);
    for (const q of stooqQuotes) {
      stooqMap.set(q.symbol, { changePct: q.changePct, close: q.close });
    }
  }

  // Stooq for non-US constituents (KR/JP/CN/EU/IN/TW)
  // Stooq is reliable from Vercel (unlike Yahoo which rate-limits 80-req bursts)
  const nonUSQuoteMap = new Map<string, { changePct: number | null; close: number | null }>();
  if (country !== 'US') {
    const stooqQuotes = await fetchStooqNonUS(topHoldings, country);
    for (const q of stooqQuotes) {
      if (q.changePct != null || q.close != null) {
        nonUSQuoteMap.set(q.symbol, { changePct: q.changePct, close: q.close });
      }
    }
    logger.info('market-heatmap', 'nonUS_stooq_done', {
      country, requested: topHoldings.length, matched: nonUSQuoteMap.size,
    });
  }

  // CNBC for index ETFs — reliable from Vercel IPs (Yahoo v8 blocked by AWS range)
  const indexCNBCQuotes = await fetchCNBCQuotes(indexConfigs.map(i => i.symbol));
  const indexYahooMap = new Map(indexCNBCQuotes.map(q => [q.symbol, q]));

  // 3. Build HeatmapStock list
  const stocks: HeatmapStock[] = topHoldings.map(h => {
    const live = country === 'US' ? stooqMap.get(h.ticker) : nonUSQuoteMap.get(h.ticker);
    return {
      ticker: h.ticker,
      name: h.name,
      sector: h.sector,
      marketCap: h.marketValue / 1e9,
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

  // 5. Build indices from Yahoo v8 (accurate day-change)
  const indices: HeatmapIndex[] = indexConfigs.map(i => {
    const q = indexYahooMap.get(i.symbol);
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
      ? 'iShares IVV (구성) + Stooq (종목 시세) + Yahoo v8 (지수)'
      : `iShares ${cfg?.etfTicker} (구성) + Stooq (시세)`,
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

  return NextResponse.json({ ...data, cached: false }, { headers: CDN_HEADERS });
}
