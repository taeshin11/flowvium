import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/analyst-target/[ticker]
 *
 * Analyst price targets + buy/hold/sell recommendation breakdown.
 * - Price target high/low/mean/median: Yahoo Finance v10 financialData (crumb from Redis, set by sector-pe)
 * - Price target mean fallback: Finviz HTML scrape (no auth, free)
 * - Buy/Hold/Sell counts: Finnhub /stock/recommendation (free tier)
 *
 * Yahoo v10 crumb is acquired and cached by /api/sector-pe (key: flowvium:yahoo:crumb:v1).
 * If crumb is unavailable, falls back to Finviz mean only.
 * Redis cache: 24h (consensus changes slowly)
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';

export const dynamic = 'force-dynamic';

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' };
const CACHE_TTL = 24 * 60 * 60;
const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CRUMB_REDIS_KEY = 'flowvium:yahoo:crumb:v1'; // set/maintained by /api/sector-pe

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
  recommendationMean?: number;
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
  const cacheKey = `flowvium:analyst-target:v2:${ticker}`;

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
    const FINVIZ_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    // Read Yahoo crumb cached by sector-pe — if present, use v10 financialData for full target range
    let yfCrumb: { crumb: string; cookie: string } | null = null;
    if (redis) {
      try {
        yfCrumb = await redis.get<{ crumb: string; cookie: string }>(CRUMB_REDIS_KEY);
      } catch { /* non-fatal */ }
    }

    const fetches: Promise<Response>[] = [
      fetch(
        `https://finviz.com/quote.ashx?t=${encodeURIComponent(ticker)}`,
        { headers: { 'User-Agent': FINVIZ_UA }, signal: AbortSignal.timeout(8000), cache: 'no-store' },
      ),
      fetch(
        `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(key)}`,
        { signal: AbortSignal.timeout(8000), cache: 'no-store' },
      ),
    ];
    if (yfCrumb) {
      fetches.push(fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=financialData&crumb=${encodeURIComponent(yfCrumb.crumb)}`,
        { headers: { 'User-Agent': YF_UA, 'Cookie': yfCrumb.cookie }, signal: AbortSignal.timeout(8000), cache: 'no-store' },
      ));
    }

    const [finvizRes, recRes, v10Res] = await Promise.allSettled(fetches);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let latestRec: any = null;
    let targetMean: number | null = null;
    let targetHigh: number | null = null;
    let targetLow: number | null = null;
    let targetMedian: number | null = null;
    let recommendationMean: number | null = null;

    if (finvizRes.status === 'fulfilled' && finvizRes.value.ok) {
      const html = await finvizRes.value.text();
      const tMatch = html.match(/Target Price[\s\S]{0,400}?<b><span[^>]*>([\d.,]+)<\/span>/);
      if (tMatch) targetMean = parseFloat(tMatch[1].replace(/,/g, ''));
      const rMatch = html.match(/\bRecom[\s\S]{0,400}?<b><span[^>]*>([\d.]+)<\/span>/);
      if (rMatch) recommendationMean = parseFloat(rMatch[1]);
    }
    if (recRes.status === 'fulfilled' && recRes.value.ok) {
      const arr = await recRes.value.json();
      latestRec = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
    }
    if (v10Res && v10Res.status === 'fulfilled' && v10Res.value.ok) {
      try {
        const v10Json = await v10Res.value.json();
        const fd = v10Json?.quoteSummary?.result?.[0]?.financialData ?? {};
        const rawGet = (obj: Record<string, unknown>, k: string): number | null => {
          const v = obj[k];
          if (v && typeof v === 'object' && 'raw' in (v as object)) {
            const raw = (v as { raw: unknown }).raw;
            return typeof raw === 'number' ? raw : null;
          }
          return typeof v === 'number' ? v : null;
        };
        targetHigh = rawGet(fd, 'targetHighPrice');
        targetLow = rawGet(fd, 'targetLowPrice');
        targetMedian = rawGet(fd, 'targetMedianPrice');
        const v10Mean = rawGet(fd, 'targetMeanPrice');
        if (v10Mean) targetMean = v10Mean;  // v10 preferred over Finviz scrape
      } catch { /* non-fatal — Finviz mean still available */ }
    }

    const result: AnalystData = {
      targetHigh,
      targetLow,
      targetMean,
      targetMedian,
      lastUpdated: null,
      strongBuy: latestRec?.strongBuy ?? 0,
      buy: latestRec?.buy ?? 0,
      hold: latestRec?.hold ?? 0,
      sell: latestRec?.sell ?? 0,
      strongSell: latestRec?.strongSell ?? 0,
      totalAnalysts: (latestRec?.strongBuy ?? 0) + (latestRec?.buy ?? 0) + (latestRec?.hold ?? 0) + (latestRec?.sell ?? 0) + (latestRec?.strongSell ?? 0),
      period: latestRec?.period ?? null,
      recommendationMean: recommendationMean ?? undefined,
    };

    logger.info('api.analyst-target', 'ok', { ticker, targetMean, durationMs: Date.now() - t0 });

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
