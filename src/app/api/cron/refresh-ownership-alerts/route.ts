/**
 * Cron: /api/cron/refresh-ownership-alerts
 *
 * 2026-05-25 사건: ownership-alerts 가 Vercel 환경에서 0 items 자주 반환
 * → SEC EFTS 동시 호출 시 rate-limit 추정 (live request 와 cron 분리하여 회피).
 *
 * 매일 1x EDGAR 13D/13G pull → Redis 24h 캐시. live request 가 0건 받아도
 * prior 캐시로 polite fallback (stale 라도 user 가시).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { fetchRecentOwnershipAlerts } from '@/lib/edgar-insider';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_KEY = 'flowvium:ownership-alerts:v1';
const CACHE_TTL = 24 * 60 * 60; // 24h — cron 하루 1x 갱신

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  const isVercelCron = !!req.headers.get('x-vercel-cron');
  if (process.env.CRON_SECRET && !isVercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const redis = createRedis();
  const alerts = await fetchRecentOwnershipAlerts({ minPercent: 5 });

  if (alerts.length === 0) {
    logger.warn('cron.refresh-ownership-alerts', 'empty_fetch', { message: 'EDGAR 응답 0건 — 기존 캐시 유지' });
    return NextResponse.json({
      ok: false,
      source: 'empty',
      alertsCount: 0,
      note: 'EDGAR returned 0 items — prior cache preserved',
      durationMs: Date.now() - start,
    });
  }

  if (redis) {
    await loggedRedisSet(redis, 'cron.refresh-ownership-alerts', CACHE_KEY, alerts, { ex: CACHE_TTL });
  }
  logger.info('cron.refresh-ownership-alerts', 'completed', {
    alertsCount: alerts.length,
    durationMs: Date.now() - start,
    source: 'edgar-13dg',
  });

  return NextResponse.json({
    ok: true,
    source: 'edgar-13dg',
    alertsCount: alerts.length,
    durationMs: Date.now() - start,
    sample: alerts.slice(0, 5).map(a => ({
      ticker: a.ticker,
      issuerName: a.issuerName,
      formType: a.formType,
      filedAt: a.filedAt,
      percentOwned: a.percentOwned,
    })),
    timestamp: new Date().toISOString(),
  });
}
