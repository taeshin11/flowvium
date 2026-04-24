import { NextResponse } from 'next/server';
import { createMemoryCache } from '@/lib/memory-cache';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min
const mem = createMemoryCache<object>('stock-price', CACHE_TTL_MS);

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = ticker.toUpperCase();

  const cached = mem.get(sym);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);

    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('No meta data');

    const price: number | null = meta.regularMarketPrice ?? null;
    const prevClose: number | null = meta.previousClose ?? meta.chartPreviousClose ?? null;
    const change = price != null && prevClose != null ? parseFloat((price - prevClose).toFixed(2)) : null;
    const changePct = price != null && prevClose != null && prevClose !== 0
      ? parseFloat(((price - prevClose) / prevClose * 100).toFixed(2))
      : null;

    const result = {
      ticker: sym,
      price,
      prevClose,
      change,
      changePct,
      currency: meta.currency ?? 'USD',
      marketState: meta.marketState ?? null,
      updatedAt: new Date().toISOString(),
      cached: false,
    };

    mem.set(sym, result);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to fetch price', details: String(e) },
      { status: 502 }
    );
  }
}
