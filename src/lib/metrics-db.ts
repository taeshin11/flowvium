/**
 * Metrics Database — per-metric Redis hash for live value tracking.
 * Written by verify-metrics cron; readable from /api/admin/metrics-db.
 *
 * Hash key: flowvium:mdb:v1
 * Field: metric key (e.g. 'fg.country.us')
 * Value: JSON-encoded MetricRecord
 */
import type { Redis } from '@upstash/redis';

export interface MetricRecord {
  key: string;
  label: string;
  group: string;
  status: 'ok' | 'degraded' | 'error' | 'skipped';
  value?: string | number | null;
  source?: string;
  updatedAt: string;
  lastError?: string;
  skipReason?: string;
}

export const MDB_HASH_KEY = 'flowvium:mdb:v1';
const MDB_TTL = 72 * 3600; // 72h — covers weekend gaps

export async function logMetrics(
  redis: Redis,
  items: Omit<MetricRecord, 'updatedAt'>[],
  checkedAt: string,
): Promise<void> {
  if (!items.length) return;
  const toSet: Record<string, string> = {};
  for (const item of items) {
    toSet[item.key] = JSON.stringify({ ...item, updatedAt: checkedAt } as MetricRecord);
  }
  try {
    await redis.hset(MDB_HASH_KEY, toSet);
    await redis.expire(MDB_HASH_KEY, MDB_TTL);
  } catch { /* non-fatal — monitoring must not break production */ }
}

export async function getAllMetrics(redis: Redis): Promise<MetricRecord[]> {
  try {
    const hash = await redis.hgetall(MDB_HASH_KEY);
    if (!hash) return [];
    return Object.values(hash).flatMap(v => {
      try { return [JSON.parse(v as string) as MetricRecord]; }
      catch { return []; }
    });
  } catch { return []; }
}
