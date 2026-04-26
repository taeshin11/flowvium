import { logger, loggedRedisSet} from '@/lib/logger';
import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai-providers';
export const dynamic = 'force-dynamic';

export const maxDuration = 60;

// 2h CDN + 2h stale-while-revalidate aligned with NEWS_MEMORY_TTL_MS (2h).
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=7200, stale-while-revalidate=7200' };

// Module-level memory cache — without Redis, each request burns 5 GROQ calls (one per article).
// 2h TTL matches daily news cadence without burning the 100k TPD budget.
// Type is forward-declared; actual interface is defined below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let NEWS_MEMORY_CACHE: { articles: any[]; expiresAt: number } | null = null;
const NEWS_MEMORY_TTL_MS = 2 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────
interface RawNewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

export interface CascadeEffect {
  asset: string;
  direction: 'positive' | 'negative' | 'neutral';
  magnitude: 'high' | 'medium' | 'low';
  reason: string;
  timeframe: string;
}

export interface NewsWithCascade extends RawNewsItem {
  id: string;
  summary: string;
  cascades: CascadeEffect[];
  sentiment: 'bullish' | 'bearish' | 'neutral';
  importance: 'high' | 'medium' | 'low';
  analyzedAt: string;
}

// ── Redis ─────────────────────────────────────────────────────────────────────
function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Cache key: per-article (by URL hash) + list key
const LOCK_KEY = 'flowvium:news-cascade:v1:generating';
const LOCK_TTL = 90; // seconds — covers worst-case RSS + 5 AI calls
function listKey(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `flowvium:news-cascade:v1:list:${today}`;
}
function articleKey(id: string): string {
  return `flowvium:news-cascade:v1:article:${id}`;
}

// Simple string hash for URLs
function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

// ── RSS feeds ─────────────────────────────────────────────────────────────────
// Tested 2026-04-25: Yahoo Finance (404), Reuters (000), CNBC (403), MarketWatch → personal finance redirect
// Replaced with confirmed working sources: Bloomberg sub-feeds + WSJ + SeekingAlpha
const RSS_FEEDS = [
  { url: 'https://feeds.bloomberg.com/markets/news.rss', source: 'Bloomberg' },
  { url: 'https://feeds.bloomberg.com/economics/news.rss', source: 'Bloomberg Economics' },
  { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', source: 'WSJ Markets' },
  { url: 'https://seekingalpha.com/market_currents.xml', source: 'Seeking Alpha' },
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC,^DJI&region=US&lang=en-US', source: 'Yahoo Finance' },
];

async function fetchRSS(feedUrl: string, source: string): Promise<RawNewsItem[]> {
  try {
    const res = await fetch(feedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FlowviumBot/1.0)' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) {
      logger.warn('news-cascade', 'rss_http_error', { source, status: res.status });
      return [];
    }
    const xml = await res.text();

    const items: RawNewsItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const title = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? '';
      const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim()
        ?? itemXml.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1]?.trim() ?? '';
      const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? new Date().toISOString();

      if (title && link) {
        items.push({ title, link, pubDate, source });
      }
      if (items.length >= 5) break; // max 5 per feed
    }
    return items;
  } catch (e) {
    logger.error('news-cascade', 'rss_fetch_failed', { source, error: e });
    return [];
  }
}

// ── Keyword-based fallback cascade — AI 소진 시 0-cascade 방지 ──────────────
// Deterministic rule-based fallback when AI providers are unavailable.
// Covers the most common financial news topics with pre-defined cascade templates.
// Only fires when AI returns empty text; AI analysis always takes precedence.
interface KeywordRule {
  pattern: RegExp;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  importance: 'high' | 'medium' | 'low';
  cascades: CascadeEffect[];
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    pattern: /\b(fed|fomc|federal reserve|powell|rate cut|rate hike|interest rate|monetary policy|dovish|hawkish)\b/i,
    sentiment: 'neutral', importance: 'high',
    cascades: [
      { asset: 'S&P500', direction: 'positive', magnitude: 'medium', reason: 'Rate trajectory shapes equity discount rates', timeframe: 'medium-term(1-4w)' },
      { asset: 'Bonds', direction: 'positive', magnitude: 'high', reason: 'Fed signals directly move Treasury yields', timeframe: 'short-term(1-3d)' },
      { asset: 'Dollar', direction: 'neutral', magnitude: 'medium', reason: 'Rate differential shifts USD positioning', timeframe: 'short-term(1-3d)' },
    ],
  },
  {
    pattern: /\b(inflation|cpi|pce|consumer price|price index|deflation|disinflation)\b/i,
    sentiment: 'neutral', importance: 'high',
    cascades: [
      { asset: 'Bonds', direction: 'negative', magnitude: 'medium', reason: 'Higher inflation erodes fixed income real returns', timeframe: 'short-term(1-3d)' },
      { asset: 'Gold', direction: 'positive', magnitude: 'medium', reason: 'Gold serves as inflation hedge', timeframe: 'medium-term(1-4w)' },
      { asset: 'Commodities', direction: 'positive', magnitude: 'low', reason: 'Commodity prices often rise with inflation', timeframe: 'medium-term(1-4w)' },
    ],
  },
  {
    pattern: /\b(gdp|economic growth|recession|contraction|output|gross domestic)\b/i,
    sentiment: 'neutral', importance: 'high',
    cascades: [
      { asset: 'S&P500', direction: 'neutral', magnitude: 'medium', reason: 'GDP data shapes earnings outlook and Fed policy', timeframe: 'medium-term(1-4w)' },
      { asset: 'Dollar', direction: 'positive', magnitude: 'low', reason: 'Strong growth supports currency demand', timeframe: 'medium-term(1-4w)' },
    ],
  },
  {
    pattern: /\b(oil|crude|opec|wti|brent|petroleum|energy supply|natural gas)\b/i,
    sentiment: 'neutral', importance: 'medium',
    cascades: [
      { asset: 'Oil', direction: 'neutral', magnitude: 'high', reason: 'Supply/demand balance directly sets crude prices', timeframe: 'short-term(1-3d)' },
      { asset: 'Energy Sector', direction: 'positive', magnitude: 'medium', reason: 'Oil price moves flow through to E&P earnings', timeframe: 'short-term(1-3d)' },
      { asset: 'S&P500', direction: 'negative', magnitude: 'low', reason: 'Higher energy costs compress non-energy margins', timeframe: 'medium-term(1-4w)' },
    ],
  },
  {
    pattern: /\b(earnings|profit|revenue|beat|miss|guidance|eps|quarterly result)\b/i,
    sentiment: 'neutral', importance: 'medium',
    cascades: [
      { asset: 'S&P500', direction: 'neutral', magnitude: 'medium', reason: 'Aggregate earnings revisions shift index valuations', timeframe: 'short-term(1-3d)' },
      { asset: 'Volatility (VIX)', direction: 'negative', magnitude: 'low', reason: 'Earnings clarity reduces uncertainty premium', timeframe: 'short-term(1-3d)' },
    ],
  },
  {
    pattern: /\b(tariff|trade war|trade deal|sanctions|export|import|trade deficit|protectionism)\b/i,
    sentiment: 'bearish', importance: 'high',
    cascades: [
      { asset: 'S&P500', direction: 'negative', magnitude: 'medium', reason: 'Trade barriers raise input costs and disrupt supply chains', timeframe: 'medium-term(1-4w)' },
      { asset: 'Dollar', direction: 'positive', magnitude: 'low', reason: 'Safe-haven demand on trade uncertainty', timeframe: 'short-term(1-3d)' },
      { asset: 'Emerging Markets', direction: 'negative', magnitude: 'medium', reason: 'Trade-sensitive economies face export headwinds', timeframe: 'medium-term(1-4w)' },
    ],
  },
  {
    pattern: /\b(gold|xau|precious metal|safe.?haven|refuge)\b/i,
    sentiment: 'bullish', importance: 'medium',
    cascades: [
      { asset: 'Gold', direction: 'positive', magnitude: 'medium', reason: 'Safe-haven demand drives gold higher', timeframe: 'short-term(1-3d)' },
      { asset: 'Dollar', direction: 'negative', magnitude: 'low', reason: 'Gold and dollar inversely correlated', timeframe: 'short-term(1-3d)' },
    ],
  },
  {
    pattern: /\b(bank|banking|credit|loan|lending|default|delinquency|deposit|svb|jpmorgan|bank of america|citigroup)\b/i,
    sentiment: 'neutral', importance: 'medium',
    cascades: [
      { asset: 'Financials', direction: 'neutral', magnitude: 'medium', reason: 'Banking sector fundamentals affect financial stocks directly', timeframe: 'short-term(1-3d)' },
      { asset: 'Credit Spreads', direction: 'positive', magnitude: 'low', reason: 'Bank stress signals credit market risk appetite', timeframe: 'medium-term(1-4w)' },
    ],
  },
  {
    pattern: /\b(tech|technology|ai|semiconductor|chip|nvidia|microsoft|apple|alphabet|meta|amazon)\b/i,
    sentiment: 'neutral', importance: 'medium',
    cascades: [
      { asset: 'Technology', direction: 'neutral', magnitude: 'medium', reason: 'Mega-cap tech drives index-level volatility', timeframe: 'short-term(1-3d)' },
      { asset: 'Semiconductors', direction: 'neutral', magnitude: 'medium', reason: 'Chip demand cycle affects sector broadly', timeframe: 'medium-term(1-4w)' },
    ],
  },
  {
    pattern: /\b(geopolitic|war|conflict|ukraine|russia|china|taiwan|middle east|israel|iran|military)\b/i,
    sentiment: 'bearish', importance: 'high',
    cascades: [
      { asset: 'Gold', direction: 'positive', magnitude: 'high', reason: 'Geopolitical risk premium boosts safe-haven demand', timeframe: 'short-term(1-3d)' },
      { asset: 'Oil', direction: 'positive', magnitude: 'medium', reason: 'Supply disruption risk priced into crude', timeframe: 'short-term(1-3d)' },
      { asset: 'S&P500', direction: 'negative', magnitude: 'medium', reason: 'Risk-off sentiment pressures equities', timeframe: 'short-term(1-3d)' },
    ],
  },
];

function keywordFallbackCascade(title: string): Pick<NewsWithCascade, 'summary' | 'sentiment' | 'importance' | 'cascades'> | null {
  const t = title.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(t)) {
      return {
        summary: title,
        sentiment: rule.sentiment,
        importance: rule.importance,
        cascades: rule.cascades,
      };
    }
  }
  return null;
}

// ── AI cascade analysis — 통합 provider cascade (vLLM → GROQ → Gemini) ──────
// IMPORTANT: 언어 락 — GROQ 70b 는 한국어 프롬프트에서도 중국어 한자(繁/简體)를
// 혼입하는 빈도가 12%+ 관찰됨 (예: '谈判停滞'). 시스템 프롬프트에 명시적 금지
// + parse 후 post-process guard 두 단계로 차단.
const CASCADE_SYSTEM_PROMPT = 'You are a global financial news analyst. Analyze the market cascade effects of news in JSON format only. Use English exclusively — do NOT use Chinese characters (Hanzi) or any non-Latin script in text fields.';

/**
 * 중국어 한자 혼입 감지 — U+4E00~U+9FFF (CJK Unified Ideographs) 범위.
 * 한글은 U+AC00~U+D7AF 이라 범위 안 겹침.
 * true 반환 시 해당 텍스트는 품질 불량으로 간주, 상위 레이어에서 대체하거나 로깅.
 */
function hasChineseLeak(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

async function callCascadeAI(prompt: string): Promise<string> {
  const r = await callAI(prompt, {
    systemPrompt: CASCADE_SYSTEM_PROMPT,
    maxTokens: 600, // 5 cascade items × ~100 tokens + envelope ≈ 550; 400 caused JSON truncation
    temperature: 0.5,
    skipVllm: true,
    preferSmallModel: true, // 8b preserves 70b quota for strategy/daily-brief
    timeoutMs: 18000,
    tag: 'news-cascade',
  });
  return r.text;
}

function buildCascadePrompt(title: string): string {
  return `News headline: "${title}"

Analyze the cascade effects of this news on financial markets. Respond in the following JSON format only:
{
  "summary": "Key summary in 1-2 sentences",
  "sentiment": "bullish|bearish|neutral",
  "importance": "high|medium|low",
  "cascades": [
    {
      "asset": "asset name (e.g. S&P500, Gold, Dollar, Semiconductors, Bonds)",
      "direction": "positive|negative|neutral",
      "magnitude": "high|medium|low",
      "reason": "reason for the impact (1 sentence)",
      "timeframe": "short-term(1-3d)|medium-term(1-4w)|long-term(1-3m)"
    }
  ]
}
Include 3-5 cascade items.`;
}

function parseCascade(raw: string, item: RawNewsItem): NewsWithCascade {
  const id = hashUrl(item.link);
  try {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
    const parsed = JSON.parse((jsonMatch[1] ?? raw).trim());

    // 품질 가드: summary 에 한자 혼입이면 title 로 대체 (원문 영어가 한자 혼입보다 나음).
    // cascades[].reason 도 동일 — 혼입된 reason 은 빈 문자열로 지워 UI에서 자동 비노출.
    let summary: string = parsed.summary ?? item.title;
    if (typeof summary === 'string' && hasChineseLeak(summary)) {
      logger.warn('news-cascade', 'chinese_leak_summary', { link: item.link, sample: summary.slice(0, 80) });
      summary = item.title;
    }
    const cascades = Array.isArray(parsed.cascades) ? parsed.cascades.map((c: Record<string, unknown>) => {
      const reason = typeof c?.reason === 'string' ? c.reason : '';
      if (reason && hasChineseLeak(reason)) {
        logger.warn('news-cascade', 'chinese_leak_reason', { link: item.link });
        return { ...c, reason: '' };
      }
      return c;
    }) : [];

    return {
      ...item,
      id,
      summary,
      sentiment: parsed.sentiment ?? 'neutral',
      importance: parsed.importance ?? 'medium',
      cascades,
      analyzedAt: new Date().toISOString(),
    };
  } catch {
    return {
      ...item,
      id,
      summary: item.title,
      sentiment: 'neutral',
      importance: 'medium',
      cascades: [],
      analyzedAt: new Date().toISOString(),
    };
  }
}

// ── GET handler ───────────────────────────────────────────────────────────────
export async function GET() {
  const redis = createRedis();

  // 1a. Module-level memory cache hit (no-Redis path) — avoids 5 GROQ calls per request
  if (!redis && NEWS_MEMORY_CACHE && Date.now() < NEWS_MEMORY_CACHE.expiresAt) {
    logger.info('api.news-cascade', 'memory_cache_hit', { articles: NEWS_MEMORY_CACHE.articles.length });
    return NextResponse.json({ articles: NEWS_MEMORY_CACHE.articles, cached: true }, { headers: CDN_HEADERS });
  }

  // 1b. Try to load today's cached list from Redis
  if (redis) {
    try {
      const cached = await redis.get<NewsWithCascade[]>(listKey());
      if (cached && cached.length > 0) {
        return NextResponse.json({ articles: cached, cached: true }, { headers: CDN_HEADERS });
      }
    } catch { /* non-fatal */ }
  }

  // 1c. Distributed lock — prevent thundering herd at midnight UTC (9 AM KST).
  //     Multiple CDN edge nodes simultaneously miss the 2h cache → all trigger AI
  //     analysis for the same 5 articles. One lock holder runs the full pipeline;
  //     others wait 4s and re-check the list cache (by then it should be written).
  let ownLock = false;
  if (redis) {
    try {
      const acquired = await redis.set(LOCK_KEY, '1', { nx: true, ex: LOCK_TTL });
      if (!acquired) {
        await new Promise(r => setTimeout(r, 4000));
        try {
          const fresh = await redis.get<NewsWithCascade[]>(listKey());
          if (fresh && fresh.length > 0) {
            return NextResponse.json({ articles: fresh, cached: true }, { headers: CDN_HEADERS });
          }
        } catch { /* ignore */ }
        // Lock holder may have crashed — proceed anyway so users aren't stuck
      } else {
        ownLock = true;
      }
    } catch { /* non-fatal — proceed without lock */ }
  }

  // 2. Fetch all RSS feeds in parallel
  const rawArticles: RawNewsItem[] = [];
  const results = await Promise.allSettled(
    RSS_FEEDS.map((f) => fetchRSS(f.url, f.source))
  );
  for (const r of results) {
    if (r.status === 'fulfilled') rawArticles.push(...r.value);
  }

  // Sort by pubDate descending so later feeds (WSJ, SA) don't get dropped in favour
  // of older Bloomberg articles just because Bloomberg was listed first.
  rawArticles.sort((a, b) => {
    const ta = new Date(a.pubDate).getTime();
    const tb = new Date(b.pubDate).getTime();
    return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
  });

  // De-duplicate by title similarity (keep top 7 most recent)
  const seen = new Set<string>();
  const deduped: RawNewsItem[] = [];
  for (const a of rawArticles) {
    const key = a.title.toLowerCase().slice(0, 40);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(a);
    }
    if (deduped.length >= 7) break;
  }

  if (deduped.length === 0) {
    return NextResponse.json({ articles: [], cached: false }, { headers: CDN_HEADERS });
  }

  // 3. Analyze each article with AI — parallel (5 concurrent, each 10s timeout)
  async function analyzeOne(item: RawNewsItem): Promise<NewsWithCascade | null> {
    try {
      const id = hashUrl(item.link);
      if (redis) {
        try {
          const cached = await redis.get<NewsWithCascade>(articleKey(id));
          // Only use cached result if it has real AI analysis (cascades present)
          if (cached && cached.cascades.length > 0) return cached;
        } catch { /* ignore */ }
      }
      const raw = await callCascadeAI(buildCascadePrompt(item.title));
      let result = parseCascade(raw || '', item);

      // Keyword fallback: if AI returned no cascades, use rule-based analysis.
      // Keeps cascade coverage high during AI quota exhaustion — better than zero.
      if (result.cascades.length === 0) {
        const kb = keywordFallbackCascade(item.title);
        if (kb) {
          result = { ...result, ...kb, analyzedAt: new Date().toISOString() };
          logger.info('api.news-cascade', 'keyword_fallback_used', { title: item.title.slice(0, 60) });
        }
      }

      // Only cache AI-quality results — avoid locking keyword fallback for 24h
      if (redis && raw && result.cascades.length > 0) {
        await loggedRedisSet(redis, 'api.news-cascade', articleKey(id), result, { ex: 24 * 60 * 60 });
      }
      return result;
    } catch (e) {
      logger.error('news-cascade', 'article_analysis_failed', { title: item.title, error: e });
      return null;
    }
  }

  const settled = await Promise.allSettled(deduped.slice(0, 5).map(analyzeOne));
  const analyzed: NewsWithCascade[] = settled
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter((v): v is NewsWithCascade => v != null);

  // 4. Sort by importance then date
  const sorted = analyzed.sort((a, b) => {
    const imp = { high: 3, medium: 2, low: 1 };
    return (imp[b.importance] ?? 2) - (imp[a.importance] ?? 2);
  });

  // 5. Cache the full list — tiered TTL based on analysis coverage quality.
  //    12h only when ≥50% of articles have real cascades (full daily cache).
  //    1h otherwise — allows retry after GROQ quota resets at 09:00 KST.
  //    A single article with cascades (10% coverage) must NOT lock stale results for 12h.
  const analyzedCount = sorted.filter(a => a.cascades.length > 0).length;
  const hasGoodCoverage = sorted.length > 0 && analyzedCount >= Math.ceil(sorted.length * 0.5);
  if (redis && sorted.length > 0) {
    const ttl = hasGoodCoverage ? 12 * 60 * 60 : 60 * 60;
    await loggedRedisSet(redis, 'api.news-cascade', listKey(), sorted, { ex: ttl });
  }

  // Module-level memory cache — write regardless of Redis availability.
  // Only cache when analysis quality is good (don't lock fallback stubs for 2h).
  if (!redis && sorted.length > 0 && hasGoodCoverage) {
    NEWS_MEMORY_CACHE = { articles: sorted, expiresAt: Date.now() + NEWS_MEMORY_TTL_MS };
    logger.info('api.news-cascade', 'memory_cache_written', { articles: sorted.length });
  }

  // Release distributed lock (held only when we were the winning Lambda)
  if (redis && ownLock) {
    try { await redis.del(LOCK_KEY); } catch { /* non-fatal */ }
  }

  return NextResponse.json({ articles: sorted, cached: false }, { headers: CDN_HEADERS });
}
