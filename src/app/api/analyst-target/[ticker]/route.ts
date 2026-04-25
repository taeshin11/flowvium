import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/analyst-target/[ticker]
 *
 * Analyst price targets + buy/hold/sell recommendation breakdown via Finnhub.
 * Requires FINNHUB_KEY (free tier, 60 req/min).
 *
 * Fetches in parallel:
 *   - /stock/price-target → targetHigh/Low/Mean/Median
 *   - /stock/recommendation → most-recent period buy/hold/sell counts
 *
 * Redis cache: 24h (consensus changes slowly)
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const dynamic = 'force-dynamic';

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' };
const CACHE_TTL = 24 * 60 * 60;

export interface AnalystData {
  targetHigh: number | null;
  targetLow: number | null;
  targetMean: number | null;
  targetMedian: number | null;
  lastUpdated: string | null;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  totalAnalysts: number;
  period: string | null;
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const EMPTY: AnalystData = {
  targetHigh: null, targetLow: null, targetMean: null, targetMedian: null,
  lastUpdated: null, strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0,
  totalAnalysts: 0, period: null,
};

export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  const key = process.env.FINNHUB_KEY?.trim();
  const redis = createRedis();
  const cacheKey = `flowvium:analyst-target:v1:${ticker}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  if (!key) {
    logger.warn('api.analyst-target', 'no_finnhub_key');
    return NextResponse.json({ ...EMPTY, cached: false });
  }

  const t0 = Date.now();
  try {
    const [ptRes, recRes] = await Promise.allSettled([
      fetch(
        `https://finnhub.io/api/v1/stock/price-target?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(key)}`,
        { signal: AbortSignal.timeout(8000), cache: 'no-store' },
      ),
      fetch(
        `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(key)}`,
        { signal: AbortSignal.timeout(8000), cache: 'no-store' },
      ),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pt: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let latestRec: any = null;

    if (ptRes.status === 'fulfilled' && ptRes.value.ok) {
      pt = await ptRes.value.json();
    }
    if (recRes.status === 'fulfilled' && recRes.value.ok) {
      const arr = await recRes.value.json();
      latestRec = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
    }

    const result: AnalystData = {
      targetHigh: typeof pt?.targetHigh === 'number' ? pt.targetHigh : null,
      targetLow: typeof pt?.targetLow === 'number' ? pt.targetLow : null,
      targetMean: typeof pt?.targetMean === 'number' ? pt.targetMean : null,
      targetMedian: typeof pt?.targetMedian === 'number' ? pt.targetMedian : null,
      lastUpdated: pt?.lastUpdated ?? null,
      strongBuy: latestRec?.strongBuy ?? 0,
      buy: latestRec?.buy ?? 0,
      hold: latestRec?.hold ?? 0,
      sell: latestRec?.sell ?? 0,
      strongSell: latestRec?.strongSell ?? 0,
      totalAnalysts: (latestRec?.strongBuy ?? 0) + (latestRec?.buy ?? 0) + (latestRec?.hold ?? 0) + (latestRec?.sell ?? 0) + (latestRec?.strongSell ?? 0),
      period: latestRec?.period ?? null,
    };

    logger.info('api.analyst-target', 'ok', { ticker, durationMs: Date.now() - t0 });

    if (redis) {
      await loggedRedisSet(redis, 'api.analyst-target', cacheKey, result, { ex: CACHE_TTL });
    }

    return NextResponse.json({ ...result, cached: false }, { headers: CDN_HEADERS });
  } catch (err) {
    logger.error('api.analyst-target', 'fetch_failed', {
      ticker, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ...EMPTY, cached: false, error: 'fetch failed' }, { status: 502 });
  }
}
