import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/market-caps
 *
 * Returns { ticker: band } 정적 enum + { ticker: liveCap } TRACKED_TICKERS (~30개).
 * Yahoo v8 chart 는 Vercel 에서도 작동 (no crumb 필요) — TRACKED 30 tickers 만
 * 병렬 fetch 로 caps map 채움. 나머지는 categorical band 만 제공.
 *
 * Optional ?ticker=AAPL param returns single-ticker data with live market cap.
 *
 * Redis cache: 24h (bands enum 정적, live caps 는 24h 안에 +-수% 변동 허용).
 * source: 'live' (전부 라이브), 'mixed' (일부 라이브), 'static' (Yahoo 전부 실패)
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { allCompanies } from '@/data/companies';
import { type MarketCapBand, YAHOO_HEADERS } from '@/lib/yahoo-finance';
export const dynamic = 'force-dynamic';

const CACHE_KEY = 'flowvium:market-caps:v3'; // v3: TRACKED_TICKERS live caps 추가
const CACHE_TTL = 24 * 60 * 60; // 24h — bands enum 정적, live cap 도 ±수% 변동 24h 허용
// Intelligence/Signals/Heatmap 페이지에서 가장 자주 노출되는 hot ticker
const TRACKED_TICKERS = [
  'NVDA', 'MSFT', 'AAPL', 'META', 'GOOGL', 'AMZN', 'TSLA', 'AMD',
  'MU', 'AVGO', 'ARM', 'TSM', 'ASML', 'AMAT', 'LRCX', 'KLAC',
  'JPM', 'GS', 'BAC', 'V', 'UNH', 'XOM', 'CVX',
  'LMT', 'RTX', 'NOC', 'PLTR', 'COIN', 'MRNA', 'LLY',
];
// 단일 ticker live cap 은 Yahoo 응답 그대로 반환 — CDN 은 4h 로 단축 (장중 변동 반영)
const CDN_HEADERS_MAP = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' };
const CDN_HEADERS_TICKER = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=300' };

export const maxDuration = 60;

export interface MarketCapPayload {
  bands: Record<string, MarketCapBand>;  // ticker → band (정적 enum)
  caps: Record<string, number>;          // ticker → raw USD cap (TRACKED_TICKERS live)
  updatedAt: string;
  count: number;
  /** 'live' = TRACKED 전부 라이브, 'mixed' = 일부, 'static' = 라이브 실패 (bands 만) */
  source: 'live' | 'mixed' | 'static';
  capsLive: number;       // 실제로 라이브 fetch 된 caps 개수
  capsTotal: number;      // 시도한 caps 개수 (= TRACKED_TICKERS.length)
  cached?: boolean;
}

async function fetchYahooCap(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
      {
        headers: YAHOO_HEADERS,
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.chart?.result?.[0]?.meta?.marketCap as number | undefined) ?? null;
  } catch { return null; }
}

export async function GET(req: Request) {
  const redis = createRedis();
  const url = new URL(req.url);
  const force = url.searchParams.get('refresh') === '1';
  const filterTicker = url.searchParams.get('ticker')?.toUpperCase() ?? null;

  const reqStart = Date.now();
  if (redis && !force) {
    try {
      const cached = await redis.get<MarketCapPayload>(CACHE_KEY);
      if (cached) {
        logger.info('api.market-caps', 'cache_hit', { count: cached.count });
        if (filterTicker) {
          const band = cached.bands[filterTicker] ?? null;
          const liveCap = await fetchYahooCap(filterTicker);
          const caps = liveCap != null ? { [filterTicker]: liveCap } : {};
          return NextResponse.json({
            bands: band ? { [filterTicker]: band } : {}, caps,
            updatedAt: cached.updatedAt, count: 1, cached: true,
            source: liveCap != null ? 'yahoo-live' : 'static-band',
          }, { headers: CDN_HEADERS_TICKER });
        }
        return NextResponse.json({ ...cached, cached: true }, { headers: CDN_HEADERS_MAP });
      }
    } catch (err) { logger.warn('api.market-caps', 'cache_read_error', { error: err }); }
  }

  const bands: Record<string, MarketCapBand> = {};
  const seen = new Set<string>();
  for (const c of allCompanies) {
    if (!c.ticker || seen.has(c.ticker)) continue;
    seen.add(c.ticker);
    bands[c.ticker] = c.marketCap as MarketCapBand;
  }

  // TRACKED_TICKERS 만 병렬 라이브 fetch (Vercel maxDuration=60s 안)
  const liveResults = await Promise.all(
    TRACKED_TICKERS.map(async t => [t, await fetchYahooCap(t)] as const),
  );
  const caps: Record<string, number> = {};
  let capsLive = 0;
  for (const [t, c] of liveResults) {
    if (c != null && c > 0) { caps[t] = c; capsLive++; }
  }
  const capsTotal = TRACKED_TICKERS.length;
  const liveSource: 'live' | 'mixed' | 'static' =
    capsLive === capsTotal ? 'live' : capsLive > 0 ? 'mixed' : 'static';

  const payload: MarketCapPayload = {
    bands,
    caps,
    updatedAt: new Date().toISOString(),
    count: seen.size,
    source: liveSource,
    capsLive,
    capsTotal,
  };

  await loggedRedisSet(redis, 'api.market-caps', CACHE_KEY, payload, { ex: CACHE_TTL });

  logger.info('api.market-caps', 'served', { tickers: seen.size, durationMs: Date.now() - reqStart });

  if (filterTicker) {
    const band = payload.bands[filterTicker] ?? null;
    const liveCap = await fetchYahooCap(filterTicker);
    const caps = liveCap != null ? { [filterTicker]: liveCap } : {};
    return NextResponse.json({
      bands: band ? { [filterTicker]: band } : {}, caps,
      updatedAt: payload.updatedAt, count: 1, cached: false,
      source: liveCap != null ? 'yahoo-live' : 'static-band',
    }, { headers: CDN_HEADERS_TICKER });
  }
  return NextResponse.json({ ...payload, cached: false }, { headers: CDN_HEADERS_MAP });
}
