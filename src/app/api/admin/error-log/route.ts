/**
 * /api/admin/error-log
 *
 * 투자전략 생성 중 발생한 오류를 locale/session/type별로 집계해서 반환.
 * Redis `flowvium:error-log:recent` 리스트에서 읽음 (최대 200개, 7일 TTL).
 *
 * GET /api/admin/error-log
 *   ?locale=ko       — 특정 locale 필터
 *   ?type=quality_gate_failed  — 오류 유형 필터
 *   ?limit=50        — 반환 개수 (기본 100)
 *   Headers: x-admin-secret: <CRON_SECRET>
 *
 * DELETE /api/admin/error-log  → 전체 초기화
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const dynamic = 'force-dynamic';

interface ErrorEntry {
  ts: string;
  locale: string;
  session: string;
  type: string;
  [key: string]: unknown;
}

const ERROR_LOG_KEY = 'flowvium:error-log:recent';

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? new Redis({ url, token }) : null;
}

function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  return req.headers.get('x-admin-secret') === secret;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis not configured' }, { status: 503 });

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10)));
  const localeFilter = url.searchParams.get('locale');
  const typeFilter = url.searchParams.get('type');

  const raw = await redis.lrange(ERROR_LOG_KEY, 0, 199);
  const entries: ErrorEntry[] = raw
    .map(item => {
      try { return JSON.parse(typeof item === 'string' ? item : JSON.stringify(item)) as ErrorEntry; }
      catch { return null; }
    })
    .filter((e): e is ErrorEntry => e !== null);

  const filtered = entries
    .filter(e => !localeFilter || e.locale === localeFilter)
    .filter(e => !typeFilter || e.type === typeFilter)
    .slice(0, limit);

  // 집계: 오류 유형별
  const byType: Record<string, number> = {};
  for (const e of entries) byType[e.type] = (byType[e.type] ?? 0) + 1;

  // 집계: locale별
  const byLocale: Record<string, { total: number; types: Record<string, number>; lastSeen: string }> = {};
  for (const e of entries) {
    const l = byLocale[e.locale] ?? { total: 0, types: {}, lastSeen: e.ts };
    l.total++;
    l.types[e.type] = (l.types[e.type] ?? 0) + 1;
    if (e.ts > l.lastSeen) l.lastSeen = e.ts;
    byLocale[e.locale] = l;
  }

  // 집계: session별
  const bySession: Record<string, number> = {};
  for (const e of entries) bySession[e.session] = (bySession[e.session] ?? 0) + 1;

  // 최근 24h 오류만 따로 카운트
  const cutoff24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recent24h = entries.filter(e => e.ts >= cutoff24h).length;

  return NextResponse.json({
    total: entries.length,
    recent24h,
    filtered: filtered.length,
    byType,
    byLocale,
    bySession,
    entries: filtered,
  });
}

export async function DELETE(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis not configured' }, { status: 503 });
  await redis.del(ERROR_LOG_KEY);
  return NextResponse.json({ cleared: true });
}
