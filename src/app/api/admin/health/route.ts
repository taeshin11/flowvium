/**
 * /api/admin/health
 *
 * Deployment health + write-path snapshot. Shows:
 *   - which commit/deployment is actually serving right now
 *   - Redis connectivity + key counts for each major cache
 *   - API-key configuration status (UW / Polygon / Gemini etc.)
 *   - recent error count from the log buffer
 *
 * Protected by CRON_SECRET via x-admin-secret header (same as /api/admin/logs).
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { getRecentLogs, logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  return req.headers.get('x-admin-secret') === secret;
}

/** List of cache keys whose existence we probe as a liveness signal.
 *  NOTE: 버전 숫자 바뀌면 여기도 업데이트. 일부 키는 date/hour 변수가 들어가므로
 *  오늘자/이번시간 키를 동적으로 계산. */
function buildTrackedKeys(): string[] {
  const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const utcDate = new Date().toISOString().slice(0, 10);
  return [
    'flowvium:insider-trades:v1',
    'flowvium:ownership-alerts:v1',
    'flowvium:nport-holdings:v1',
    'flowvium:options-flow:v1',
    'flowvium:block-trades:v1',
    'flowvium:korea-flow:v4:4w',
    'flowvium:short-interest:v5',
    'flowvium:market-caps:v2',
    'flowvium:fg:v6:SPY',
    'flowvium:13f-signals:v1',
    'flowvium:capital-flows:v11:yahoo',
    'flowvium:capital-flows:v11:twelve',
    `flowvium:macro-indicators:v13:${kstDate}`,
    `flowvium:fedwatch:v2:${utcDate}`,
    `flowvium:credit-balance:v3:${utcDate}`,
    'flowvium:latest-updates:v3',
    'flowvium:market-movers:v1',
    'flowvium:sector-pe:v3',
  ];
}
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const start = Date.now();

  const redis = createRedis();
  const redisOk = redis != null;

  // 매 요청마다 빌드 — 일자/시간 key 변수가 최신 반영되어야 함
  const TRACKED_CACHE_KEYS = buildTrackedKeys();

  // Probe each tracked key: exists? + size
  const cacheStatus: Record<string, { exists: boolean; size?: number; error?: string }> = {};
  if (redis) {
    await Promise.all(TRACKED_CACHE_KEYS.map(async (key) => {
      try {
        const v = await redis.get(key);
        if (v == null) {
          cacheStatus[key] = { exists: false };
          return;
        }
        let size = 0;
        try { size = JSON.stringify(v).length; } catch { size = -1; }
        cacheStatus[key] = { exists: true, size };
      } catch (err) {
        cacheStatus[key] = { exists: false, error: err instanceof Error ? err.message : String(err) };
      }
    }));
  }

  // Log-buffer error counts
  const recentLogs = await getRecentLogs(500);
  const errorCount = recentLogs.filter(e => e.level === 'error').length;
  const warnCount = recentLogs.filter(e => e.level === 'warn').length;
  const sinceIso = recentLogs.length > 0 ? recentLogs[recentLogs.length - 1].t : null;

  // Paid-API config (without leaking keys)
  const paidApis = {
    unusualWhales: !!process.env.UNUSUAL_WHALES_KEY?.trim(),
    polygon: !!process.env.POLYGON_KEY?.trim(),
    twelveData: !!process.env.TWELVE_DATA_KEY?.trim(),
    alphaVantage: !!process.env.ALPHA_VANTAGE_KEY?.trim(),
    vllm: !!process.env.VLLM_URL?.trim(),
    finnhub: !!process.env.FINNHUB_KEY?.trim(),
  };

  const body = {
    ok: true,
    deploy: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? 'local',
      commitFull: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      url: process.env.VERCEL_URL ?? null,
      region: process.env.VERCEL_REGION ?? null,
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
      nodeVersion: process.version,
    },
    redis: {
      configured: redisOk,
      trackedCaches: cacheStatus,
      populatedCount: Object.values(cacheStatus).filter(c => c.exists).length,
      missingCount: Object.values(cacheStatus).filter(c => !c.exists).length,
    },
    paidApis,
    logs: {
      bufferCount: recentLogs.length,
      errorCount,
      warnCount,
      oldestInBuffer: sinceIso,
    },
    checkedAt: new Date().toISOString(),
    checkDurationMs: Date.now() - start,
  };

  logger.info('api.admin-health', 'probed', {
    redisOk, populatedCount: body.redis.populatedCount,
    missingCount: body.redis.missingCount, errorCount, warnCount,
  });

  return NextResponse.json(body);
}
