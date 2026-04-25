import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' };

interface PriceEntry { price: number | null; change: number | null; changePct: number | null; marketState: string | null; }
type PriceMap = Record<string, PriceEntry>;

const TICKER_CACHE = new Map<string, { entry: PriceEntry; expiresAt: number }>();
const TTL = 5 * 60 * 1000;
const YHDR = { 'User-Agent': 'Mozilla/5.0' };

async function fetchV8(ticker: string): Promise<PriceEntry> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
    { headers: YHDR, signal: AbortSignal.timeout(8000), cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  const price: number | null = meta?.regularMarketPrice ?? null;
  const allCloses: (number | null)[] = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const valid = allCloses.filter((c): c is number => c != null && !isNaN(c));
  const prev = valid.length >= 2 ? valid[valid.length - 2] : null;
  const change = price != null && prev != null ? parseFloat((price - prev).toFixed(2)) : null;
  const changePct = price != null && prev != null && prev > 0
    ? parseFloat(((price - prev) / prev * 100).toFixed(2)) : null;
  return { price, change, changePct, marketState: meta?.marketState ?? null };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const param = url.searchParams.get('tickers') ?? '';
  const tickers = Array.from(new Set(
    param.split(',').map(t => t.trim().toUpperCase()).filter(t => /^[A-Z0-9.\-]{1,10}$/.test(t))
  )).sort().slice(0, 120);

  if (!tickers.length) return NextResponse.json({ prices: {} });

  const now = Date.now();
  const prices: PriceMap = {};
  const missing: string[] = [];

  for (const t of tickers) {
    const hit = TICKER_CACHE.get(t);
    if (hit && now < hit.expiresAt) prices[t] = hit.entry;
    else missing.push(t);
  }

  if (missing.length) {
    // Try Yahoo v7 batch first (1 call for all); fall back to v8 parallel if blocked
    let v7Ok = false;
    try {
      const res = await fetch(
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(missing.join(','))}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent`,
        { headers: YHDR, signal: AbortSignal.timeout(10000), cache: 'no-store' },
      );
      if (res.ok) {
        const data = await res.json();
        const expiresAt = now + TTL;
        for (const q of (data?.quoteResponse?.result ?? []) as any[]) {
          const entry: PriceEntry = {
            price: q.regularMarketPrice ?? null,
            change: q.regularMarketChange ?? null,
            changePct: q.regularMarketChangePercent ?? null,
            marketState: q.marketState ?? null,
          };
          prices[q.symbol] = entry;
          TICKER_CACHE.set(q.symbol, { entry, expiresAt });
        }
        v7Ok = true;
      }
    } catch { /* fall through to v8 */ }

    if (!v7Ok) {
      const expiresAt = now + TTL;
      await Promise.allSettled(
        missing.map(async ticker => {
          try {
            const entry = await fetchV8(ticker);
            prices[ticker] = entry;
            TICKER_CACHE.set(ticker, { entry, expiresAt });
          } catch {
            prices[ticker] = { price: null, change: null, changePct: null, marketState: null };
          }
        })
      );
    }
  }

  return NextResponse.json({ prices }, { headers: CDN_HEADERS });
}
