/**
 * Yahoo Finance helpers — server-side only.
 * Handles batch quotes and per-ticker statistics (short interest).
 *
 * quoteSummary now requires a crumb+cookie (since ~2024). Flow:
 *   1) GET https://fc.yahoo.com            → receive A3 cookie via set-cookie
 *   2) GET /v1/test/getcrumb (w/ A3)       → returns a short opaque crumb string
 *   3) GET /v10/finance/quoteSummary?crumb=… (w/ A3 cookie)
 *
 * Crumb/cookie pair is cached in-process for the lifetime of the lambda.
 */
import { logger } from './logger';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
};

// ── Crumb/cookie cache (in-memory per lambda instance) ───────────────────────
interface YFCreds { cookie: string; crumb: string; fetchedAt: number; }
let yfCreds: YFCreds | null = null;
const CRUMB_TTL_MS = 55 * 60 * 1000; // 55 min — Yahoo A3 rotates ~hourly

/** Parse Set-Cookie header array for A3 (name=value; …) and rebuild minimal Cookie header. */
function parseCookiesFromResponse(res: Response): string {
  // Node fetch collapses duplicate headers with comma separation; Next runtime supports getSetCookie on some platforms.
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? res.headers.get('set-cookie')?.split(/,(?=\s*[A-Za-z0-9_-]+=)/) // split only when next token looks like a cookie
    ?? [];
  const parts: string[] = [];
  for (const line of raw) {
    const nv = line.split(';')[0]?.trim();
    if (nv) parts.push(nv);
  }
  return parts.join('; ');
}

async function fetchYFCreds(): Promise<YFCreds | null> {
  const start = Date.now();
  // Step 1: visit fc.yahoo.com to seed A3 cookie
  let cookie = '';
  try {
    const seed = await fetch('https://fc.yahoo.com', {
      headers: YF_HEADERS,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    cookie = parseCookiesFromResponse(seed);
  } catch (err) {
    logger.error('yahoo.crumb', 'seed_cookie_failed', { error: err, durationMs: Date.now() - start });
    return null;
  }
  if (!cookie) {
    logger.warn('yahoo.crumb', 'seed_cookie_empty', { durationMs: Date.now() - start, message: 'fc.yahoo.com returned no A3 cookie (possibly blocked)' });
    return null;
  }

  // Step 2: fetch crumb with the cookie
  try {
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...YF_HEADERS, Cookie: cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!crumbRes.ok) {
      logger.warn('yahoo.crumb', 'getcrumb_bad_status', { status: crumbRes.status, durationMs: Date.now() - start });
      return null;
    }
    const crumb = (await crumbRes.text()).trim();
    // getcrumb returns a short opaque string; empty/HTML means we were blocked
    if (!crumb || crumb.length > 64 || crumb.includes('<')) {
      logger.warn('yahoo.crumb', 'getcrumb_invalid_body', { durationMs: Date.now() - start, message: `crumb body looks invalid (len=${crumb.length})` });
      return null;
    }
    logger.info('yahoo.crumb', 'acquired', { durationMs: Date.now() - start });
    return { cookie, crumb, fetchedAt: Date.now() };
  } catch (err) {
    logger.error('yahoo.crumb', 'getcrumb_failed', { error: err, durationMs: Date.now() - start });
    return null;
  }
}

async function getYFCreds(force = false): Promise<YFCreds | null> {
  if (!force && yfCreds && Date.now() - yfCreds.fetchedAt < CRUMB_TTL_MS) return yfCreds;
  const fresh = await fetchYFCreds();
  if (fresh) yfCreds = fresh;
  return yfCreds;
}

export interface YFQuote {
  symbol: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  marketCap?: number;
  averageVolume?: number;
  fiftyTwoWeekLow?: number;
  fiftyTwoWeekHigh?: number;
}

export interface YFShortData {
  ticker: string;
  shortFloatPct: number | null;   // % of float shorted (0–100)
  shortRatio: number | null;       // days to cover
  sharesShort: number | null;
  sharesShortPriorMonth: number | null;
  shortChangeMonthly: number | null; // % change in short interest vs prior month
}

/** Fetch quote via v8/chart (v7 is now authorized-only). Runs per-ticker in parallel.
 *  Tries query2 on failure — query1 is sometimes blocked from Vercel US IPs. */
async function fetchOneQuote(ticker: string): Promise<YFQuote | null> {
  for (const host of ['query2', 'query1']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
      const res = await fetch(url, { headers: YF_HEADERS, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const json = await res.json();
      const result = json.chart?.result?.[0];
      if (!result?.meta) continue;
      const m = result.meta;
      const price = m.regularMarketPrice ?? m.chartPreviousClose;
      const prevClose = m.chartPreviousClose ?? m.previousClose ?? price;
      const change = price != null && prevClose != null ? price - prevClose : undefined;
      const changePct = price != null && prevClose && prevClose > 0
        ? ((price - prevClose) / prevClose) * 100
        : undefined;
      return {
        symbol: m.symbol ?? ticker,
        shortName: m.shortName ?? m.symbol ?? ticker,
        longName: m.longName,
        regularMarketPrice: price,
        regularMarketChange: change,
        regularMarketChangePercent: changePct,
        fiftyTwoWeekLow: m.fiftyTwoWeekLow,
        fiftyTwoWeekHigh: m.fiftyTwoWeekHigh,
      };
    } catch { continue; }
  }
  return null;
}

/** Fetch quotes for multiple tickers (parallel, batched to respect rate limits). */
export async function fetchYFQuotes(tickers: string[]): Promise<YFQuote[]> {
  if (!tickers.length) return [];
  const results: YFQuote[] = [];
  const BATCH = 10;
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    const batchResults = await Promise.allSettled(batch.map(t => fetchOneQuote(t)));
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
  }
  return results;
}

export interface YFHeatmapQuote {
  symbol: string;
  changePct: number | null;
  close: number | null;
}

/**
 * Fetch heatmap quotes for many tickers via Yahoo v8/chart (no crumb).
 * Batched at 20 concurrent with 80ms pause between rounds to avoid rate-limiting.
 * Heatmap caches 15min, so the ~3s fetch time is acceptable.
 * Returns correct prev-close → current day change (including pre-market when available).
 */
export async function fetchYFHeatmapQuotes(tickers: string[]): Promise<YFHeatmapQuote[]> {
  if (!tickers.length) return [];
  const CONCURRENT = 20;
  const DELAY_MS = 80;
  const out: YFHeatmapQuote[] = [];

  for (let i = 0; i < tickers.length; i += CONCURRENT) {
    const batch = tickers.slice(i, i + CONCURRENT);
    const settled = await Promise.allSettled(batch.map(t => fetchOneQuote(t)));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        const q = r.value;
        out.push({
          symbol: q.symbol,
          changePct: q.regularMarketChangePercent != null
            ? parseFloat(q.regularMarketChangePercent.toFixed(2))
            : null,
          close: q.regularMarketPrice ?? null,
        });
      }
    }
    if (i + CONCURRENT < tickers.length) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    }
  }
  logger.info('yahoo.heatmap', 'batch_done', { requested: tickers.length, returned: out.length });
  return out;
}

/** Fetch short interest data for a single ticker via quoteSummary (crumb-authenticated). */
export async function fetchYFShortData(ticker: string): Promise<YFShortData> {
  const base: YFShortData = { ticker, shortFloatPct: null, shortRatio: null, sharesShort: null, sharesShortPriorMonth: null, shortChangeMonthly: null };

  // Try up to twice: fresh creds → on 401, invalidate and retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const creds = await getYFCreds(attempt > 0);
    if (!creds) {
      logger.warn('yahoo.short', 'no_creds', { ticker, attempt });
      return base;
    }
    try {
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=defaultKeyStatistics&crumb=${encodeURIComponent(creds.crumb)}`;
      const res = await fetch(url, {
        headers: { ...YF_HEADERS, Cookie: creds.cookie },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 401 || res.status === 403) {
        logger.warn('yahoo.short', 'crumb_rejected', { ticker, status: res.status, attempt, message: 'retrying with fresh crumb' });
        yfCreds = null;
        continue;
      }
      if (!res.ok) {
        logger.warn('yahoo.short', 'http_error', { ticker, status: res.status });
        return base;
      }
      const json = await res.json();
      const stats = json.quoteSummary?.result?.[0]?.defaultKeyStatistics;
      if (!stats) {
        logger.warn('yahoo.short', 'no_stats_in_response', { ticker });
        return base;
      }

      const shortPct = stats.sharesShortPercentOfFloat?.raw ?? null;
      const prior = stats.sharesShortPriorMonth?.raw ?? null;
      const current = stats.sharesShort?.raw ?? null;
      const changeMonthly = (current != null && prior != null && prior > 0)
        ? ((current - prior) / prior) * 100
        : null;

      return {
        ticker,
        shortFloatPct: shortPct != null ? +(shortPct * 100).toFixed(2) : null,
        shortRatio: stats.shortRatio?.raw ?? null,
        sharesShort: current,
        sharesShortPriorMonth: prior,
        shortChangeMonthly: changeMonthly != null ? +changeMonthly.toFixed(1) : null,
      };
    } catch (err) {
      logger.error('yahoo.short', 'fetch_exception', { ticker, error: err });
      return base;
    }
  }
  return base;
}

// ── Market-cap band helpers ───────────────────────────────────────────────────
export type MarketCapBand = 'titan' | 'mega' | 'large' | 'mid' | 'small';

/** Classify a raw USD market cap into a band matching the UI filter buckets. */
export function marketCapToBand(rawUsd: number | null | undefined): MarketCapBand | null {
  if (rawUsd == null || !Number.isFinite(rawUsd) || rawUsd <= 0) return null;
  if (rawUsd >= 1_000_000_000_000) return 'titan';   // $1T+
  if (rawUsd >= 200_000_000_000)   return 'mega';    // $200B+
  if (rawUsd >= 10_000_000_000)    return 'large';   // $10B+
  if (rawUsd >= 2_000_000_000)     return 'mid';     // $2B+
  return 'small';
}

export interface YFMarketCap {
  ticker: string;
  marketCap: number | null;  // raw USD (may be native currency for non-US listings)
  band: MarketCapBand | null;
  currency?: string;
}

/**
 * Batch-fetch market caps via v7/quote (crumb-authenticated).
 * Returns per-ticker marketCap and pre-computed band. Missing tickers → null band.
 *
 * Chunked at 40 symbols per request; v7/quote supports many but URL length and
 * occasional per-symbol 403s scale with batch size.
 */
export async function fetchYFMarketCaps(tickers: string[]): Promise<YFMarketCap[]> {
  const unique = Array.from(new Set(tickers.filter(Boolean)));
  if (!unique.length) return [];
  const BATCH = 40;
  const out: YFMarketCap[] = [];

  for (let i = 0; i < unique.length; i += BATCH) {
    const slice = unique.slice(i, i + BATCH);
    let got = false;

    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      const creds = await getYFCreds(attempt > 0);
      if (!creds) {
        logger.warn('yahoo.mcap', 'no_creds', { batchIndex: i, attempt });
        break;
      }
      try {
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(slice.join(','))}&crumb=${encodeURIComponent(creds.crumb)}`;
        const res = await fetch(url, {
          headers: { ...YF_HEADERS, Cookie: creds.cookie },
          cache: 'no-store',
          signal: AbortSignal.timeout(12000),
        });
        if (res.status === 401 || res.status === 403) {
          logger.warn('yahoo.mcap', 'crumb_rejected', { batchIndex: i, status: res.status, attempt });
          yfCreds = null; continue;
        }
        if (!res.ok) {
          logger.warn('yahoo.mcap', 'http_error', { batchIndex: i, status: res.status });
          break;
        }
        const json = await res.json();
        const results = json.quoteResponse?.result ?? [];
        const byTicker = new Map<string, Record<string, unknown>>();
        for (const r of results) {
          const sym = r?.symbol as string | undefined;
          if (sym) byTicker.set(sym, r);
        }
        for (const t of slice) {
          const r = byTicker.get(t);
          const mcap = (r?.marketCap as number | undefined) ?? null;
          const currency = r?.currency as string | undefined;
          // Yahoo reports marketCap in the LISTING currency, not USD.
          // For non-USD listings (e.g. 005930.KS in KRW), skip band
          // classification and let the caller fall back to static data
          // rather than silently misclassify.
          const band = currency && currency !== 'USD'
            ? null
            : marketCapToBand(mcap);
          out.push({ ticker: t, marketCap: mcap, band, currency });
        }
        got = true;
      } catch (err) {
        logger.error('yahoo.mcap', 'fetch_exception', { batchIndex: i, error: err });
        break;
      }
    }

    if (!got) {
      logger.warn('yahoo.mcap', 'batch_fallback_to_null', { batchIndex: i, size: slice.length, message: 'returning null band for entire batch' });
      for (const t of slice) out.push({ ticker: t, marketCap: null, band: null });
    }
  }
  return out;
}

/** Fetch short interest for many tickers (batched to avoid rate limiting). */
export async function fetchBatchShortData(
  tickers: string[],
  delayMs = 200
): Promise<YFShortData[]> {
  const results: YFShortData[] = [];
  const BATCH = 5;

  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    const batchResults = await Promise.allSettled(batch.map(t => fetchYFShortData(t)));
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
    if (i + BATCH < tickers.length) {
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
  return results;
}
