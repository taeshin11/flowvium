import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Vercel Cron — regenerates investment-strategy daily (right after daily-brief cron).
 * Pre-generating ensures users always see AI content, not the data-driven fallback.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\s+/g, '').replace(/\\n/g, '') || 'https://flowvium.vercel.app';

  try {
    const cronSecret = process.env.CRON_SECRET ?? '';
    const res = await fetch(`${baseUrl}/api/investment-strategy?force=1`, {
      signal: AbortSignal.timeout(80000),
      cache: 'no-store',
      headers: cronSecret ? { 'Authorization': `Bearer ${cronSecret}` } : {},
    });
    if (!res.ok) {
      logger.error('cron.investment-strategy', 'fetch_failed', { status: res.status });
      return NextResponse.json({ ok: false, error: `HTTP ${res.status}`, durationMs: Date.now() - start });
    }
    const data = await res.json() as { source?: string };
    const isAi = data.source && data.source !== 'data' && data.source !== 'fallback';
    logger.info('cron.investment-strategy', 'done', { source: data.source, isAi, durationMs: Date.now() - start });
    return NextResponse.json({ ok: true, source: data.source, isAi, durationMs: Date.now() - start });
  } catch (e) {
    logger.error('cron.investment-strategy', 'exception', { error: e });
    return NextResponse.json({ ok: false, error: String(e), durationMs: Date.now() - start });
  }
}
