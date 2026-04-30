/**
 * /api/cron/evaluate-signals
 *
 * Karpathy AutoResearch Loop — 신호 정확도 평가 크론
 * 주 1회 실행 (일요일 03:00 UTC)
 *
 * 1. 평가 기한이 지난 신호들을 Redis에서 가져옴
 * 2. Yahoo Finance에서 실제 수익률을 조회
 * 3. 예측 방향 vs 실제 방향 비교 → hit/miss
 * 4. 타임프레임별(1W/4W/13W) 정확도 업데이트
 * 5. 정확도 기반으로 임계값 자동 조정 제안
 */

import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { evaluatePendingSignals, SIGNAL_ACCURACY_PREFIX } from '@/lib/signal-accuracy';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Fetch actual return for a ticker since fromDate using Yahoo Finance */
async function fetchActualReturn(ticker: string, fromDate: string): Promise<number | null> {
  try {
    const from = Math.floor(new Date(fromDate).getTime() / 1000);
    const to = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${from}&period2=${to}`;
    const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const closes: (number | null)[] = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c != null && c > 0);
    if (valid.length < 2) return null;
    return parseFloat(((valid[valid.length - 1] / valid[0] - 1) * 100).toFixed(2));
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? '';
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  if (cronSecret && auth !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redis = createRedis();
  if (!redis) return NextResponse.json({ ok: false, error: 'no redis' });

  const start = Date.now();
  try {
    const result = await evaluatePendingSignals(redis, fetchActualReturn);

    // Read updated accuracy for logging
    const accuracy: Record<string, unknown> = {};
    for (const tf of ['1w', '4w', '13w']) {
      const raw = await redis.get(`${SIGNAL_ACCURACY_PREFIX}:${tf}`);
      if (raw) accuracy[tf] = JSON.parse(raw as string);
    }

    logger.info('cron.evaluate-signals', 'done', {
      evaluated: result.evaluated,
      byTf: result.byTf,
      durationMs: Date.now() - start,
    });

    return NextResponse.json({
      ok: true,
      evaluated: result.evaluated,
      byTf: result.byTf,
      accuracy,
      durationMs: Date.now() - start,
    });
  } catch (e) {
    logger.error('cron.evaluate-signals', 'exception', { error: String(e) });
    return NextResponse.json({ ok: false, error: String(e), durationMs: Date.now() - start });
  }
}
