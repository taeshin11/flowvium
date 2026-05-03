/**
 * Naver Finance public polling API — Korean stocks (KOSPI/KOSDAQ).
 * Endpoint: https://polling.finance.naver.com/api/realtime/domestic/stock/{codes}
 * Supports comma-separated batch (50+ codes per request, no auth required).
 * Used as primary KR price source since Yahoo v8 is blocked on Vercel cloud IPs
 * and Stooq returns N/D for .kr suffix.
 *
 * TWSE + TPEX open APIs — Taiwan Stock Exchange + OTC.
 * Returns full day report for all listed stocks (no auth, free).
 * Used as primary TW price source for same reasons as above.
 */

export interface NaverKRQuote {
  symbol: string;   // 6-digit Korean stock code
  close: number | null;
  changePct: number | null;
}

export interface TWSEQuote {
  symbol: string;   // 4-digit Taiwan stock code
  close: number | null;
  changePct: number | null;
}

const BATCH_SIZE = 50;

const NAVER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  'Referer': 'https://m.finance.naver.com/',
  'Accept': 'application/json',
};

async function fetchNaverBatch(codes: string): Promise<Array<{ itemCode: string; closePrice?: string; fluctuationsRatio?: string }>> {
  const res = await fetch(
    `https://polling.finance.naver.com/api/realtime/domestic/stock/${codes}`,
    { headers: NAVER_HEADERS, signal: AbortSignal.timeout(8000), cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Naver HTTP ${res.status}`);
  const data = await res.json() as { datas?: Array<{ itemCode: string; closePrice?: string; fluctuationsRatio?: string }> };
  return data.datas ?? [];
}

export async function fetchNaverKRQuotes(tickers: string[]): Promise<NaverKRQuote[]> {
  if (!tickers.length) return [];
  const out: NaverKRQuote[] = [];

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const codes = batch.join(',');
    let items: Array<{ itemCode: string; closePrice?: string; fluctuationsRatio?: string }> = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        items = await fetchNaverBatch(codes);
        break;
      } catch {
        if (attempt < 1) await new Promise(r => setTimeout(r, 800));
      }
    }
    for (const item of items) {
      const close = item.closePrice ? parseFloat(item.closePrice.replace(/,/g, '')) : NaN;
      const changePct = item.fluctuationsRatio ? parseFloat(item.fluctuationsRatio) : NaN;
      out.push({
        symbol: item.itemCode,
        close: !isNaN(close) && close > 0 ? close : null,
        changePct: !isNaN(changePct) ? changePct : null,
      });
    }
  }
  return out;
}

/** Build TWSE/TPEX quote from a full-day report row. Change is absolute price delta. */
function twseRowToQuote(code: string, closingStr: string, changeStr: string): TWSEQuote | null {
  const close = parseFloat(closingStr.replace(/,/g, ''));
  const change = parseFloat(changeStr.replace(/,/g, ''));
  if (isNaN(close) || close <= 0) return null;
  const prevClose = close - change;
  const changePct = prevClose > 0 ? parseFloat(((change / prevClose) * 100).toFixed(2)) : null;
  return { symbol: code, close, changePct };
}

/**
 * Fetch Taiwan stock prices from TWSE (main board) + TPEX (OTC) open APIs.
 * Both return a full daily report for all listed stocks — one HTTP call each.
 * tickers: iShares EWT codes (4-digit, e.g. "2330" for TSMC).
 */
export async function fetchTWSEQuotes(tickers: string[]): Promise<TWSEQuote[]> {
  if (!tickers.length) return [];
  const tickerSet = new Set(tickers.map(t => t.toUpperCase()));
  const priceMap = new Map<string, TWSEQuote>();

  const [twseRes, tpexRes] = await Promise.allSettled([
    fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    }),
    fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    }),
  ]);

  // TWSE: { Code, ClosingPrice, Change }
  if (twseRes.status === 'fulfilled' && twseRes.value.ok) {
    const rows = await twseRes.value.json() as Array<{ Code: string; ClosingPrice: string; Change: string }>;
    for (const row of rows) {
      const code = row.Code?.toUpperCase();
      if (!tickerSet.has(code)) continue;
      const q = twseRowToQuote(code, row.ClosingPrice ?? '', row.Change ?? '');
      if (q) priceMap.set(code, q);
    }
  }

  // TPEX: { SecuritiesCompanyCode, Close, Change }
  if (tpexRes.status === 'fulfilled' && tpexRes.value.ok) {
    const rows = await tpexRes.value.json() as Array<{ SecuritiesCompanyCode: string; Close: string; Change: string }>;
    for (const row of rows) {
      const code = row.SecuritiesCompanyCode?.toUpperCase();
      if (!tickerSet.has(code) || priceMap.has(code)) continue;
      const q = twseRowToQuote(code, row.Close ?? '', row.Change ?? '');
      if (q) priceMap.set(code, q);
    }
  }

  return Array.from(priceMap.values());
}
