/**
 * /api/admin/metrics-health
 *
 * /api/cron/verify-metrics 가 저장한 최근 스냅샷을 반환.
 * /admin/logs 페이지의 "Metrics Status" 카드에서 사용.
 *
 * 보호: x-admin-secret (CRON_SECRET)
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';

export const dynamic = 'force-dynamic';

const SNAPSHOT_KEY = 'flowvium:metrics-health:v1';

function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  return req.headers.get('x-admin-secret') === secret;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const redis = createRedis();
  if (!redis) {
    return NextResponse.json({ error: 'Redis not configured' }, { status: 503 });
  }

  const snapshot = await redis.get(SNAPSHOT_KEY);
  if (!snapshot) {
    return NextResponse.json({
      error: 'No snapshot available yet. Cron has not run or snapshot expired.',
      hint: 'Trigger /api/cron/verify-metrics with CRON_SECRET to populate.',
    }, { status: 404 });
  }

  return NextResponse.json(snapshot);
}
