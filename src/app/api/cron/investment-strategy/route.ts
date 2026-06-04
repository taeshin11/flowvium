import { logger } from '@/lib/logger';
import { createRedis } from '@/lib/redis';
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
type PriorityLocale = typeof PRIORITY_LOCALES[number];

/**
 * STRATEGY_LOCALES env var: comma-separated list to restrict which locales run.
 * Example: STRATEGY_LOCALES=ko,en  → only Korean + English generated.
 * Unset → all 5 priority locales run (default).
 */
const _envLocales = process.env.STRATEGY_LOCALES;
const activeLocales: readonly PriorityLocale[] = _envLocales
  ? _envLocales.split(',').map(s => s.trim()).filter((l): l is PriorityLocale => PRIORITY_LOCALES.includes(l as PriorityLocale))
  : PRIORITY_LOCALES;

const SCHEMA_VERSION = 8;
const HIST_KEY = 'flowvium:investment-strategy:history:arr:v1';
function staleKey(locale: string) { return `flowvium:investment-strategy:stale:v${SCHEMA_VERSION}:${locale}`; }

function getKstSession(): 'midnight' | 'morning' | 'noon' | 'afternoon' | 'evening' {
  const kstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (kstHour < 7) return 'midnight';
  if (kstHour < 12) return 'morning';
  if (kstHour < 16) return 'noon';
  if (kstHour < 22) return 'afternoon';
  return 'evening';
}
function todayKstDate() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

const isFallbackSrc = (s: unknown) =>
  typeof s === 'string' && (s === 'fallback' || s === 'data' || s.startsWith('fallback'));

/**
 * 같은 (날짜, session, locale) 의 non-fallback 보고서가 hist 에 이미 있으면 true.
 * Vercel cron 이 같은 session 에 fallback 을 또 push 하는 걸 차단.
 */
async function sessionAlreadyCovered(
  redis: ReturnType<typeof createRedis>,
  locale: string,
): Promise<boolean> {
  if (!redis) return false;
  try {
    const raw = await redis.get(HIST_KEY);
    const arr = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<Record<string, unknown>> | null;
    if (!Array.isArray(arr)) return false;
    const day = todayKstDate();
    const session = getKstSession();
    return arr.some(e =>
      typeof e.kstDate === 'string' && e.kstDate.slice(0, 10) === day &&
      e.session === session && e.locale === locale && !isFallbackSrc(e.source),
    );
  } catch { return false; }
}

/** stale key에 2시간 내 로컬/AI 생성 보고서가 있으면 재생성 불필요 */
async function hasRecentGoodReport(redis: ReturnType<typeof createRedis>, locale: string): Promise<boolean> {
  if (!redis) return false;
  try {
    const stale = await redis.get(staleKey(locale)) as Record<string, unknown> | null;
    if (!stale || !stale.generatedAt || !stale.source) return false;
    if (isFallbackSrc(stale.source)) return false;
    const ageMs = Date.now() - new Date(String(stale.generatedAt)).getTime();
    return ageMs < 2 * 60 * 60 * 1000; // 2시간 이내
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\s+/g, '').replace(/\\n/g, '') || 'https://flowvium.net';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const headers: HeadersInit = cronSecret ? { 'Authorization': `Bearer ${cronSecret}` } : {};

  const redis = await createRedis();

  logger.info('cron.investment-strategy', 'start', { locales: activeLocales });

  // 5개 언어 병렬 생성 (각 요청이 별도 Lambda에서 독립 실행)
  const results = await Promise.allSettled(
    activeLocales.map(async (locale) => {
      const t0 = Date.now();
      try {
        // Skip if local already uploaded a fresh report in the last 2h
        if (redis && await hasRecentGoodReport(redis, locale)) {
          const durationMs = Date.now() - t0;
          logger.info('cron.investment-strategy', 'skipped_recent_local', { locale, durationMs });
          return { locale, ok: true, source: 'skipped-recent-local', isAi: true, durationMs };
        }
        // Skip if same session already has a non-fallback report (Windows scheduler 가 먼저 push 한 경우)
        if (redis && await sessionAlreadyCovered(redis, locale)) {
          const durationMs = Date.now() - t0;
          logger.info('cron.investment-strategy', 'skipped_session_covered', { locale, durationMs });
          return { locale, ok: true, source: 'skipped-session-covered', isAi: true, durationMs };
        }

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
    successCount, total: activeLocales.length, totalMs,
    locales: summary.map(s => `${s.locale}:${s.ok ? 'ok' : 'fail'}`).join(' '),
  });

  return NextResponse.json({ ok: successCount > 0, successCount, total: activeLocales.length, summary, totalMs });
}
