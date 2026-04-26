import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { callAI } from '@/lib/ai-providers';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL_S = 2 * 60 * 60;        // 2h primary (news summary doesn't need 30min refresh)
const STALE_CACHE_TTL_S = 48 * 60 * 60; // 48h stale (served when AI quota exhausted)
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=1440, stale-while-revalidate=120' };

export interface NewsItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: string;
}

function redisCacheKey(ticker: string): string {
  return `flowvium:company-news:v3:${ticker}`;
}
function staleRedisCacheKey(ticker: string): string {
  return `flowvium:company-news:v3:stale:${ticker}`;
}

// Finnhub company news — requires FINNHUB_KEY, free tier 60 req/min
async function fetchFinnhubNews(ticker: string): Promise<NewsItem[]> {
  const key = process.env.FINNHUB_KEY?.trim();
  if (!key) return [];
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const res = await fetch(
    `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`,
    { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000), cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`Finnhub news HTTP ${res.status}`);
  const data = await res.json() as Array<{ headline?: string; url?: string; datetime?: number; source?: string; summary?: string }>;
  return data.slice(0, 8).map(n => ({
    title: String(n.headline ?? ''),
    description: String(n.summary ?? '').slice(0, 200),
    link: String(n.url ?? ''),
    pubDate: n.datetime ? new Date(n.datetime * 1000).toISOString() : new Date().toISOString(),
    source: String(n.source ?? 'Finnhub'),
  })).filter(n => n.title && n.link);
}

// Yahoo Finance v1 search API — returns JSON news items, no auth required
async function fetchYahooNews(ticker: string): Promise<NewsItem[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=8&quotesCount=0`;
  const res = await fetch(url, {
    headers: YAHOO_HEADERS,
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
  // probe=1: return cached or minimal fallback without calling AI — used by verify-metrics
  const probe = req.nextUrl.searchParams.get('probe') === '1';

  const redis = createRedis();
  const cacheKey = redisCacheKey(ticker);
  const staleCacheKey = staleRedisCacheKey(ticker);

  let staleResult: object | null = null;
  if (redis) {
    try {
      const [freshResult, staleRead] = await Promise.allSettled([
        redis.get(cacheKey),
        redis.get<object>(staleCacheKey),
      ]);
      if (freshResult.status === 'fulfilled' && freshResult.value) {
        logger.info('api.company-news', 'cache_hit', { ticker });
        return NextResponse.json({ ...(freshResult.value as object), cached: true }, { headers: CDN_HEADERS });
      }
      if (staleRead.status === 'fulfilled') staleResult = staleRead.value;
    } catch (err) { logger.warn('api.company-news', 'cache_read_error', { ticker, error: err }); }
  }

  if (probe) {
    return NextResponse.json({ news: [], source: 'probe-fallback', ticker, cached: false }, { headers: { 'Cache-Control': 'no-store' } });
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
      const result = await callAI(prompt, { maxTokens: 200, temperature: 0.3, tag: 'company-news', preferSmallModel: true });
      summary = result.text ?? '';
      if (/[一-鿿぀-ゟ゠-ヿ가-힣]/.test(summary)) summary = '';
    } catch {
      summary = '';
    }

    const result = { ticker, news, summary: summary || null, generatedAt: new Date().toISOString(), cached: false };

    // If AI failed (quota exhausted) but we have a stale result, serve it
    if (!summary && staleResult) {
      logger.warn('api.company-news', 'serving_stale', { ticker });
      return NextResponse.json({ ...(staleResult as object), stale: true, cached: true }, { headers: CDN_HEADERS });
    }

    if (redis) {
      const writes = [loggedRedisSet(redis, 'api.company-news', cacheKey, result, { ex: CACHE_TTL_S })];
      if (summary) {
        writes.push(loggedRedisSet(redis, 'api.company-news', staleCacheKey, result, { ex: STALE_CACHE_TTL_S }));
      }
      await Promise.allSettled(writes);
    }
    return NextResponse.json(result, { headers: CDN_HEADERS });
  } catch (e) {
    logger.warn('api.company-news', 'yahoo_failed', { ticker, error: String(e) });
    // Finnhub fallback — different IP path, free tier, not Yahoo
    try {
      const finnhubNews = await fetchFinnhubNews(ticker);
      if (finnhubNews.length > 0) {
        logger.info('api.company-news', 'finnhub_fallback', { ticker, count: finnhubNews.length });
        const result = { ticker, news: finnhubNews, summary: null, source: 'finnhub', generatedAt: new Date().toISOString(), cached: false };
        if (redis) {
          await loggedRedisSet(redis, 'api.company-news', cacheKey, result, { ex: 30 * 60 });
        }
        return NextResponse.json(result, { headers: CDN_HEADERS });
      }
    } catch (fe) { logger.warn('api.company-news', 'finnhub_failed', { ticker, error: String(fe) }); }
    if (staleResult) {
      return NextResponse.json({ ...(staleResult as object), stale: true, cached: true }, { headers: CDN_HEADERS });
    }
    return NextResponse.json({ ticker, news: [], summary: null, error: 'unavailable', cached: false }, { headers: CDN_HEADERS });
  }
}
