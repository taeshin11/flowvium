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
    const all = Object.values(hash).flatMap(v => {
      try { return [JSON.parse(v as string) as MetricRecord]; }
      catch { return []; }
    });
    // 2026-06-17 전수조사 B2: stale 부활 차단 — hset 병합이라 '이번 run 에 안 돈 probe' 의 직전 레코드가
    //   72h 남아 admin 에서 fresh 처럼 보이던 것(truncation 을 가리는 증폭기). verify-metrics 는 매 run 모든
    //   probe 에 동일 checkedAt 을 찍으므로, 최신 updatedAt 과 다른 레코드 = 이번에 누락된 probe → 제외.
    const latest = all.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), '');
    return latest ? all.filter(r => r.updatedAt === latest) : all;
  } catch { return []; }
}
