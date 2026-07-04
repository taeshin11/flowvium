/**
 * /api/client-log — 프런트(브라우저) 에러 수집 (2026-07-04 신설)
 *
 * 갭: 서버/파이프라인 로그는 촘촘하나 *실사용자 브라우저*의 렌더 예외·unhandledrejection·리소스 실패는
 * 수집 파이프가 없어 서버가 몰랐다(6h audit-pages 는 우리 브라우저만 봄). ClientErrorReporter 가
 * sendBeacon 으로 POST → Redis ring(최근 500, 7d) + logger.warn. 모니터(cron-runner)가 GET count 소비.
 *
 * 남용 방어: IP 분당 10건 rate-limit, 본문 2KB 컷, 메시지/스택 트렁케이트. PII 없음(메시지·url·ua 만).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const KEY = 'flowvium:client-errors:v1';
const TTL = 7 * 86400;

export async function POST(req: NextRequest) {
  const redis = createRedis();
  if (!redis) return NextResponse.json({ ok: false }, { status: 503 });
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rlKey = `flowvium:client-errors:rl:${ip}`;
    const n = await redis.incr(rlKey);
    if (n === 1) await redis.expire(rlKey, 60);
    if (n > 10) return NextResponse.json({ ok: false, rateLimited: true }, { status: 429 });

    const raw = await req.text();
    if (raw.length > 2048) return NextResponse.json({ ok: false }, { status: 413 });
    const b = JSON.parse(raw) as Record<string, unknown>;
    const entry = {
      ts: new Date().toISOString(),
      type: String(b.type ?? 'error').slice(0, 32),           // error | unhandledrejection | boundary
      message: String(b.message ?? '').slice(0, 300),
      stack: String(b.stack ?? '').slice(0, 500),
      url: String(b.url ?? '').slice(0, 200),
      ua: (req.headers.get('user-agent') ?? '').slice(0, 120),
    };
    if (!entry.message) return NextResponse.json({ ok: false }, { status: 400 });
    await redis.lpush(KEY, JSON.stringify(entry));
    await redis.ltrim(KEY, 0, 499);
    await redis.expire(KEY, TTL);
    logger.warn('client-log', 'browser_error', { type: entry.type, message: entry.message.slice(0, 120), url: entry.url });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 80) }, { status: 400 });
  }
}

// 모니터 소비용 — CRON_SECRET 보호. ?sinceMin=25 → 최근 N분 건수 + 샘플.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const redis = createRedis();
  if (!redis) return NextResponse.json({ count: 0, samples: [] });
  const sinceMin = Math.max(1, Math.min(24 * 60, parseInt(req.nextUrl.searchParams.get('sinceMin') ?? '25', 10) || 25));
  const cutoff = new Date(Date.now() - sinceMin * 60000).toISOString();
  const raw = (await redis.lrange(KEY, 0, 199)) as unknown[];
  const entries = raw.map((r) => { try { return typeof r === 'string' ? JSON.parse(r) : r; } catch { return null; } })
    .filter((e): e is { ts: string; type: string; message: string; url: string } => !!e && typeof e.ts === 'string')
    .filter((e) => e.ts >= cutoff);
  return NextResponse.json({
    count: entries.length, sinceMin,
    samples: entries.slice(0, 5).map((e) => ({ ts: e.ts, type: e.type, message: e.message.slice(0, 100), url: e.url })),
  });
}
