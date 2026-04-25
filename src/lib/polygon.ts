/**
 * src/lib/polygon.ts
 *
 * Polygon.io integration — block trade detection via the trades endpoint.
 * Requires POLYGON_KEY env (Starter $29/mo = 15-min delayed; Advanced $199 = realtime).
 * When absent, fetchers return [] and the UI shows a "locked" state.
 */

import { logger } from './logger';

export interface BlockTrade {
  id: string;
  timestamp: string;       // ISO
  ticker: string;
  size: number;            // shares
  price: number;
  valueUsd: number;
  exchange: string | null;
  conditions: number[];
}

export function polygonKey(): string | null {
  return process.env.POLYGON_KEY?.trim() || null;
}

const PG_BASE = 'https://api.polygon.io';

/**
 * Fetch today's trades for a ticker and filter to block-sized trades
 * (>= minShares, default 10,000). Polygon returns trades in descending order.
 *
 * Endpoint: /v3/trades/{ticker}?timestamp.gte=YYYY-MM-DD
 */
export async function fetchBlockTrades(ticker: string, minShares = 10_000, maxPages = 2): Promise<BlockTrade[]> {
  const key = polygonKey();
  if (!key) return [];
  const today = new Date().toISOString().slice(0, 10);
  const out: BlockTrade[] = [];
  let url: string | null = `${PG_BASE}/v3/trades/${encodeURIComponent(ticker)}?timestamp.gte=${today}&limit=1000&order=desc&apiKey=${key}`;
  let pages = 0;
  while (url && pages < maxPages) {
    try {
      const res: Response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        logger.warn('polygon.trades', 'http_error', { ticker, status: res.status, page: pages });
        break;
      }
      const json: Record<string, unknown> = await res.json();
      const results = ((json?.results as unknown[]) ?? []) as Array<Record<string, unknown>>;
      for (const r of results) {
        const size = Number(r.size);
        if (!Number.isFinite(size) || size < minShares) continue;
        const price = Number(r.price);
        const ns = r.participant_timestamp as number ?? r.sip_timestamp as number ?? 0;
        const ts = ns ? new Date(Number(ns) / 1e6).toISOString() : new Date().toISOString();
        out.push({
          id: `${ticker}-${r.id ?? ts}`,
          timestamp: ts,
          ticker,
          size,
          price,
          valueUsd: Math.round(size * price),
          exchange: r.exchange != null ? String(r.exchange) : null,
          conditions: (r.conditions as number[]) ?? [],
        });
      }
      const nextUrl = json?.next_url as string | undefined;
      url = nextUrl ? `${nextUrl}&apiKey=${key}` : null;
      pages++;
    } catch (err) {
      logger.error('polygon.trades', 'fetch_exception', { ticker, page: pages, error: err });
      break;
    }
  }
  return out;
}

/** Batch: fetch block trades across multiple tickers in parallel. */
export async function fetchBlockTradesForTickers(tickers: string[], minShares = 10_000): Promise<BlockTrade[]> {
  if (!polygonKey() || !tickers.length) return [];
  const BATCH = 5;
  const batches: string[][] = [];
  for (let i = 0; i < tickers.length; i += BATCH) batches.push(tickers.slice(i, i + BATCH));
  const batchResults = await Promise.all(
    batches.map(batch => Promise.allSettled(batch.map(t => fetchBlockTrades(t, minShares, 1))))
  );
  const out: BlockTrade[] = [];
  for (const results of batchResults) {
    for (const r of results) {
      if (r.status === 'fulfilled') out.push(...r.value);
    }
  }
  return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
