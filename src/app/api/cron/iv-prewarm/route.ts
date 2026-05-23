/**
 * Cron: /api/cron/iv-prewarm
 *
 * /api/iv-screener 가 의존하는 31개 티커의 IV 캐시(`flowvium:iv:v1:{TICKER}`)를
 * 모두 채운다. 이 cron 이 없으면 screener 는 매 요청 lazy compute 3건 / 30s 안에
 * 처리 가능한 만큼만 채워서 28개 티커가 영영 비어있는 상태로 남음.
 *
 * 운영:
 *   - vercel.json 에서 2x/일 (장 시작 13:30 UTC = 22:30 KST 직전 + 점심 18:00 UTC).
 *   - 동시성 4 — Yahoo crumb 공유 + 단일 ticker ~2-4s. 31 / 4 = 8 그룹 * 3s = ~24s.
 *   - maxDuration 60s 안에 들어와야 함 (Vercel Hobby 한도).
 *   - 영구 실패 티커 (no_valid_expiries 등) 는 negative cache 1h TTL 로 표시 — screener
 *     의 lazy compute 슬롯 낭비 방지.
 *
 * 정적 폴백 절대 사용 안 함 (시계열 시장 데이터 — CLAUDE.md 규칙).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { fetchYahooOptionChain } from '@/lib/options/yahoo-chain';
import { summarizeIv } from '@/lib/options/iv-summary';
import { SCREENER_TICKERS } from '@/lib/options/screener-tickers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL = 4 * 60 * 60;
const STALE_TTL = 24 * 60 * 60;
const NEG_CACHE_TTL = 60 * 60;
const CONCURRENCY = 4;

interface PrewarmResult {
  ticker: string;
  ok: boolean;
  reason?: string;
  durationMs: number;
  qualityScore: number;
}

async function processOne(ticker: string, redis: ReturnType<typeof createRedis>): Promise<PrewarmResult> {
  const t0 = Date.now();
  try {
    const chain = await fetchYahooOptionChain(ticker);
    const summary = summarizeIv(chain);
    const durationMs = Date.now() - t0;
    if (summary.source === 'live' && summary.atmIv30d != null) {
      if (redis) {
        await loggedRedisSet(redis, 'cron.iv-prewarm', `flowvium:iv:v1:${ticker}`, summary, {
          ex: CACHE_TTL,
        });
        await loggedRedisSet(redis, 'cron.iv-prewarm', `flowvium:iv:v1:stale:${ticker}`, summary, {
          ex: STALE_TTL,
        });
      }
      return { ticker, ok: true, durationMs, qualityScore: summary.qualityScore };
    }
    const reason = summary.errorReason ?? 'no_atmIv30d';
    if (redis) {
      await loggedRedisSet(redis, 'cron.iv-prewarm', `flowvium:iv:v1:neg:${ticker}`, reason, {
        ex: NEG_CACHE_TTL,
      });
    }
    return { ticker, ok: false, reason, durationMs, qualityScore: summary.qualityScore };
  } catch (err) {
    return {
      ticker,
      ok: false,
      reason: `exception:${String(err).slice(0, 80)}`,
      durationMs: Date.now() - t0,
      qualityScore: 0,
    };
  }
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  const isVercelCron = !!req.headers.get('x-vercel-cron');
  if (process.env.CRON_SECRET && !isVercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const redis = createRedis();
  const results: PrewarmResult[] = [];

  // 동시성 제한 워커 풀
  const queue = [...SCREENER_TICKERS];
  const workers: Promise<void>[] = [];
  for (let w = 0; w < CONCURRENCY; w++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const t = queue.shift();
          if (!t) break;
          const r = await processOne(t, redis);
          results.push(r);
        }
      })(),
    );
  }
  await Promise.all(workers);

  const successCount = results.filter((r) => r.ok).length;
  const errorBreakdown: Record<string, number> = {};
  for (const r of results) {
    if (!r.ok) errorBreakdown[r.reason ?? 'unknown'] = (errorBreakdown[r.reason ?? 'unknown'] ?? 0) + 1;
  }

  logger.info('cron.iv-prewarm', 'completed', {
    total: SCREENER_TICKERS.length,
    successCount,
    durationMs: Date.now() - start,
    errorBreakdown,
    source: 'live',
  });

  return NextResponse.json({
    ok: true,
    source: successCount > 0 ? 'live' : 'error',
    total: SCREENER_TICKERS.length,
    successCount,
    failedCount: SCREENER_TICKERS.length - successCount,
    durationMs: Date.now() - start,
    errorBreakdown,
    results: results.map((r) => ({
      ticker: r.ticker,
      ok: r.ok,
      quality: r.qualityScore,
      reason: r.reason,
      ms: r.durationMs,
    })),
    timestamp: new Date().toISOString(),
  });
}
