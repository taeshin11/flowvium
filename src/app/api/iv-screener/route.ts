/**
 * /api/iv-screener
 *
 * 미리 정의된 watchlist (S&P500 핵심 + AI 인프라 + ETF) 의 IV 요약 한 번에.
 * 각 종목은 /api/iv/[ticker] 의 Redis 캐시를 직접 읽어 4h TTL 안에서 일관.
 *
 * 캐시 채우기:
 *   1차 - `cron/iv-prewarm` 가 평일 2x/일 전종목 사전 워밍 (`flowvium:iv:v1:{T}` 4h)
 *   2차 - 본 엔드포인트 매 요청 무작위 3건 lazy compute (cron 사이 신선도 보충)
 *   3차 - 영구 실패 티커 (no_valid_expiries 등) 는 `flowvium:iv:v1:neg:{T}` 1h
 *         negative cache 로 격리 → lazy 슬롯 낭비 방지
 *
 * source 필드: 'mixed' (캐시+live), 'cached' (모두 캐시), 'partial' (일부 실패).
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { fetchYahooOptionChain } from '@/lib/options/yahoo-chain';
import { summarizeIv, type IvSummary } from '@/lib/options/iv-summary';
import { SCREENER_TICKERS } from '@/lib/options/screener-tickers';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CACHE_TTL = 4 * 60 * 60;
const NEG_CACHE_TTL = 60 * 60; // 영구 실패 티커 negative cache — 1h 동안 lazy 슬롯 낭비 방지

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

  // Negative cache 확인 — 영구 실패 티커는 1h 동안 lazy 슬롯에서 제외
  // (예: MSFT no_valid_expiries 같은 옵션 체인 quality 이슈로 매번 재시도하면 3슬롯 낭비)
  const candidateMissing = SCREENER_TICKERS.filter((t) => !cachedEntries.has(t));
  let skippedNegative = 0;
  let stillMissing = candidateMissing;
  if (redis && candidateMissing.length > 0) {
    try {
      const negKeys = candidateMissing.map((t) => `flowvium:iv:v1:neg:${t}`);
      const negResults = await redis.mget<(string | null)[]>(...negKeys);
      stillMissing = candidateMissing.filter((_, i) => !negResults[i]);
      skippedNegative = candidateMissing.length - stillMissing.length;
    } catch (err) {
      logger.warn('api.iv-screener', 'neg_cache_read_error', { error: String(err) });
    }
  }

  // 무작위 샘플 3건 — slice(0,3) 였으면 NVDA/MSFT/AAPL 만 영원히 시도. 무작위로
  // 돌면 28개 티커가 시간 지나면서 점진적으로 캐시 채워짐.
  const shuffled = [...stillMissing].sort(() => Math.random() - 0.5);
  const missing = shuffled.slice(0, 3);
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
        return { ticker, summary };
      }),
    );
    for (let i = 0; i < missing.length; i++) {
      const r = computed[i];
      const ticker = missing[i];
      if (r.status === 'fulfilled' && r.value.summary.atmIv30d != null) {
        cachedEntries.set(ticker, r.value.summary);
        lazyComputed++;
      } else {
        errored++;
        // Negative cache 등록 — 옵션 체인 quality 이슈 가능 (e.g., no_valid_expiries)
        if (redis) {
          const reason = r.status === 'fulfilled'
            ? (r.value.summary.errorReason ?? 'no_atmIv30d')
            : 'fetch_failed';
          await loggedRedisSet(
            redis,
            'api.iv-screener',
            `flowvium:iv:v1:neg:${ticker}`,
            reason,
            { ex: NEG_CACHE_TTL },
          );
        }
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
    skippedNegative,
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
