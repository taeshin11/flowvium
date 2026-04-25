import { NextResponse } from 'next/server';
import { createMemoryCache } from '@/lib/memory-cache';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min
const mem = createMemoryCache<object>('stock-price', CACHE_TTL_MS);
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=60' };

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  const sym = params.ticker.toUpperCase();

  const cached = mem.get(sym);
  if (cached) return NextResponse.json({ ...cached, cached: true }, { headers: CDN_HEADERS });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);

    const data = await res.json();
    const chartResult = data?.chart?.result?.[0];
    const meta = chartResult?.meta;
    if (!meta) throw new Error('No meta data');

    const price: number | null = meta.regularMarketPrice ?? null;
    // meta.previousClose is null in Yahoo v8; chartPreviousClose = start-of-range close (5 days ago).
    // Use validCloses[length-2] for actual daily previous-day close.
    const allCloses: (number | null)[] = chartResult?.indicators?.quote?.[0]?.close ?? [];
    const validCloses = allCloses.filter((c): c is number => c != null && !isNaN(c));
    const prevClose: number | null = validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null;
    const change = price != null && prevClose != null ? parseFloat((price - prevClose).toFixed(2)) : null;
    const changePct = price != null && prevClose != null && prevClose > 0
      ? parseFloat(((price - prevClose) / prevClose * 100).toFixed(2))
      : null;

    const volume: number | null = typeof meta.regularMarketVolume === 'number' ? meta.regularMarketVolume : null;
    const dayHigh: number | null = meta.regularMarketDayHigh ?? null;
    const dayLow: number | null = meta.regularMarketDayLow ?? null;
    const week52High: number | null = meta.fiftyTwoWeekHigh ?? null;
    const week52Low: number | null = meta.fiftyTwoWeekLow ?? null;

    const result = {
      ticker: sym,
      price,
      prevClose,
      change,
      changePct,
      volume,
      dayHigh,
      dayLow,
      week52High,
      week52Low,
      currency: meta.currency ?? 'USD',
      marketState: meta.marketState ?? null,
      updatedAt: new Date().toISOString(),
      cached: false,
    };

    mem.set(sym, result);
    return NextResponse.json(result, { headers: CDN_HEADERS });
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to fetch price', details: String(e) },
      { status: 502 }
    );
  }
}
