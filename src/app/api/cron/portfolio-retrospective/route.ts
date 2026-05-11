/**
 * /api/cron/portfolio-retrospective
 *
 * 일별 cron — 14일 이상 경과한 portfolio 추천을 평가.
 *
 * - PRED_KEY(flowvium:retro:predictions:v2) 에서 evaluateAfter <= now 항목 추출
 * - 각 ticker 의 Yahoo OHLC 가져와 hit_target / stop_loss / not_entered / still_holding 판정
 * - 6-dimension quality score (direction/entry/target/risk/sector/missing) 계산
 * - EVAL_KEY 에 누적, AggregateScores 갱신, S2/S7 lessons 텍스트 업데이트
 *
 * 이 cron 이 없으면 추천만 쌓이고 평가가 안 됨 — "전향적 연구" 의 핵심 piece.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { evaluatePendingPredictions } from '@/lib/portfolio-retrospective';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? '';
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  if (cronSecret && auth !== cronSecret && !req.headers.get('user-agent')?.includes('vercel-cron')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redis = createRedis();
  if (!redis) return NextResponse.json({ ok: false, error: 'no redis' });

  const start = Date.now();
  try {
    const { evaluated } = await evaluatePendingPredictions(redis);
    logger.info('cron.portfolio-retrospective', 'done', {
      evaluated,
      durationMs: Date.now() - start,
    });
    return NextResponse.json({ ok: true, evaluated, durationMs: Date.now() - start });
  } catch (e) {
    logger.error('cron.portfolio-retrospective', 'exception', { error: String(e) });
    return NextResponse.json({ ok: false, error: String(e), durationMs: Date.now() - start });
  }
}
