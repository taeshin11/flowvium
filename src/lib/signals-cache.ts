import { Redis } from '@upstash/redis';
import { type NewsArticle } from '@/lib/alpha-vantage';
import { logger, loggedRedisSet } from '@/lib/logger';

export interface TickerNewsCache {
  score: number;
  articles: number;
  updatedAt: string;
  recentArticles?: NewsArticle[];
}

// Redis key for news gap cache
const KEY = 'flowvium:news-gap:v2';
// 26-hour TTL — ensures data refreshes daily even if cron fires slightly late
const TTL = 26 * 60 * 60;

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    return null;
  }
  return new Redis({ url, token });
}

export async function getNewsGapCache(): Promise<Record<string, TickerNewsCache> | null> {
  try {
    const redis = createRedis();
    if (!redis) return null;
    return await redis.get<Record<string, TickerNewsCache>>(KEY);
  } catch (err) {
    logger.error('signals.cache', 'get_news_gap_failed', { error: err });
    return null;
  }
}

export async function setNewsGapCache(
  data: Record<string, TickerNewsCache>
): Promise<void> {
  const redis = createRedis();
  const ok = await loggedRedisSet(redis, 'lib.signals-cache', KEY, data, { ex: TTL });
  if (ok) {
    logger.info('signals.cache', 'news_gap_saved', { tickers: Object.keys(data).length });
  }
}

export function mergeNewsGapCache(
  existing: Record<string, TickerNewsCache> | null,
  incoming: Record<string, TickerNewsCache>
): Record<string, TickerNewsCache> {
  return { ...(existing ?? {}), ...incoming };
}
