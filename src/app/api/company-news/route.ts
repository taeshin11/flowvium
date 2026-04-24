import { NextRequest, NextResponse } from 'next/server';
import { createMemoryCache } from '@/lib/memory-cache';
import { callAI } from '@/lib/ai-providers';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const mem = createMemoryCache<object>('company-news', CACHE_TTL_MS);
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=1440, stale-while-revalidate=120' };

export interface NewsItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: string;
}

function extractTagContent(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return (match?.[1] ?? match?.[2] ?? '').trim();
}

function parseRssItems(xml: string, limit = 8): NewsItem[] {
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
  return itemBlocks.slice(0, limit).map((block) => {
    const title = extractTagContent(block, 'title').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const description = extractTagContent(block, 'description').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').slice(0, 200);
    const link = extractTagContent(block, 'link');
    const pubDate = extractTagContent(block, 'pubDate');
    const sourceDomain = link.match(/https?:\/\/([^/]+)/)?.[1]?.replace(/^www\./, '') ?? 'Yahoo Finance';
    return { title, description, link, pubDate, source: sourceDomain };
  });
}

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get('ticker') ?? '').toUpperCase().trim();
  if (!ticker || !/^[A-Z0-9.^=]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 });
  }

  const cacheKey = ticker;
  const cached = mem.get(cacheKey);
  if (cached) return NextResponse.json({ ...cached, cached: true }, { headers: CDN_HEADERS });

  try {
    const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`;
    const rssRes = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!rssRes.ok) throw new Error(`RSS HTTP ${rssRes.status}`);

    const xml = await rssRes.text();
    const news = parseRssItems(xml, 8);
    if (news.length === 0) throw new Error('No news items parsed');

    // AI summary: feed top 5 headlines + descriptions to AI
    const newsContext = news.slice(0, 5).map((n, i) =>
      `${i + 1}. [${n.source}] ${n.title}: ${n.description}`
    ).join('\n');

    const prompt = `You are a concise financial analyst. Summarize the following recent news about ${ticker} in 2-3 sentences. Focus on: what's moving the stock, key risks or catalysts, and market sentiment. Be specific and factual. Respond in Korean.\n\nNews:\n${newsContext}`;

    let summary = '';
    try {
      const result = await callAI(prompt, { maxTokens: 200, temperature: 0.3 });
      summary = result.text ?? '';
      // Guard against Chinese character leak
      if (/[一-鿿]/.test(summary) && !/[가-힣]/.test(summary)) {
        summary = '';
      }
    } catch {
      summary = '';
    }

    const result = { ticker, news, summary: summary || null, generatedAt: new Date().toISOString(), cached: false };
    mem.set(cacheKey, result);
    return NextResponse.json(result, { headers: CDN_HEADERS });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch news', details: String(e) }, { status: 502 });
  }
}
