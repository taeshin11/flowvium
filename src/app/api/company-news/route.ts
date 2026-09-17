import { NextRequest, NextResponse } from 'next/server';

function backgroundTask(fn: () => Promise<unknown>): void {
  void fn().catch(() => { /* swallow — logged inside */ });
}
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { callAI } from '@/lib/ai-providers';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';
import { isGarbage } from '@/lib/strategy-quality';
import { translateItems, LOCALE_NAMES } from '@/lib/translate-headlines';

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

// locale 별 캐시 분리 (en 은 base, 그 외는 번역본). v4 = locale 도입.
function redisCacheKey(ticker: string, locale: string = 'en'): string {
  return locale === 'en' ? `flowvium:company-news:v4:${ticker}` : `flowvium:company-news:v4:${locale}:${ticker}`;
}
function staleRedisCacheKey(ticker: string, locale: string = 'en'): string {
  return locale === 'en' ? `flowvium:company-news:v4:stale:${ticker}` : `flowvium:company-news:v4:stale:${locale}:${ticker}`;
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

// 2026-05-31: KR 종목 (.KS / .KQ) news — Yahoo search 가 .KS 미지원 → Naver 에서 가져온다.
//
// 2026-09-17: 종전 HTML 페이지(finance.naver.com/item/news_news.naver)가 **HTTP 410 Gone** 이다.
//   네이버가 페이지를 없앴다. 그래서 캐시가 없는 한국 종목은 전부 `error: unavailable` 로
//   뉴스가 비었다 — 삼성전자처럼 전에 캐시된 종목만 나와서 겉으로는 멀쩡해 보였다.
//   (audit-coverage 의 company-news 6/12 가 정확히 "미국 6 성공 · 한국 6 실패" 였다.)
//   네이버 증권 모바일이 쓰는 JSON 을 쓴다. 기사 시각(datetime, KST)도 들어 있어,
//   종전에 "지금 시각" 을 넣던 pubDate 도 실제 값이 된다.
const NAVER_ENTITIES: Array<[RegExp, string]> = [
  [/&quot;/g, '"'], [/&#39;|&apos;/g, "'"], [/&hellip;/g, '…'], [/&middot;/g, '·'],
  [/&lsquo;/g, '‘'], [/&rsquo;/g, '’'], [/&ldquo;/g, '“'], [/&rdquo;/g, '”'],
  [/&uarr;/g, '↑'], [/&darr;/g, '↓'], [/&lt;/g, '<'], [/&gt;/g, '>'], [/&amp;/g, '&'],
];
function decodeNaver(t: string): string {
  let s = String(t ?? '');
  for (const [re, v] of NAVER_ENTITIES) s = s.replace(re, v);
  return s.replace(/<[^>]+>/g, '').trim();
}
// "202609171734"(KST) → ISO. 못 읽으면 null — 없는 시각을 지어내지 않는다.
function naverDatetime(dt: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(dt ?? ''));
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type NaverNewsGroup = { total?: number; items?: Array<{
  officeId?: string; articleId?: string; officeName?: string; datetime?: string;
  title?: string; titleFull?: string; mobileNewsUrl?: string;
}> };

async function fetchNaverNews(ticker: string): Promise<NewsItem[]> {
  const code = ticker.replace(/\.(KS|KQ)$/i, '');
  if (!/^\d{6}$/.test(code)) return [];
  const url = `https://m.stock.naver.com/api/news/stock/${code}?pageSize=10&page=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', Referer: 'https://m.stock.naver.com/' },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Naver stock news HTTP ${res.status}`);
  const groups = await res.json() as NaverNewsGroup[];
  if (!Array.isArray(groups)) throw new Error(`Naver stock news: unexpected shape (${typeof groups})`);
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const g of groups) {
    // 묶음의 첫 기사가 대표다(나머지는 같은 사건의 다른 매체).
    const x = g?.items?.[0];
    if (!x) continue;
    const title = decodeNaver(x.titleFull || x.title || '');
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const link = x.mobileNewsUrl
      || (x.officeId && x.articleId ? `https://n.news.naver.com/mnews/article/${x.officeId}/${x.articleId}` : '');
    const pubDate = naverDatetime(x.datetime ?? '');
    if (!link || !pubDate) continue;
    items.push({ title, description: '', link, pubDate, source: x.officeName ? `${x.officeName} (Naver)` : 'Naver 금융' });
    if (items.length >= 8) break;
  }
  return items;
}

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get('ticker') ?? '').toUpperCase().trim();
  if (!ticker || !/^[A-Z0-9.^=]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 });
  }
  // probe=1: return cached or minimal fallback without calling AI — used by verify-metrics
  const probe = req.nextUrl.searchParams.get('probe') === '1';
  const rawLocale = (req.nextUrl.searchParams.get('locale') ?? 'en').trim();
  const locale = LOCALE_NAMES[rawLocale] ? rawLocale : 'en';

  const redis = createRedis();
  const cacheKey = redisCacheKey(ticker, locale);
  const staleCacheKey = staleRedisCacheKey(ticker, locale);

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
    // 2026-05-31: KR ticker → Naver scraping. US/기타 → Yahoo search.
    const isKR = /\.(KS|KQ)$/i.test(ticker);
    const news = isKR ? await fetchNaverNews(ticker) : await fetchYahooNews(ticker);
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
      if (summary && isGarbage(summary, 35)) {
        logger.warn('api.company-news', 'garbage_summary', { ticker, sample: summary.slice(0, 80) });
        summary = '';
      }
    } catch {
      summary = '';
    }

    // locale 번역: 영어 즉시 반환 + 백그라운드 번역 (response timeout 회피)
    // 다음 호출은 번역 캐시 hit
    const result = { ticker, news, summary: summary || null, locale, generatedAt: new Date().toISOString(), cached: false, translating: locale !== 'en' };
    if (locale !== 'en' && redis) {
      backgroundTask(async () => {
        try {
          const translated = await translateItems(
            news.map(n => ({ ...n, summary: n.description })),
            locale,
            'api.company-news.translate',
          );
          const translatedNews = translated.map(it => ({ ...it, description: it.summary ?? it.description ?? '' }));
          const cached = { ticker, news: translatedNews, summary: summary || null, locale, generatedAt: new Date().toISOString(), cached: false };
          await loggedRedisSet(redis, 'api.company-news', cacheKey, cached, { ex: CACHE_TTL_S });
          logger.info('api.company-news', 'bg_translation_done', { ticker, locale, count: translatedNews.length });
        } catch (e) { logger.warn('api.company-news', 'bg_translation_failed', { ticker, locale, error: String(e).slice(0, 100) }); }
      });
    }

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
        const translatedFinnhub = locale === 'en' ? finnhubNews : await translateItems(
          finnhubNews.map(n => ({ ...n, summary: n.description })),
          locale,
          'api.company-news.translate-finnhub',
        ).then(items => items.map(it => ({ ...it, description: it.summary ?? it.description ?? '' })));
        const result = { ticker, news: translatedFinnhub, summary: null, source: 'finnhub', locale, generatedAt: new Date().toISOString(), cached: false };
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
