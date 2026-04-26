/**
 * NSE India public equity index API — Indian stocks (NSE).
 * Endpoint: https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20500
 * Returns full NIFTY 500 constituent list with last price and % change.
 * No auth required (public index data feed).
 * Used as primary IN price source since Yahoo v8 is Vercel-blocked
 * and Stooq .in returns N/D.
 *
 * WARNING: NSE may block cloud (AWS/Vercel) IPs — Vercel accessibility unconfirmed.
 * On block, IN falls back to Yahoo v8 fallback (also blocked) → 0% coverage.
 */

export interface NSEIndiaQuote {
  symbol: string;
  close: number | null;
  changePct: number | null;
}

export async function fetchNSEIndiaQuotes(tickers: string[]): Promise<NSEIndiaQuote[]> {
  if (!tickers.length) return [];
  const tickerSet = new Set(tickers.map(t => t.toUpperCase()));

  try {
    const res = await fetch(
      'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20500',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'application/json',
          'Referer': 'https://www.nseindia.com/',
          'Origin': 'https://www.nseindia.com',
        },
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      }
    );
    if (!res.ok) return [];
    const data = await res.json() as {
      data?: Array<{ symbol: string; lastPrice?: number; pChange?: number }>;
    };
    const out: NSEIndiaQuote[] = [];
    for (const item of data.data ?? []) {
      const sym = item.symbol?.toUpperCase();
      if (!sym || !tickerSet.has(sym)) continue;
      const close = typeof item.lastPrice === 'number' && item.lastPrice > 0 ? item.lastPrice : null;
      const changePct = typeof item.pChange === 'number' ? parseFloat(item.pChange.toFixed(2)) : null;
      out.push({ symbol: sym, close, changePct });
    }
    return out;
  } catch {
    return [];
  }
}
