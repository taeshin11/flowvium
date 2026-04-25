/**
 * /api/admin/logs
 *
 * Returns the recent Redis log buffer (warn+error entries) for in-app
 * debugging without needing Vercel dashboard access. Protected by
 * CRON_SECRET header so only the site owner can read it.
 *
 *   GET /api/admin/logs?limit=200&level=error
 *     Headers: x-admin-secret: <CRON_SECRET>
 *   DELETE /api/admin/logs   → clear buffer
 *     Headers: x-admin-secret: <CRON_SECRET>
 */
import { NextResponse } from 'next/server';
import { getRecentLogs, clearLogs, type LogLevel } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true; // open access when no secret configured (dev)
  return req.headers.get('x-admin-secret') === secret;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get('limit') ?? '200', 10)));
  const levelParam = url.searchParams.get('level');
  const level = (['debug', 'info', 'warn', 'error'].includes(levelParam ?? '') ? levelParam : undefined) as LogLevel | undefined;
  const sourceParam = url.searchParams.get('source')?.toLowerCase();

  const entries = await getRecentLogs(limit, level);
  const filtered = sourceParam ? entries.filter(e => e.source.toLowerCase().includes(sourceParam)) : entries;

  // Aggregate by source for a quick health view
  const bySource: Record<string, { total: number; errors: number; warns: number; lastSeen: string }> = {};
  for (const e of entries) {
    const s = bySource[e.source] ?? { total: 0, errors: 0, warns: 0, lastSeen: e.t };
    s.total++;
    if (e.level === 'error') s.errors++;
    if (e.level === 'warn') s.warns++;
    if (e.t > s.lastSeen) s.lastSeen = e.t;
    bySource[e.source] = s;
  }

  return NextResponse.json({
    entries: filtered,
    totalInBuffer: entries.length,
    filtered: filtered.length,
    bySource,
  });
}

export async function DELETE(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await clearLogs();
  return NextResponse.json({ cleared: true });
}
