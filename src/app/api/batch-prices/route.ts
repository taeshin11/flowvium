import { NextResponse } from 'next/server';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' };

interface PriceEntry { price: number | null; change: number | null; changePct: number | null; marketState: string | null; ret: number | null; }
type PriceMap = Record<string, PriceEntry>;

async function fetchFinnhubPrice(sym: string, key: string): Promise<PriceEntry> {
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`,
    { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000), cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  const d = await res.json() as { c?: number; d?: number; dp?: number };
  if (!d.c || d.c <= 0) throw new Error('no price');
  return {
    price: parseFloat(d.c.toFixed(2)),
    change: typeof d.d === 'number' ? parseFloat(d.d.toFixed(2)) : null,
    changePct: typeof d.dp === 'number' ? parseFloat(d.dp.toFixed(2)) : null,
    marketState: null,
    ret: null,
  };
}

const TICKER_CACHE = new Map<string, { entry: PriceEntry; expiresAt: number }>();
const TTL = 5 * 60 * 1000;
const YHDR = YAHOO_HEADERS;

// Bloomberg-style: use whatever available history to approximate period return
function computeRet(closes: (number | null)[], nDays: number): number | null {
  const valid = closes.filter((c): c is number => c != null && c > 0);
  if (valid.length < 2) return null;
  const current = valid[valid.length - 1];
  const past = valid.length > nDays ? valid[valid.length - 1 - nDays] : valid[0];
  if (!past || past <= 0) return null;
  return parseFloat(((current / past - 1) * 100).toFixed(2));
}

async function fetchV8(ticker: string, range = '5d'): Promise<PriceEntry> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`,
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
  const ret = range === '1mo' ? computeRet(valid, 5)
    : range === '3mo' ? computeRet(valid, 20)
    : null;
  return { price, change, changePct, marketState: meta?.marketState ?? null, ret };
}

// Batch period returns via Yahoo spark (one call for all tickers)
async function fetchSparkReturns(tickers: string[], period: '1w' | '4w'): Promise<Record<string, number | null>> {
  const range = period === '1w' ? '1mo' : '3mo';
  const nDays = period === '1w' ? 5 : 20;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(tickers.join(','))}&range=${range}&interval=1d`,
      { headers: YHDR, signal: AbortSignal.timeout(10000), cache: 'no-store' },
    );
    if (!res.ok) return {};
    const data = await res.json() as { spark?: { result?: Array<{ symbol?: string; response?: Array<{ indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> }> } };
    const out: Record<string, number | null> = {};
    for (const item of data?.spark?.result ?? []) {
      if (!item.symbol) continue;
      const closes = item.response?.[0]?.indicators?.quote?.[0]?.close ?? [];
      out[item.symbol] = computeRet(closes, nDays);
    }
    return out;
  } catch { return {}; }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const param = url.searchParams.get('tickers') ?? '';
  const periodParam = url.searchParams.get('period');
  const period = (periodParam === '1w' || periodParam === '4w') ? periodParam : null;
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
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(missing.join(','))}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,marketState`,
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
            ret: null,
          };
          prices[q.symbol] = entry;
          TICKER_CACHE.set(q.symbol, { entry, expiresAt });
        }
        v7Ok = true;
      }
    } catch { /* fall through to v8 */ }

    if (!v7Ok) {
      const expiresAt = now + TTL;
      // Try Yahoo v8 per-ticker in parallel
      const v8Results = await Promise.allSettled(
        missing.map(async ticker => ({ ticker, entry: await fetchV8(ticker) }))
      );
      const v8Failed: string[] = [];
      for (const r of v8Results) {
        if (r.status === 'fulfilled') {
          prices[r.value.ticker] = r.value.entry;
          TICKER_CACHE.set(r.value.ticker, { entry: r.value.entry, expiresAt });
        } else {
          v8Failed.push(missing[v8Results.indexOf(r)]);
        }
      }
      // Finnhub fallback for tickers still missing (max 30 — free tier 60 req/min)
      const fhKey = process.env.FINNHUB_KEY?.trim();
      if (fhKey && v8Failed.length) {
        const toFetch = v8Failed.slice(0, 30);
        const fhResults = await Promise.allSettled(
          toFetch.map(async ticker => ({ ticker, entry: await fetchFinnhubPrice(ticker, fhKey) }))
        );
        for (const r of fhResults) {
          if (r.status === 'fulfilled') {
            prices[r.value.ticker] = r.value.entry;
            TICKER_CACHE.set(r.value.ticker, { entry: r.value.entry, expiresAt });
          } else {
            const t = toFetch[fhResults.indexOf(r)];
            prices[t] = { price: null, change: null, changePct: null, marketState: null, ret: null };
          }
        }
      } else {
        for (const t of v8Failed) {
          prices[t] = { price: null, change: null, changePct: null, marketState: null, ret: null };
        }
      }
    }
  }

  // Period returns via Yahoo spark (one batch call for all tickers)
  if (period) {
    const sparkRets = await fetchSparkReturns(tickers, period);
    for (const ticker of tickers) {
      const entry = prices[ticker];
      if (entry) entry.ret = sparkRets[ticker] ?? null;
    }
  }

  return NextResponse.json({ prices }, { headers: CDN_HEADERS });
}
