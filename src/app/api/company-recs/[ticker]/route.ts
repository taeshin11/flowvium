import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' };
const YHDR = { 'User-Agent': 'Mozilla/5.0' };

export interface RecEntry {
  symbol: string;
  score: number;
  price: number | null;
  changePct: number | null;
}

export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();

  let recommended: { symbol: string; score: number }[] = [];
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v6/finance/recommendationsbysymbol/${ticker}`,
      { headers: YHDR, signal: AbortSignal.timeout(8000), cache: 'no-store' },
    );
    if (res.ok) {
      const data = await res.json();
      recommended = data?.finance?.result?.[0]?.recommendedSymbols ?? [];
    }
  } catch { /* return empty on network error */ }

  if (!recommended.length) return NextResponse.json({ recs: [] }, { headers: CDN_HEADERS });

  const symbols = recommended.slice(0, 5).map((r) => r.symbol);
  const prices: Record<string, { price: number | null; changePct: number | null }> = {};

  try {
    const priceRes = await fetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}&fields=regularMarketPrice,regularMarketChangePercent`,
      { headers: YHDR, signal: AbortSignal.timeout(8000), cache: 'no-store' },
    );
    if (priceRes.ok) {
      const priceData = await priceRes.json();
      for (const q of priceData?.quoteResponse?.result ?? []) {
        prices[q.symbol] = {
          price: q.regularMarketPrice ?? null,
          changePct: q.regularMarketChangePercent ?? null,
        };
      }
    }
  } catch { /* prices stay null */ }

  const recs: RecEntry[] = symbols.map((sym) => ({
    symbol: sym,
    score: recommended.find((r) => r.symbol === sym)?.score ?? 0,
    price: prices[sym]?.price ?? null,
    changePct: prices[sym]?.changePct ?? null,
  }));

  return NextResponse.json({ recs }, { headers: CDN_HEADERS });
}
