/**
 * Naver Finance public polling API — Korean stocks (KOSPI/KOSDAQ).
 * Endpoint: https://polling.finance.naver.com/api/realtime/domestic/stock/{codes}
 * Supports comma-separated batch (50+ codes per request, no auth required).
 * Used as primary KR price source since Yahoo v8 is blocked on Vercel cloud IPs
 * and Stooq returns N/D for .kr suffix.
 */

export interface NaverKRQuote {
  symbol: string;   // 6-digit Korean stock code
  close: number | null;
  changePct: number | null;
}

const BATCH_SIZE = 50;

export async function fetchNaverKRQuotes(tickers: string[]): Promise<NaverKRQuote[]> {
  if (!tickers.length) return [];
  const out: NaverKRQuote[] = [];

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    try {
      const codes = batch.join(',');
      const res = await fetch(
        `https://polling.finance.naver.com/api/realtime/domestic/stock/${codes}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
            'Referer': 'https://m.finance.naver.com/',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        }
      );
      if (!res.ok) continue;
      const data = await res.json() as { datas?: Array<{ itemCode: string; closePrice?: string; fluctuationsRatio?: string }> };
      for (const item of data.datas ?? []) {
        const close = item.closePrice ? parseFloat(item.closePrice.replace(/,/g, '')) : NaN;
        const changePct = item.fluctuationsRatio ? parseFloat(item.fluctuationsRatio) : NaN;
        out.push({
          symbol: item.itemCode,
          close: !isNaN(close) && close > 0 ? close : null,
          changePct: !isNaN(changePct) ? changePct : null,
        });
      }
    } catch { /* skip batch on error */ }
  }
  return out;
}
