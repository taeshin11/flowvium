import type { InstitutionalSignal } from '@/data/institutional-signals';
import { logger } from '@/lib/logger';
import { fetchNewsData, computeNewsGapScore } from '@/lib/alpha-vantage';
import {
  getNewsGapCache,
  setNewsGapCache,
  mergeNewsGapCache,
  type TickerNewsCache,
} from '@/lib/signals-cache';
import { Redis } from '@upstash/redis';

const REDIS_KEY_SIGNALS = 'flowvium:13f-signals:v1';

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** Redis에 저장된 EDGAR 13F 파싱 결과를 읽어옴. 없으면 null. */
async function get13FSignals(): Promise<InstitutionalSignal[] | null> {
  try {
    const redis = createRedis();
    if (!redis) return null;
    const data = await redis.get(REDIS_KEY_SIGNALS);
    if (!Array.isArray(data) || data.length === 0) return null;
    return data as InstitutionalSignal[];
  } catch (err) {
    logger.error('signals.service', 'get_13f_failed', { error: err });
    return null;
  }
}

/**
 * All US-listed tickers we track.
 * Ordered mid/small caps FIRST — news gap is most meaningful for less-covered stocks.
 * Large caps (always in the news) are at the end.
 *
 * 23 tickers × 1 AV call each = 23 calls/day → safely within 25/day free tier limit.
 */
const US_TICKERS_BY_PRIORITY = [
  // Tier 1: Mid/small caps + high news-gap names — signal strongest here
  'MU',   'AMAT', 'LRCX', 'KLAC', 'ALB',
  'KTOS', 'MRVL', 'RTX',  'NOC',  'LHX',
  'REGN', 'MRNA', 'COIN', 'FCX',  'SMCI',
  'DELL', 'ORCL', 'TSM',  'ASML',
  // Tier 2: Large caps — still useful for cascade context
  'NVDA', 'MSFT', 'GOOGL',
  'TSLA', 'LLY',  'LMT',
]; // 25 tickers = Alpha Vantage free tier daily limit

export interface SignalsResult {
  signals: InstitutionalSignal[];
  lastUpdated: string;
  updatedTickers: number;
  source: 'live' | 'cached' | 'static';
}

/**
 * Fetch fresh news counts for all US tickers and return a gap cache map.
 * Fires in parallel but respects Alpha Vantage's 5 req/min limit via batching.
 */
async function refreshNewsGaps(
  apiKey: string
): Promise<Record<string, TickerNewsCache>> {
  const now = new Date().toISOString();
  const result: Record<string, TickerNewsCache> = {};

  // AV free tier: 5 req/min — process in batches of 5 with 12s gap
  const BATCH = 5;
  const DELAY_MS = 12_000;

  for (let i = 0; i < US_TICKERS_BY_PRIORITY.length; i += BATCH) {
    const batch = US_TICKERS_BY_PRIORITY.slice(i, i + BATCH);

    const results = await Promise.allSettled(
      batch.map((ticker) => fetchNewsData(ticker, apiKey))
    );

    for (let j = 0; j < batch.length; j++) {
      const ticker = batch[j];
      const r = results[j];
      if (r.status === 'rejected') {
        logger.error('signals.service', 'news_fetch_failed', { ticker, error: r.reason });
      }
      if (r.status === 'fulfilled' && r.value !== null) {
        result[ticker] = {
          score: computeNewsGapScore(r.value.count),
          articles: r.value.count,
          recentArticles: r.value.articles,
          updatedAt: now,
        };
      }
    }

    // Wait between batches (skip delay after last batch)
    if (i + BATCH < US_TICKERS_BY_PRIORITY.length) {
      await new Promise((res) => setTimeout(res, DELAY_MS));
    }
  }

  return result;
}

/**
 * Apply a news gap cache map onto the static signal array.
 * Only newsGapScore + mediaArticles are overwritten — ownership data stays from 13F.
 */
function applyNewsGaps(
  base: InstitutionalSignal[],
  cache: Record<string, TickerNewsCache>
): InstitutionalSignal[] {
  return base.map((s) => {
    const entry = cache[s.ticker];
    if (!entry) return s;
    return { ...s, newsGapScore: entry.score, mediaArticles: entry.articles };
  });
}

/**
 * Main entry point called by the signals server component.
 *
 * Strategy:
 * 1. Redis 13F 데이터 확인 (EDGAR 크론이 저장한 실제 파싱 데이터)
 * 2. 없으면 정적 데이터 사용
 * 3. Alpha Vantage 뉴스갭 스코어 오버레이
 * 4. Persist refreshed data to Redis (26h TTL)
 */
// 재진입 방지: refreshNewsGaps 이 이미 돌고 있으면 또 kick off 하지 않는다.
// 서버리스 인스턴스 수명 내에서만 유효 (cold start 후 초기화).
let backgroundRefreshInFlight = false;

export async function getSignals(forceRefresh = false): Promise<SignalsResult> {
  const apiKey =
    process.env.ALPHA_VANTAGE_KEY ??
    process.env.NEXT_PUBLIC_ALPHA_VANTAGE_KEY ??
    '';

  const lastUpdated = new Date().toISOString();

  // === 1. EDGAR 13F Redis 데이터 우선 사용 ===
  const liveSignals = await get13FSignals();
  // 하드코딩 institutionalSignals 폴백 제거 — stale 데이터가 실데이터처럼 보이는 문제 방지.
  // 크론이 한 번도 안 돌았거나 Redis 비어있으면 빈 배열 반환 (투명한 실패).
  const baseSignals = liveSignals ?? [];

  // === No API key → EDGAR 또는 empty ===
  if (!apiKey) {
    return {
      signals: baseSignals,
      lastUpdated,
      updatedTickers: 0,
      source: liveSignals ? 'live' : 'static',
    };
  }

  // === Try Redis cache ===
  const cached = await getNewsGapCache();

  if (cached && !forceRefresh) {
    return {
      signals: applyNewsGaps(baseSignals, cached),
      lastUpdated,
      updatedTickers: Object.keys(cached).length,
      source: 'cached',
    };
  }

  // === 캐시 없음: stale-while-revalidate ===
  // refreshNewsGaps 는 AV 무료 티어 5req/min 제약 때문에 ceil(N/5)*12s 걸림
  // (100 tickers = 4분). SSR 페이지가 이걸 블록하면 사용자 타임아웃.
  // 해결: base signals 즉시 반환 + 백그라운드에서 refresh kick off.
  // 다음 요청에서 Redis 캐시 히트로 live 데이터 제공. 첫 요청만 static.
  if (!backgroundRefreshInFlight) {
    backgroundRefreshInFlight = true;
    // fire-and-forget — Promise 버려도 serverless runtime 이 완료까지 유지 (best-effort)
    (async () => {
      try {
        const fresh = await refreshNewsGaps(apiKey);
        const merged = mergeNewsGapCache(cached, fresh);
        await setNewsGapCache(merged);
        logger.info('signals.service', 'background_refresh_ok', { updatedTickers: Object.keys(fresh).length });
      } catch (err) {
        logger.error('signals.service', 'background_refresh_failed', { error: err });
      } finally {
        backgroundRefreshInFlight = false;
      }
    })();
    logger.info('signals.service', 'background_refresh_started');
  }

  // 사용자는 즉시 base signals 받는다 (news gap score 는 다음 요청부터)
  return {
    signals: baseSignals,
    lastUpdated,
    updatedTickers: 0,
    source: liveSignals ? 'live' : 'static',
  };
}
