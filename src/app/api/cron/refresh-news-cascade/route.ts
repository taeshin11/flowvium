/**
 * Cron: /api/cron/refresh-news-cascade
 *
 * 2026-05-28 사건: /api/news-cascade?locale=ko 가 매번 첫 호출 시 영어 leak.
 * 일별 캐시 만료 → 사용자 첫 hit 시 background translation 시작 → translated:false.
 *
 * Cron 으로 매일 새벽 ko/en/ja/zh-CN 사전 워밍 → 사용자 첫 호출 시 cache hit.
 * Vercel cron 평일 새벽 5:30 UTC (= 14:30 KST 한국 점심) — 미국 장 마감 후 뉴스 들어오는 시점.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOCALES_TO_WARM = ['ko', 'en', 'ja', 'zh-CN'];

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  const isVercelCron = !!req.headers.get('x-vercel-cron');
  if (process.env.CRON_SECRET && !isVercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://flowvium.net';
  const results: Array<{ locale: string; status: number | null; ms: number; translated?: boolean; entries?: number; error?: string }> = [];

  // 순차 (병렬 시 translation queue 폭주). en 우선 (base cache) → 나머지.
  for (const locale of LOCALES_TO_WARM) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/api/news-cascade?locale=${locale}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });
      const j = res.ok ? await res.json() : null;
      results.push({
        locale,
        status: res.status,
        ms: Date.now() - t0,
        translated: j?.translated,
        entries: j?.entries?.length ?? j?.articles?.length,
      });
    } catch (e) {
      results.push({ locale, status: null, ms: Date.now() - t0, error: String(e) });
    }
  }

  const durationMs = Date.now() - start;
  logger.info('cron.refresh-news-cascade', 'completed', { results, durationMs });

  return NextResponse.json({
    ok: results.every(r => r.status === 200),
    results,
    durationMs,
    timestamp: new Date().toISOString(),
  });
}
