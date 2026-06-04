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

// 2026-06-04: 4→주요 9 locale 확장 (나머지 ru/ar/hi/id/th/tr/vi 는 news-cascade GET on-demand bg 번역).
const LOCALES_TO_WARM = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'de', 'fr', 'pt'];

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  const isVercelCron = !!req.headers.get('x-vercel-cron');
  if (process.env.CRON_SECRET && !isVercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  // 2026-06-04: 자가호스팅 — localhost 직접(flowvium.net 라운드트립 회피) + bg 순차 warm 후 즉시 반환.
  //   기존엔 9 locale × ~90s sync 번역을 한 응답에서 await → cron-runner 120s timeout 초과(HTTP 000).
  //   pm2 persistent 라 bg floating promise 가 응답 후에도 완료됨(Vercel 과 달리 종료 안 됨).
  const base = `http://localhost:${process.env.PORT || 3000}`;
  const warmAll = async () => {
    for (const locale of LOCALES_TO_WARM) {  // 순차 (Ollama single-GPU — 병렬 시 queue 폭주)
      try {
        const url = locale === 'en'
          ? `${base}/api/news-cascade?locale=${locale}`
          : `${base}/api/news-cascade?locale=${locale}&wait=1`;
        await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(180000) });
      } catch (e) { logger.warn('cron.refresh-news-cascade', 'warm_failed', { locale, error: String(e).slice(0, 80) }); }
    }
    logger.info('cron.refresh-news-cascade', 'bg_warm_done', { locales: LOCALES_TO_WARM, durationMs: Date.now() - start });
  };
  void warmAll();  // 비대기 — bg 에서 완료
  const results = LOCALES_TO_WARM.map(locale => ({ locale, status: 'warming-bg' }));
  const durationMs = Date.now() - start;
  logger.info('cron.refresh-news-cascade', 'kicked_off', { locales: LOCALES_TO_WARM });

  return NextResponse.json({
    ok: true,
    warming: results,
    durationMs,
    timestamp: new Date().toISOString(),
  });
}
