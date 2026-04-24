/**
 * /api/admin/metrics-db
 *
 * Returns the per-metric Redis hash populated by /api/cron/verify-metrics.
 * Each record includes the metric's last checked value + updatedAt timestamp.
 *
 * Protection: x-admin-secret (CRON_SECRET)
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { getAllMetrics } from '@/lib/metrics-db';

export const dynamic = 'force-dynamic';

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  return req.headers.get('x-admin-secret') === secret;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const redis = createRedis();
  if (!redis) return NextResponse.json({ error: 'Redis not configured' }, { status: 503 });

  const metrics = await getAllMetrics(redis);
  const sorted = metrics.sort((a, b) => a.group.localeCompare(b.group) || a.key.localeCompare(b.key));

  const byStatus = {
    ok: sorted.filter(m => m.status === 'ok').length,
    degraded: sorted.filter(m => m.status === 'degraded').length,
    error: sorted.filter(m => m.status === 'error').length,
    skipped: sorted.filter(m => m.status === 'skipped').length,
  };

  return NextResponse.json({
    metrics: sorted,
    count: sorted.length,
    byStatus,
    fetchedAt: new Date().toISOString(),
  });
}
