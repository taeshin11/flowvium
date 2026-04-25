import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { callAI } from '@/lib/ai-providers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL_S = 30 * 60; // 30 min
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=1440, stale-while-revalidate=120' };

export interface NewsItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: string;
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function redisCacheKey(ticker: string): string {
  return `flowvium:company-news:v3:${ticker}`;
}

// Yahoo Finance v1 search API — returns JSON news items, no auth required
async function fetchYahooNews(ticker: string): Promise<NewsItem[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=8&quotesCount=0`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Yahoo Finance search HTTP ${res.status}`);
  const data = await res.json() as { news?: Array<Record<string, unknown>> };
  const items = (data.news ?? []).filter(n => n.type === 'STORY');
  return items.slice(0, 8).map(n => ({
    title: String(n.title ?? ''),
    description: '',
    link: String(n.link ?? ''),
    pubDate: n.providerPublishTime
      ? new Date(Number(n.providerPublishTime) * 1000).toISOString()
      : new Date().toISOString(),
    source: String(n.publisher ?? 'Yahoo Finance'),
  })).filter(n => n.title);
}

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get('ticker') ?? '').toUpperCase().trim();
  if (!ticker || !/^[A-Z0-9.^=]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 });
  }

  const redis = createRedis();
  const cacheKey = redisCacheKey(ticker);

  if (redis) {
    try {
      const hit = await redis.get(cacheKey);
      if (hit) {
        logger.info('api.company-news', 'cache_hit', { ticker });
        return NextResponse.json({ ...(hit as object), cached: true }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.company-news', 'cache_read_error', { ticker, error: err }); }
  }

  try {
    const news = await fetchYahooNews(ticker);
    if (news.length === 0) throw new Error('No news items returned');

    const newsContext = news.slice(0, 5).map((n, i) =>
      `${i + 1}. [${n.source}] ${n.title}`
    ).join('\n');

    const prompt = `You are a concise financial analyst. Summarize the following recent news about ${ticker} in 2-3 sentences. Focus on: what's moving the stock, key risks or catalysts, and market sentiment. Be specific and factual. Respond in English.\n\nNews:\n${newsContext}`;

    let summary = '';
    try {
      const result = await callAI(prompt, { maxTokens: 200, temperature: 0.3, tag: 'company-news' });
      summary = result.text ?? '';
      if (/[一-鿿぀-ゟ゠-ヿ가-힣]/.test(summary)) summary = '';
    } catch {
      summary = '';
    }

    const result = { ticker, news, summary: summary || null, generatedAt: new Date().toISOString(), cached: false };
    if (redis) {
      await loggedRedisSet(redis, 'api.company-news', cacheKey, result, { ex: CACHE_TTL_S });
    }
    return NextResponse.json(result, { headers: CDN_HEADERS });
  } catch (e) {
    logger.error('api.company-news', 'fetch_failed', { ticker, error: e });
    return NextResponse.json({ error: 'Failed to fetch news', details: String(e) }, { status: 502 });
  }
}
