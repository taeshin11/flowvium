/**
 * Yahoo Finance helpers — server-side only.
 * v8/chart (no auth) for non-US heatmap quotes.
 * CNBC public API for US sector ETF prices.
 *
 * Note: Yahoo v7/v10 crumb auth fails from Vercel IPs.
 * All crumb-dependent functions removed.
 */
import { logger } from './logger';

export interface YFHeatmapQuote {
  symbol: string;
  changePct: number | null;
  close: number | null;
}

/**
 * Fetch non-US heatmap quotes via Yahoo v8/chart query1 only, with conservative
 * concurrency (5 parallel, 250ms delay) — proven approach from korea-flow.
 * Uses simple UA to avoid bot detection; symbol → ticker map for lookup normalization.
 */
export async function fetchYFNonUSQuotes(
  symbolMap: Map<string, string>  // yahooSymbol (e.g. '005930.KS') → originalTicker
): Promise<YFHeatmapQuote[]> {
  if (!symbolMap.size) return [];
  const entries = Array.from(symbolMap.entries());
  const CONCURRENT = 5;
  const DELAY_MS = 250;
  const out: YFHeatmapQuote[] = [];

  for (let i = 0; i < entries.length; i += CONCURRENT) {
    const batch = entries.slice(i, i + CONCURRENT);
    const settled = await Promise.allSettled(
      batch.map(async ([yahoSym, origTicker]) => {
        try {
          const res = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoSym)}?interval=1d&range=2d`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(8000) }
          );
          if (!res.ok) return null;
          const json = await res.json();
          const chartRes = json?.chart?.result?.[0];
          const meta = chartRes?.meta;
          if (!meta) return null;
          const price = meta.regularMarketPrice as number | undefined;
          // chartPreviousClose = close before start of range (2+ days ago), not yesterday.
          // Use validCloses[-2] for actual daily changePct; chartPreviousClose as last resort.
          const allCloses: (number | null)[] = chartRes?.indicators?.quote?.[0]?.close ?? [];
          const validCloses = allCloses.filter((c): c is number => c != null && !isNaN(c));
          const prevClose = validCloses.length >= 2
            ? validCloses[validCloses.length - 2]
            : (meta.chartPreviousClose as number | undefined);
          const changePct = price != null && prevClose != null && prevClose > 0
            ? ((price - prevClose) / prevClose) * 100
            : null;
          return { symbol: origTicker, changePct: changePct != null ? parseFloat(changePct.toFixed(2)) : null, close: price ?? null } as YFHeatmapQuote;
        } catch { return null; }
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) out.push(r.value);
    }
    if (i + CONCURRENT < entries.length) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    }
  }
  logger.info('yahoo.nonUS', 'batch_done', { requested: symbolMap.size, returned: out.length });
  return out;
}

/**
 * Fetch quotes via CNBC public API — reliable from Vercel IPs where Yahoo is blocked.
 * symbols: pipe-delimited, e.g. "SPY|QQQ|IWM"
 */
export async function fetchCNBCQuotes(tickers: string[]): Promise<YFHeatmapQuote[]> {
  if (!tickers.length) return [];
  try {
    const symbols = tickers.join('|');
    const url = `https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols=${encodeURIComponent(symbols)}&output=json`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://www.cnbc.com',
        'Referer': 'https://www.cnbc.com/markets/',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      logger.warn('cnbc.quotes', 'http_error', { status: res.status, tickers });
      return [];
    }
    const json = await res.json();
    let quotes = json.QuickQuoteResult?.QuickQuote ?? [];
    if (!Array.isArray(quotes)) quotes = [quotes];
    const out: YFHeatmapQuote[] = [];
    for (const q of quotes) {
      const sym = q?.symbol;
      const last = parseFloat(q?.last ?? '');
      const pct = parseFloat(q?.change_pct ?? '');
      if (sym && !isNaN(last)) {
        out.push({ symbol: sym, close: last, changePct: !isNaN(pct) ? parseFloat(pct.toFixed(2)) : null });
      }
    }
    logger.info('cnbc.quotes', 'done', { requested: tickers.length, returned: out.length });
    return out;
  } catch (err) {
    logger.error('cnbc.quotes', 'fetch_error', { error: err, tickers });
    return [];
  }
}

// ── Market-cap band type ──────────────────────────────────────────────────────
export type MarketCapBand = 'titan' | 'mega' | 'large' | 'mid' | 'small';
