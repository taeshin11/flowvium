/**
 * Cron: /api/cron/refresh-market-caps
 *
 * 2026-05-26 사건: market-caps live request 시 Yahoo + Stooq 둘 다 throttle.
 * capsLive=0/30 → 24h 빈 캐시 → 사용자 페이지 멤 빈 시총.
 *
 * 매일 1x EDGAR 비슷한 시간 분리로 갱신 (live request 와 cron 시간 차이로 rate-limit 회피).
 * /api/market-caps?refresh=1 강제 호출 — internal endpoint 자체 로직 재사용.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  const isVercelCron = !!req.headers.get('x-vercel-cron');
  if (process.env.CRON_SECRET && !isVercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  // Self-fetch — market-caps?refresh=1 내부 호출 (Yahoo + Stooq cap chunk fetch)
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://flowvium.net';
  let result: { capsLive: number; capsTotal: number; source: string } | null = null;
  try {
    const res = await fetch(`${base}/api/market-caps?refresh=1`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(55000),
    });
    if (res.ok) {
      const j = await res.json();
      result = {
        capsLive: j.capsLive ?? 0,
        capsTotal: j.capsTotal ?? 0,
        source: j.source ?? 'unknown',
      };
    }
  } catch (e) {
    logger.error('cron.refresh-market-caps', 'fetch_failed', { error: String(e) });
  }

  const durationMs = Date.now() - start;
  if (!result || result.capsLive === 0) {
    logger.warn('cron.refresh-market-caps', 'empty', { result, durationMs });
    return NextResponse.json({
      ok: false,
      result,
      durationMs,
      note: 'Yahoo + Stooq throttle — prior cache 유지',
    });
  }
  logger.info('cron.refresh-market-caps', 'completed', { ...result, durationMs });
  return NextResponse.json({
    ok: true,
    ...result,
    durationMs,
    timestamp: new Date().toISOString(),
  });
}
