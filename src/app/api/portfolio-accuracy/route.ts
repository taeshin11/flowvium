/**
 * /api/portfolio-accuracy
 *
 * 전향적 추천 정확도 대시보드 데이터 — 누구나 조회 가능.
 *
 * 반환:
 *   - aggregate: 6-dim quality 점수 누적 평균 + 샘플 수
 *   - byOutcome: hit_target / stop_loss / not_entered / still_holding 카운트
 *   - byTicker: ticker 별 정확도 (top hits / misses)
 *   - recent: 최근 30개 평가 결과 (UI 카드용)
 *   - lessonsS2/S7: 자동 생성된 교훈 텍스트
 *
 * 데이터는 /api/cron/portfolio-retrospective 가 daily 갱신.
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const PRED_KEY    = 'flowvium:retro:predictions:v2';
const EVAL_KEY    = 'flowvium:retro:evaluated:v2';
const SCORES_KEY  = 'flowvium:retro:scores:v2';
const LESSONS_S2  = 'flowvium:retro:lessons:s2:v2';
const LESSONS_S7  = 'flowvium:retro:lessons:s7:v2';

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' };

interface EvaluatedRow {
  id: string; ticker: string; name: string;
  generatedAt: string; evaluatedAt: string;
  priceAtGen: number | null; priceAtEval: number | null;
  outcome: 'hit_target'|'stop_loss'|'still_holding'|'not_entered'|'unknown';
  pnlPct: number | null;
  quality_score: number; quality_grade?: string;
  reportStance?: string;
}

interface PredRow {
  id: string; ticker: string; generatedAt: string; evaluateAfter: string;
}

interface AggregateScores {
  samples: number;
  avg_quality: number;
  avg_direction: number; avg_entry: number; avg_target: number;
  avg_risk: number; avg_sector: number; avg_missing: number;
  updatedAt: string;
}

export async function GET() {
  const redis = createRedis();
  if (!redis) {
    return NextResponse.json({
      ok: false, error: 'Redis not configured',
      source: 'empty',
    }, { headers: CDN_HEADERS });
  }

  try {
    const [evalRaw, scoresRaw, predRaw, lessonsS2, lessonsS7] = await Promise.all([
      redis.get<unknown>(EVAL_KEY),
      redis.get<AggregateScores>(SCORES_KEY),
      redis.get<unknown>(PRED_KEY),
      redis.get<string>(LESSONS_S2),
      redis.get<string>(LESSONS_S7),
    ]);

    const evals: EvaluatedRow[] = Array.isArray(evalRaw) ? (evalRaw as EvaluatedRow[]) : [];
    const preds: PredRow[] = Array.isArray(predRaw) ? (predRaw as PredRow[]) : [];

    // outcome 별 카운트
    const byOutcome = { hit_target: 0, stop_loss: 0, still_holding: 0, not_entered: 0, unknown: 0 };
    for (const e of evals) byOutcome[e.outcome ?? 'unknown']++;

    // ticker 별 hit rate
    const tickerStats = new Map<string, { ticker: string; hits: number; stops: number; total: number; pnlSum: number; pnlCount: number }>();
    for (const e of evals) {
      const s = tickerStats.get(e.ticker) ?? { ticker: e.ticker, hits: 0, stops: 0, total: 0, pnlSum: 0, pnlCount: 0 };
      s.total++;
      if (e.outcome === 'hit_target') s.hits++;
      if (e.outcome === 'stop_loss') s.stops++;
      if (typeof e.pnlPct === 'number') { s.pnlSum += e.pnlPct; s.pnlCount++; }
      tickerStats.set(e.ticker, s);
    }
    const byTicker = Array.from(tickerStats.values())
      .map(s => ({
        ticker: s.ticker,
        total: s.total,
        hitRate: s.total > 0 ? s.hits / s.total : 0,
        stopRate: s.total > 0 ? s.stops / s.total : 0,
        avgPnl: s.pnlCount > 0 ? parseFloat((s.pnlSum / s.pnlCount).toFixed(1)) : null,
      }))
      .sort((a, b) => b.total - a.total);

    // pending 추천 — 아직 evaluateAfter 미도래
    const now = new Date().toISOString();
    const pendingCount = preds.filter(p => p.evaluateAfter > now).length;
    const overdueCount = preds.filter(p => p.evaluateAfter <= now).length;

    return NextResponse.json({
      ok: true,
      source: 'retro-eval',
      aggregate: scoresRaw ?? null,
      byOutcome,
      byTicker: byTicker.slice(0, 30),
      recent: evals.slice(0, 30).map(e => ({
        ticker: e.ticker, name: e.name,
        generatedAt: e.generatedAt, evaluatedAt: e.evaluatedAt,
        outcome: e.outcome, pnlPct: e.pnlPct,
        quality_score: e.quality_score,
        quality_grade: e.quality_grade,
        reportStance: e.reportStance,
      })),
      lessons: {
        s2: lessonsS2 ?? null,
        s7: lessonsS7 ?? null,
      },
      counts: {
        evaluated: evals.length,
        pending: pendingCount,
        overdue: overdueCount, // cron 이 막혀 평가 안 된 항목 — 0 이어야 정상
      },
      updatedAt: new Date().toISOString(),
    }, { headers: CDN_HEADERS });
  } catch (e) {
    return NextResponse.json({
      ok: false, error: String(e), source: 'error',
    }, { headers: CDN_HEADERS });
  }
}
