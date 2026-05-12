/**
 * /api/iv-screener
 *
 * 미리 정의된 watchlist (S&P500 핵심 + AI 인프라 + ETF) 의 IV 요약 한 번에.
 * 각 종목은 /api/iv/[ticker] 의 Redis 캐시를 직접 읽어 4h TTL 안에서 일관.
 * 캐시 miss 인 ticker 는 lazy 계산 (최대 3건만 — Vercel 30s 안에 들어오게).
 *
 * source 필드: 'mixed' (캐시+live), 'cached' (모두 캐시), 'partial' (일부 실패).
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { fetchYahooOptionChain } from '@/lib/options/yahoo-chain';
import { summarizeIv, type IvSummary } from '@/lib/options/iv-summary';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CACHE_TTL = 4 * 60 * 60;
const SCREENER_TICKERS = [
  'NVDA', 'MSFT', 'AAPL', 'META', 'GOOGL', 'AMZN', 'TSLA', 'AMD',
  'MU', 'AVGO', 'ARM', 'TSM', 'ASML', 'AMAT', 'LRCX', 'KLAC',
  'JPM', 'GS', 'BAC', 'V', 'UNH', 'XOM', 'CVX',
  'LMT', 'RTX', 'NOC',
  'SPY', 'QQQ', 'IWM', 'GLD', 'TLT',
];

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };

interface ScreenerEntry {
  ticker: string;
  spot: number | null;
  atmIv30d: number | null;
  atmIv90d: number | null;
  termSlope: number | null;
  skew25d: number | null;
  putCallRatio: number | null;
  qualityScore: number;
  asOf: string | null;
}

export interface IvScreenerResponse {
  entries: ScreenerEntry[];
  source: 'live' | 'cached' | 'mixed' | 'partial' | 'error';
  generatedAt: string;
  lazyComputed: number;
  cachedHit: number;
  errored: number;
}

export async function GET() {
  const redis = createRedis();
  const start = Date.now();

  const cachedEntries = new Map<string, IvSummary>();
  if (redis) {
    const mgetKeys = SCREENER_TICKERS.map((t) => `flowvium:iv:v1:${t}`);
    try {
      // Upstash REST mget supports up to 100 keys
      const results = await redis.mget<(IvSummary | null)[]>(...mgetKeys);
      for (let i = 0; i < SCREENER_TICKERS.length; i++) {
        const r = results[i];
        if (r && r.atmIv30d != null) cachedEntries.set(SCREENER_TICKERS[i], r);
      }
    } catch (err) {
      logger.warn('api.iv-screener', 'mget_error', { error: String(err) });
    }
  }

  // Cache miss → lazy compute (최대 3 ticker — Vercel 30s budget)
  const missing = SCREENER_TICKERS.filter((t) => !cachedEntries.has(t)).slice(0, 3);
  let lazyComputed = 0;
  let errored = 0;
  if (missing.length > 0) {
    const computed = await Promise.allSettled(
      missing.map(async (ticker) => {
        const chain = await fetchYahooOptionChain(ticker);
        const summary = summarizeIv(chain);
        if (summary.source === 'live' && summary.atmIv30d != null && redis) {
          await loggedRedisSet(redis, 'api.iv-screener', `flowvium:iv:v1:${ticker}`, summary, {
            ex: CACHE_TTL,
          });
          await loggedRedisSet(redis, 'api.iv-screener', `flowvium:iv:v1:stale:${ticker}`, summary, {
            ex: 24 * 60 * 60,
          });
        }
        return summary;
      }),
    );
    for (let i = 0; i < missing.length; i++) {
      const r = computed[i];
      if (r.status === 'fulfilled' && r.value.atmIv30d != null) {
        cachedEntries.set(missing[i], r.value);
        lazyComputed++;
      } else {
        errored++;
      }
    }
  }

  const entries: ScreenerEntry[] = SCREENER_TICKERS.map((ticker) => {
    const s = cachedEntries.get(ticker);
    if (!s) {
      return {
        ticker,
        spot: null,
        atmIv30d: null,
        atmIv90d: null,
        termSlope: null,
        skew25d: null,
        putCallRatio: null,
        qualityScore: 0,
        asOf: null,
      };
    }
    return {
      ticker,
      spot: s.spot,
      atmIv30d: s.atmIv30d,
      atmIv90d: s.atmIv90d,
      termSlope: s.termSlope,
      skew25d: s.skew25d,
      putCallRatio: s.putCallRatio,
      qualityScore: s.qualityScore,
      asOf: s.asOf,
    };
  });

  const cachedHit = cachedEntries.size - lazyComputed;
  let source: IvScreenerResponse['source'];
  if (cachedEntries.size === 0) source = 'error';
  else if (lazyComputed > 0 && cachedHit > 0) source = 'mixed';
  else if (lazyComputed > 0) source = 'live';
  else if (errored > 0) source = 'partial';
  else source = 'cached';

  logger.info('api.iv-screener', 'served', {
    durationMs: Date.now() - start,
    total: SCREENER_TICKERS.length,
    cachedHit,
    lazyComputed,
    errored,
    source,
  });

  return NextResponse.json(
    {
      entries,
      source,
      generatedAt: new Date().toISOString(),
      lazyComputed,
      cachedHit,
      errored,
    } as IvScreenerResponse,
    { headers: CDN_HEADERS },
  );
}
