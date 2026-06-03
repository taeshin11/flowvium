import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/company-financials/[ticker]
 *
 * Returns live annual revenue data from SEC EDGAR. Redis-cached for 24h.
 * Module-level memory cache (4h) prevents SEC re-fetch on every cold start.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { fetchLiveFinancials, type LiveFinancials } from '@/lib/sec-financials';
import { createMemoryCache } from '@/lib/memory-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TTL = 24 * 60 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' };
const MEMORY_CACHE = createMemoryCache<LiveFinancials>('company-financials', 4 * 60 * 60_000);

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const rawTicker = params.ticker.toUpperCase();
  // 2026-05-30: BRK.B → BRK-B (SEC EDGAR 형식). dot 가 SEC ticker lookup 에서 dash 로 표기됨.
  //   기존엔 BRK.B 그대로 SEC 에 보내서 100% 404 발생 (audit Probe [3b] catch).
  const ticker = rawTicker.replace(/\./g, '-');
  // KR ticker (.KS / .KQ → -KS / -KQ) 는 SEC 가 처리 못함 — 즉시 redirect to company-kr.
  if (rawTicker.endsWith('.KS') || rawTicker.endsWith('.KQ')) {
    return NextResponse.json({ error: 'kr-ticker-use-company-kr', ticker: rawTicker, hint: '/api/company-kr/' + rawTicker.replace(/\.(KS|KQ)$/, '') }, { status: 404 });
  }
  const redis = createRedis();
  const cacheKey = `flowvium:company-financials:v7:${ticker}`;  // v6: epsDiluted USD/shares unit fix (2026-06-03)

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  } else {
    const mem = MEMORY_CACHE.get(ticker);
    if (mem) return NextResponse.json({ ...mem, cached: true, cacheLayer: 'memory' }, { headers: CDN_HEADERS });
  }

  const data = await fetchLiveFinancials(ticker);
  if (!data) {
    return NextResponse.json({ error: 'not-found', ticker }, { status: 404 });
  }

  if (redis) {
    await loggedRedisSet(redis, 'api.company-financials', cacheKey, data, { ex: TTL });
  } else {
    MEMORY_CACHE.set(ticker, data);
  }

  return NextResponse.json({ ...data, cached: false }, { headers: CDN_HEADERS });
}
