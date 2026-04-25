import { logger } from './logger';

const AV_BASE = 'https://www.alphavantage.co/query';

export interface AVHolder {
  holder: string;
  shares: number;
  value: number;
  reportedDate: string;
  changeShares: number;
}

export interface NewsArticle {
  title: string;
  /** Human-readable date, e.g. "Apr 14, 2026" */
  date: string;
  source: string;
  url: string;
}

function isRateLimited(data: Record<string, unknown>): boolean {
  return !!(data['Note'] || data['Information'] || data['Error Message']);
}

/** Parse AV time_published "20260315T135900" → "Mar 15, 2026" */
function parseAvDate(raw: string): string {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const year = raw.slice(0, 4);
  const month = parseInt(raw.slice(4, 6), 10) - 1;
  const day = parseInt(raw.slice(6, 8), 10);
  return `${MONTHS[month] ?? '?'} ${day}, ${year}`;
}

/**
 * Fetch top institutional holders for a ticker.
 * Returns null on rate-limit or error (caller should fall back to static data).
 */
export async function fetchInstitutionalOwnership(
  ticker: string,
  apiKey: string
): Promise<AVHolder[] | null> {
  const start = Date.now();
  try {
    const url = `${AV_BASE}?function=INSTITUTIONAL_OWNERSHIP&symbol=${encodeURIComponent(ticker)}&limit=5&apikey=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 43200 } });
    if (!res.ok) {
      logger.warn('av.ownership', 'http_error', { ticker, status: res.status, durationMs: Date.now() - start });
      return null;
    }

    const data = await res.json();
    if (isRateLimited(data)) {
      logger.warn('av.ownership', 'rate_limited', { ticker, note: data['Note'] ?? data['Information'] ?? data['Error Message'] });
      return null;
    }

    const quarterly: unknown[] =
      data?.quarterlyReports ??
      data?.institutionOwnership?.quarterlyReports ??
      [];
    if (!quarterly.length) return null;

    const latest = quarterly[0] as Record<string, unknown>;
    const holders: unknown[] =
      (latest?.institutionHoldings as unknown[]) ??
      (latest?.holders as unknown[]) ??
      [];

    const result = holders.map((h) => {
      const holder = h as Record<string, unknown>;
      return {
        holder: String(holder.holder ?? holder.institutionName ?? ''),
        shares: parseInt(String(holder.shares ?? holder.sharesHeld ?? '0'), 10) || 0,
        value: parseInt(String(holder.value ?? holder.sharesValue ?? '0'), 10) || 0,
        reportedDate: String(holder.reportedDate ?? latest.fiscalDateEnding ?? ''),
        changeShares: parseInt(String(holder.changeShares ?? holder.sharesChange ?? '0'), 10) || 0,
      };
    });
    logger.info('av.ownership', 'fetched', { ticker, holders: result.length, durationMs: Date.now() - start });
    return result;
  } catch (err) {
    logger.error('av.ownership', 'fetch_failed', { ticker, error: err, durationMs: Date.now() - start });
    return null;
  }
}

/**
 * Fetch news articles (count + per-article title/date/source/url) for a ticker in the last 30 days.
 * Returns null on rate-limit or error.
 */
export async function fetchNewsData(
  ticker: string,
  apiKey: string
): Promise<{ count: number; articles: NewsArticle[] } | null> {
  const start = Date.now();
  try {
    const from = new Date();
    from.setDate(from.getDate() - 30);
    // AV format: YYYYMMDDTHHMM (13 chars)
    const timeFrom = from.toISOString().replace(/[-:]/g, '').slice(0, 13);

    const url = `${AV_BASE}?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(ticker)}&time_from=${timeFrom}&limit=200&apikey=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) {
      logger.warn('av.news', 'http_error', { ticker, status: res.status, durationMs: Date.now() - start });
      return null;
    }

    const data = await res.json();
    if (isRateLimited(data)) {
      logger.warn('av.news', 'rate_limited', { ticker, note: data['Note'] ?? data['Information'] ?? data['Error Message'] });
      return null;
    }

    const feed = Array.isArray(data.feed) ? (data.feed as Record<string, unknown>[]) : [];
    const items = parseInt(String(data.items ?? ''), 10);
    const count = !isNaN(items) ? items : feed.length;

    const articles: NewsArticle[] = feed
      .slice(0, 5)
      .map((item) => ({
        title: String(item.title ?? ''),
        date: parseAvDate(String(item.time_published ?? '')),
        source: String(item.source ?? ''),
        url: String(item.url ?? ''),
      }))
      .filter((a) => a.title);

    logger.info('av.news', 'fetched', { ticker, count, articles: articles.length, durationMs: Date.now() - start });
    return { count, articles };
  } catch (err) {
    logger.error('av.news', 'fetch_failed', { ticker, error: err, durationMs: Date.now() - start });
    return null;
  }
}


/**
 * Convert raw article count → news gap score (0–100).
 * Formula: score = 100 - sqrt(articles) * 5, clamped [0, 100]
 * Examples: 0 articles → 100 | 25 → 75 | 100 → 50 | 400 → 0
 */
export function computeNewsGapScore(articleCount: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - Math.sqrt(articleCount) * 5)));
}
