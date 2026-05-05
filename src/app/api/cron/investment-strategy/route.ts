import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Vercel Cron — 16개 언어별 투자전략 보고서 생성.
 * 우선순위 5개(ko/en/ja/zh-CN/zh-TW)는 직접 생성, 나머지 11개는 'en' 캐시 폴백.
 * 5개를 병렬 HTTP 요청으로 동시 생성 → 각 Lambda가 독립 실행 → 총 ~120s 내 완료.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** 직접 AI 생성하는 우선 언어 — 아시아·영어권 주요 시장 */
const PRIORITY_LOCALES = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW'] as const;

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\s+/g, '').replace(/\\n/g, '') || 'https://flowvium.net';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const headers: HeadersInit = cronSecret ? { 'Authorization': `Bearer ${cronSecret}` } : {};

  logger.info('cron.investment-strategy', 'start', { locales: PRIORITY_LOCALES });

  // 5개 언어 병렬 생성 (각 요청이 별도 Lambda에서 독립 실행)
  const results = await Promise.allSettled(
    PRIORITY_LOCALES.map(async (locale) => {
      const t0 = Date.now();
      try {
        const res = await fetch(`${baseUrl}/api/investment-strategy?force=1&locale=${locale}`, {
          signal: AbortSignal.timeout(270000), // 270s — cron maxDuration 여유 확보
          cache: 'no-store',
          headers,
        });
        const durationMs = Date.now() - t0;
        if (!res.ok) {
          logger.error('cron.investment-strategy', 'locale_failed', { locale, status: res.status, durationMs });
          return { locale, ok: false, status: res.status, durationMs };
        }
        const data = await res.json() as { source?: string; qualityScore?: number };
        const isAi = data.source && data.source !== 'data' && data.source !== 'fallback';
        logger.info('cron.investment-strategy', 'locale_done', {
          locale, source: data.source, isAi, qualityScore: data.qualityScore, durationMs,
        });
        return { locale, ok: true, source: data.source, isAi, qualityScore: data.qualityScore, durationMs };
      } catch (e) {
        const durationMs = Date.now() - t0;
        logger.error('cron.investment-strategy', 'locale_exception', { locale, error: String(e), durationMs });
        return { locale, ok: false, error: String(e), durationMs };
      }
    }),
  );

  const summary = results.map((r, i) => {
    const locale = PRIORITY_LOCALES[i];
    if (r.status === 'fulfilled') return r.value;
    return { locale, ok: false as const, error: String(r.reason) };
  });

  const successCount = summary.filter(s => s.ok).length;
  const totalMs = Date.now() - start;

  logger.info('cron.investment-strategy', 'done', {
    successCount, total: PRIORITY_LOCALES.length, totalMs,
    locales: summary.map(s => `${s.locale}:${s.ok ? 'ok' : 'fail'}`).join(' '),
  });

  return NextResponse.json({ ok: successCount > 0, successCount, total: PRIORITY_LOCALES.length, summary, totalMs });
}
