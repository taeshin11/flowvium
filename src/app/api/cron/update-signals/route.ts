import { logger, loggedRedisSet, loggedRedisDel } from '@/lib/logger';
import { revalidatePath } from 'next/cache';
import { getSignals } from '@/lib/signals-service';
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import {
  INSTITUTIONS,
  fetchInstitutionHoldings,
  determineAction,
  formatValue,
  calcSharesChanged,
  TICKER_TO_COMPANY,
  TICKER_TO_SECTOR,
} from '@/lib/edgar-13f';
import type { InstitutionalSignal } from '@/data/institutional-signals';
import type { OwnershipRecord } from '@/data/news-gap';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

const SUPPORTED_LOCALES = ['en', 'ko', 'ja', 'zh', 'es', 'pt', 'de', 'fr'];
const REDIS_KEY_SIGNALS  = 'flowvium:13f-signals:v1';
const REDIS_KEY_OWNERSHIP = 'flowvium:13f-ownership:v1';
const SIGNAL_TTL  = 7 * 24 * 60 * 60;  // 7일 (13F는 분기별)
const OWNERSHIP_TTL = 7 * 24 * 60 * 60;

/**
 * Vercel Cron handler — runs daily at 02:00 UTC (see vercel.json).
 *
 * Steps:
 * 1. EDGAR 13F-HR 파싱: 주요 기관의 최신 분기 포지션 취득
 * 2. 직전 분기와 비교하여 action 결정
 * 3. InstitutionalSignal[] + OwnershipRecord 형식으로 Redis 저장
 * 4. Alpha Vantage 뉴스갭 스코어 갱신
 * 5. ISR 캐시 revalidate
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const redis = createRedis();
  const log: string[] = [];
  log.push(`redis: ${redis ? 'connected' : 'null (check UPSTASH env vars)'}`);

  // ── 1단계: EDGAR 13F 파싱 (결과 나오는 것만 저장) ──────────
  // 2026-07-02: 완전 병렬(15기관 동시) → SEC rate-limit(≤10 req/s)에 전기관 429 전멸
  //   ("no signals parsed" → /api/signals 빈배열, 신규머신 실증). 순차 + 500ms 간격 + 429 시 1회
  //   재시도(3s 백오프). 시간은 늘지만 cron 이라 무해(응답 후에도 서버측 계속 진행).
  const institutionEntries = Object.entries(INSTITUTIONS);
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const holdingsResults: Array<PromiseSettledResult<Awaited<ReturnType<typeof fetchInstitutionHoldings>> | null>> = [];
  for (const [name, { cik }] of institutionEntries) {
    let v: Awaited<ReturnType<typeof fetchInstitutionHoldings>> | null = null;
    try { v = await fetchInstitutionHoldings(name, cik); } catch { v = null; }
    if (!v || !v.current?.positions?.length) {
      await sleep(3000);  // 429 백오프 후 1회 재시도
      try { v = await fetchInstitutionHoldings(name, cik); } catch { v = null; }
    }
    holdingsResults.push({ status: 'fulfilled', value: v });
    await sleep(500);
  }

  const signals: InstitutionalSignal[] = [];
  // ticker → {institution, shares, value, quarter, pct(null for now)}
  const ownershipMap: Record<string, OwnershipRecord[]> = {};

  let sigId = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < holdingsResults.length; i++) {
    const result = holdingsResults[i];
    if (result.status === 'rejected') {
      logger.error('cron.update-signals', 'institution_fetch_failed', { institution: institutionEntries[i][0], error: result.reason });
      continue;
    }
    if (result.status !== 'fulfilled' || !result.value) continue;

    const { current, previous } = result.value;
    if (!current.positions.length) {
      logger.warn('cron.update-signals', 'no_positions', { institution: institutionEntries[i][0] });
      log.push(`⚠ ${institutionEntries[i][0]}: no positions parsed`);
      continue;
    }

    const prevMap = new Map(
      (previous?.positions ?? []).map(p => [p.cusip, p])
    );

    log.push(`✓ ${institutionEntries[i][0]}: ${current.positions.length} positions`);

    for (const pos of current.positions) {
      const prev = prevMap.get(pos.cusip);
      const action = determineAction(pos, prev);
      const sharesChanged = calcSharesChanged(pos, prev);
      const ticker = pos.ticker;
      const quarterEnd = current.quarterEnd || '';
      const quarter = quarterEnd
        ? `Q${Math.ceil((new Date(quarterEnd).getMonth() + 1) / 3)} ${new Date(quarterEnd).getFullYear()}`
        : 'Latest';

      // InstitutionalSignal
      signals.push({
        id: `13f-${sigId++}`,
        ticker,
        companyName: TICKER_TO_COMPANY[ticker] ?? pos.companyName,
        institution: institutionEntries[i][0],
        action,
        sharesChanged,
        totalShares: pos.shares,
        filingDate: current.filingDate,
        quarterEnd: current.quarterEnd,
        estimatedValue: formatValue(pos.valueThousands),
        sector: TICKER_TO_SECTOR[ticker] ?? 'other',
        newsGapScore: 50,
        mediaArticles: 0,
      });

      // OwnershipRecord
      if (!ownershipMap[ticker]) ownershipMap[ticker] = [];
      ownershipMap[ticker].push({
        institution: institutionEntries[i][0],
        valueM: Math.round(pos.valueThousands / 1_000_000),
        pctOfShares: 0,  // 실제 발행주식수 없이 계산 불가 — 0으로 저장
        prevPct: prev ? 0 : undefined,
        sharesM: +(pos.shares / 1_000_000).toFixed(2),
        quarter,
        action: action === 'new_position' ? 'new'
               : action === 'accumulating' ? 'increased'
               : action === 'reducing' ? 'reduced' : 'reduced',
        secUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${institutionEntries[i][1].cik}&type=13F-HR&dateb=&owner=include&count=5`,
      });
    }
  }

  // ── 2단계: Redis 저장 ──────────────────────────────────────────────────────
  if (redis && signals.length > 0) {
    try {
      await loggedRedisSet(redis, 'cron.update-signals', REDIS_KEY_SIGNALS, signals, { ex: SIGNAL_TTL });
      await loggedRedisSet(redis, 'cron.update-signals', REDIS_KEY_OWNERSHIP, ownershipMap, { ex: OWNERSHIP_TTL });
      logger.info('cron.update-signals', 'redis_saved', { signals: signals.length, tickers: Object.keys(ownershipMap).length });
      log.push(`✓ Redis 저장: ${signals.length}개 신호, ${Object.keys(ownershipMap).length}개 종목`);
    } catch (e) {
      logger.error('cron.update-signals', 'redis_save_failed', { error: e });
      log.push(`✗ Redis 저장 실패: ${e}`);
    }
  } else {
    logger.warn('cron.update-signals', 'no_edgar_data', { message: 'no signals parsed from EDGAR — Redis update skipped' });
    log.push(`⚠ EDGAR 데이터 없음 — Redis 업데이트 스킵`);
  }

  // 13F 캐시 무효화 (latest-updates 등이 다시 불러오게)
  if (redis) {
    await loggedRedisDel(redis, 'cron.update-signals', ['flowvium:latest-updates:v3']);
  }

  // ── 3단계: Alpha Vantage 뉴스갭 스코어 갱신 ───────────────────────────────
  const newsResult = await getSignals(true).catch(() => null);
  log.push(`✓ Alpha Vantage: ${newsResult?.updatedTickers ?? 0}개 티커 뉴스 갱신`);

  // ── 4단계: ISR 캐시 revalidate ─────────────────────────────────────────────
  revalidatePath('/api/signals');
  revalidatePath('/api/news-gap');
  for (const locale of SUPPORTED_LOCALES) {
    revalidatePath(`/${locale}/signals`);
    revalidatePath(`/${locale}/news-gap`);
  }

  const exportData = req.nextUrl.searchParams.get('export') === '1';

  return NextResponse.json({
    ok: true,
    edgarSignals: signals.length,
    edgarTickers: Object.keys(ownershipMap).length,
    newsUpdated: newsResult?.updatedTickers ?? 0,
    durationMs: Date.now() - start,
    timestamp: now,
    log,
    ...(exportData ? { signals, ownershipMap } : {}),
  });
}
