// Shared module-level memory caches for investment-strategy history.
// Both the main route and the history route import from here so they share
// the same in-process state (single Lambda warm instance).
//
// Purpose: survive Upstash daily command-limit exhaustion without losing
// the reports generated during the same instance lifetime.

import type { HistoryMeta } from '@/app/api/investment-strategy/history/route';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyReport = any;

const REPORT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days (same as Redis TTL)
const ARRAY_TTL_MS = 90 * 24 * 60 * 60 * 1000;  // 90 days

// Key → full report object with expiry
export const HIST_REPORT_MEM = new Map<string, { data: AnyReport; expiresAt: number }>();

// Cached history metadata array
export let HIST_ARRAY_MEM: { items: HistoryMeta[]; expiresAt: number } | null = null;

export function memSetReport(key: string, data: AnyReport): void {
  HIST_REPORT_MEM.set(key, { data, expiresAt: Date.now() + REPORT_TTL_MS });
}

export function memGetReport(key: string): AnyReport | null {
  const entry = HIST_REPORT_MEM.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { HIST_REPORT_MEM.delete(key); return null; }
  return entry.data;
}

export function memSetArray(items: HistoryMeta[]): void {
  HIST_ARRAY_MEM = { items, expiresAt: Date.now() + ARRAY_TTL_MS };
}

export function memGetArray(): HistoryMeta[] | null {
  if (!HIST_ARRAY_MEM) return null;
  if (Date.now() > HIST_ARRAY_MEM.expiresAt) { HIST_ARRAY_MEM = null; return null; }
  return HIST_ARRAY_MEM.items;
}
