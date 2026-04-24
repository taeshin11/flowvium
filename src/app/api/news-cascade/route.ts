import { logger, loggedRedisSet} from '@/lib/logger';
import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai-providers';

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' };

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
const RSS_FEEDS = [
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC,^DJI&region=US&lang=en-US', source: 'Yahoo Finance' },
  { url: 'https://feeds.reuters.com/reuters/businessNews', source: 'Reuters' },
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC' },
  { url: 'https://feeds.bloomberg.com/markets/news.rss', source: 'Bloomberg' },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', source: 'MarketWatch' },
];

async function fetchRSS(feedUrl: string, source: string): Promise<RawNewsItem[]> {
  try {
    const res = await fetch(feedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FlowviumBot/1.0)' },
      signal: AbortSignal.timeout(8000),
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

// ── AI cascade analysis — 통합 provider cascade (vLLM → GROQ → Gemini) ──────
// IMPORTANT: 언어 락 — GROQ 70b 는 한국어 프롬프트에서도 중국어 한자(繁/简體)를
// 혼입하는 빈도가 12%+ 관찰됨 (예: '谈判停滞'). 시스템 프롬프트에 명시적 금지
// + parse 후 post-process guard 두 단계로 차단.
const CASCADE_SYSTEM_PROMPT = '당신은 글로벌 금융 뉴스 분석 전문가입니다. 뉴스의 시장 파급 효과(cascade)를 JSON으로만 분석합니다. 모든 텍스트 필드는 반드시 한글과 영문만 사용하세요 — 중국어 한자(漢字 Hanzi) 절대 금지. 한자 대신 한글로 풀어 쓰세요 (예: "谈判停滞" → "협상 교착", "财报" → "실적발표").';

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
    maxTokens: 600,
    temperature: 0.5,
    skipVllm: true, // JSON 구조 분석은 GROQ 70b가 EXAONE-2.4B보다 우수
    timeoutMs: 18000,
    tag: 'news-cascade',
  });
  return r.text;
}

function buildCascadePrompt(title: string): string {
  return `뉴스 헤드라인: "${title}"

이 뉴스가 금융 시장에 미치는 파급 효과를 분석하세요. 아래 JSON 형식으로만 답하세요:
{
  "summary": "2문장 이내 핵심 내용 요약",
  "sentiment": "bullish|bearish|neutral",
  "importance": "high|medium|low",
  "cascades": [
    {
      "asset": "자산명 (예: S&P500, 금, 달러, 반도체, 채권)",
      "direction": "positive|negative|neutral",
      "magnitude": "high|medium|low",
      "reason": "영향 이유 (1문장)",
      "timeframe": "단기(1-3일)|중기(1-4주)|장기(1-3달)"
    }
  ]
}
cascades는 3-5개 항목으로 작성하세요.`;
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

  // 1. Try to load today's cached list
  if (redis) {
    try {
      const cached = await redis.get<NewsWithCascade[]>(listKey());
      if (cached && cached.length > 0) {
        return NextResponse.json({ articles: cached, cached: true }, { headers: CDN_HEADERS });
      }
    } catch { /* non-fatal */ }
  }

  // 2. Fetch all RSS feeds in parallel
  const rawArticles: RawNewsItem[] = [];
  const results = await Promise.allSettled(
    RSS_FEEDS.map((f) => fetchRSS(f.url, f.source))
  );
  for (const r of results) {
    if (r.status === 'fulfilled') rawArticles.push(...r.value);
  }

  // De-duplicate by title similarity (keep top 10 most recent)
  const seen = new Set<string>();
  const deduped: RawNewsItem[] = [];
  for (const a of rawArticles) {
    const key = a.title.toLowerCase().slice(0, 40);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(a);
    }
    if (deduped.length >= 10) break;
  }

  if (deduped.length === 0) {
    return NextResponse.json({ articles: [], cached: false }, { headers: CDN_HEADERS });
  }

  // 3. Analyze each article with AI (batch to avoid overload)
  const analyzed: NewsWithCascade[] = [];
  for (const item of deduped.slice(0, 8)) {
    try {
      // Check per-article cache first
      let result: NewsWithCascade | null = null;
      const id = hashUrl(item.link);
      if (redis) {
        try {
          result = await redis.get<NewsWithCascade>(articleKey(id));
        } catch { /* ignore */ }
      }

      if (!result) {
        const raw = await callCascadeAI(buildCascadePrompt(item.title));
        result = parseCascade(raw || '', item);
        // Cache per-article for 24h
        if (redis && result) {
          await loggedRedisSet(redis, 'api.news-cascade', articleKey(id), result, { ex: 24 * 60 * 60 })
        }
      }

      analyzed.push(result);
    } catch (e) { logger.error('news-cascade', 'article_analysis_failed', { title: item.title, error: e }); }
  }

  // 4. Sort by importance then date
  const sorted = analyzed.sort((a, b) => {
    const imp = { high: 3, medium: 2, low: 1 };
    return (imp[b.importance] ?? 2) - (imp[a.importance] ?? 2);
  });

  // 5. Cache the full list for 4h
  if (redis && sorted.length > 0) {
    await loggedRedisSet(redis, 'api.news-cascade', listKey(), sorted, { ex: 4 * 60 * 60 })
  }

  return NextResponse.json({ articles: sorted, cached: false }, { headers: CDN_HEADERS });
}
