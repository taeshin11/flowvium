/**
 * portfolio-retrospective.ts
 *
 * Karpathy AutoResearch Loop — 포트폴리오 예측 회고 시스템
 *
 * 흐름:
 *   1. 리포트 생성 시: logPortfolioPredictions() → Redis 저장
 *   2. 매일 크론: evaluatePendingPredictions() → Yahoo 현재가 비교
 *   3. 다음 리포트: getRetrospectiveSummary() → 교훈 주입
 *
 * Redis keys:
 *   flowvium:retro:predictions:v1   — 미평가 예측 배열 (JSON)
 *   flowvium:retro:evaluated:v1     — 평가 완료 배열 (최근 50개)
 *   flowvium:retro:lessons:v1       — AI 프롬프트 주입용 교훈 텍스트
 */

import type { Redis } from '@upstash/redis';
import { loggedRedisSet } from '@/lib/logger';

const PRED_KEY = 'flowvium:retro:predictions:v1';
const EVAL_KEY = 'flowvium:retro:evaluated:v1';
const LESSONS_KEY = 'flowvium:retro:lessons:v1';

export interface PortfolioPrediction {
  id: string;                 // `${reportDate}:${session}:${ticker}`
  ticker: string;
  name: string;
  generatedAt: string;        // ISO
  evaluateAfterDays: number;  // 기본 14일
  evaluateAfter: string;      // ISO (평가 예정일)
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  target: number | null;
  stopLoss: number | null;
  priceAtGen: number | null;  // 생성 시점 현재가
  rationale: string;
  entryRationale?: string;
  targetRationale?: string;
  action: string;             // buy | hold | watch
}

export interface EvaluatedPrediction extends PortfolioPrediction {
  evaluatedAt: string;
  priceAtEval: number | null;
  outcome: 'hit_target' | 'stop_loss' | 'still_holding' | 'unknown';
  pnlPct: number | null;      // (priceAtEval - entryZoneLow) / entryZoneLow * 100
  lesson: string;             // 자동 생성된 교훈 텍스트
}

// entryZone 문자열 "$110-115" → [110, 115]
function parseZone(zone: string | undefined): [number | null, number | null] {
  if (!zone || zone === '-' || /market|±|N\/A/i.test(zone)) return [null, null];
  const nums = zone.replace(/[$₩,]/g, '').split(/[-~]/);
  const low = parseFloat(nums[0]); const high = parseFloat(nums[1] ?? nums[0]);
  return [isNaN(low) ? null : low, isNaN(high) ? null : high];
}

function parsePrice(s: string | undefined): number | null {
  if (!s || s === '-') return null;
  const n = parseFloat(s.replace(/[$₩,%,]/g, ''));
  return isNaN(n) ? null : n;
}

/** 리포트 생성 직후 호출: portfolio → predictions 저장 */
export async function logPortfolioPredictions(
  redis: Redis,
  portfolio: Array<{
    ticker: string; name?: string; action?: string; rationale?: string;
    entryZone?: string; target?: string; stopLoss?: string; currentPrice?: number;
    entryRationale?: string; targetRationale?: string;
  }>,
  generatedAt: string,
): Promise<void> {
  if (!portfolio?.length) return;
  try {
    const raw = await redis.get<unknown>(PRED_KEY);
    const existing: PortfolioPrediction[] = Array.isArray(raw) ? (raw as PortfolioPrediction[]) : [];

    const evalDate = new Date(Date.now() + 14 * 86400000).toISOString();
    const reportDate = generatedAt.slice(0, 10);
    const session = new Date(Date.now() + 9 * 3600000).getUTCHours() < 16 ? 'morning' : 'afternoon';

    const newPreds: PortfolioPrediction[] = portfolio
      .filter(p => p.ticker && p.action !== 'hold')
      .map(p => {
        const [low, high] = parseZone(p.entryZone);
        return {
          id: `${reportDate}:${session}:${p.ticker}`,
          ticker: p.ticker,
          name: p.name ?? p.ticker,
          generatedAt,
          evaluateAfterDays: 14,
          evaluateAfter: evalDate,
          entryZoneLow: low,
          entryZoneHigh: high,
          target: parsePrice(p.target),
          stopLoss: parsePrice(p.stopLoss),
          priceAtGen: p.currentPrice ?? null,
          rationale: (p.rationale ?? '').slice(0, 120),
          entryRationale: p.entryRationale,
          targetRationale: p.targetRationale,
          action: p.action ?? 'watch',
        };
      });

    // 같은 id는 overwrite (중복 방지)
    const idSet = new Set(newPreds.map(p => p.id));
    const merged = [...newPreds, ...existing.filter(e => !idSet.has(e.id))].slice(0, 200);
    await loggedRedisSet(redis, 'retro', PRED_KEY, merged, { ex: 90 * 86400 });
  } catch { /* non-fatal */ }
}

/** Yahoo Finance에서 현재가 조회 */
async function fetchCurrentPrice(ticker: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const closes: number[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter(Boolean);
    return valid.length ? valid[valid.length - 1] : null;
  } catch { return null; }
}

/** 결과 판정 + 교훈 생성 */
function generateLesson(pred: PortfolioPrediction, actualPrice: number): { outcome: EvaluatedPrediction['outcome']; pnlPct: number | null; lesson: string } {
  const entry = pred.entryZoneLow ?? pred.priceAtGen;
  const pnlPct = entry && entry > 0 ? parseFloat(((actualPrice - entry) / entry * 100).toFixed(1)) : null;

  let outcome: EvaluatedPrediction['outcome'] = 'still_holding';
  if (pred.target && actualPrice >= pred.target * 0.98) outcome = 'hit_target';
  else if (pred.stopLoss && actualPrice <= pred.stopLoss * 1.02) outcome = 'stop_loss';

  const entryStr = entry ? `$${entry.toFixed(2)}` : '?';
  const actualStr = `$${actualPrice.toFixed(2)}`;
  const pnlStr = pnlPct != null ? `(${pnlPct >= 0 ? '+' : ''}${pnlPct}%)` : '';

  let lesson = '';
  if (outcome === 'hit_target') {
    lesson = `✅ ${pred.ticker} ${entryStr}→${actualStr}${pnlStr} 목표가 도달. 유효 패턴: ${pred.rationale}`;
  } else if (outcome === 'stop_loss') {
    lesson = `❌ ${pred.ticker} ${entryStr}→${actualStr}${pnlStr} 손절. 재검토 필요: ${pred.rationale}`;
  } else {
    lesson = `⏳ ${pred.ticker} ${entryStr}→${actualStr}${pnlStr} 보유중. ${pnlPct != null && pnlPct > 5 ? '긍정적 진행' : '모니터링 필요'}`;
  }

  return { outcome, pnlPct, lesson };
}

/** 크론에서 호출: 14일 지난 예측 평가 */
export async function evaluatePendingPredictions(redis: Redis): Promise<{ evaluated: number; lessons: string[] }> {
  const now = new Date().toISOString();
  const rawPred = await redis.get<unknown>(PRED_KEY);
  const pending: PortfolioPrediction[] = Array.isArray(rawPred) ? (rawPred as PortfolioPrediction[]) : [];
  const rawEval = await redis.get<unknown>(EVAL_KEY);
  const evaluated: EvaluatedPrediction[] = Array.isArray(rawEval) ? (rawEval as EvaluatedPrediction[]) : [];

  const due = pending.filter(p => p.evaluateAfter <= now);
  const notDue = pending.filter(p => p.evaluateAfter > now);
  if (!due.length) return { evaluated: 0, lessons: [] };

  // 배치: 한 번에 최대 10개 평가 (API 부담 제한)
  const batch = due.slice(0, 10);
  const results = await Promise.allSettled(batch.map(p => fetchCurrentPrice(p.ticker)));
  const newLessons: string[] = [];
  const newEvaluated: EvaluatedPrediction[] = [];

  for (let i = 0; i < batch.length; i++) {
    const pred = batch[i];
    const priceResult = results[i];
    const actualPrice = priceResult.status === 'fulfilled' ? priceResult.value : null;

    if (actualPrice == null) {
      // 가격 조회 실패 시 7일 더 대기
      notDue.push({ ...pred, evaluateAfter: new Date(Date.now() + 7 * 86400000).toISOString() });
      continue;
    }

    const { outcome, pnlPct, lesson } = generateLesson(pred, actualPrice);
    const evalPred: EvaluatedPrediction = { ...pred, evaluatedAt: now, priceAtEval: actualPrice, outcome, pnlPct, lesson };
    newEvaluated.push(evalPred);
    newLessons.push(lesson);
  }

  // 평가 안 된 due 항목 (가격 조회 실패)은 already pushed to notDue above
  const remainingDue = due.slice(10); // 이번 배치 처리 못한 것들
  const updatedPending = [...notDue, ...remainingDue];
  const updatedEvaluated = [...newEvaluated, ...evaluated].slice(0, 100);

  await Promise.allSettled([
    loggedRedisSet(redis, 'retro', PRED_KEY, updatedPending, { ex: 90 * 86400 }),
    loggedRedisSet(redis, 'retro', EVAL_KEY, updatedEvaluated, { ex: 180 * 86400 }),
  ]);

  // 교훈 텍스트 업데이트
  if (newLessons.length) {
    const rawLessons = await redis.get<string>(LESSONS_KEY);
    const existing = rawLessons ? rawLessons.split('\n').filter(Boolean) : [];
    const updated = [...newLessons, ...existing].slice(0, 20).join('\n');
    await loggedRedisSet(redis, 'retro', LESSONS_KEY, updated, { ex: 90 * 86400 });
  }

  return { evaluated: newEvaluated.length, lessons: newLessons };
}

/** AI 프롬프트에 주입할 회고 요약 */
export async function getRetrospectiveSummary(redis: Redis): Promise<string> {
  try {
    const lessons = await redis.get<string>(LESSONS_KEY);
    if (!lessons) return '';
    const lines = lessons.split('\n').filter(Boolean).slice(0, 8);
    if (!lines.length) return '';
    return [
      '[PORTFOLIO RETROSPECTIVE — learn from past predictions]',
      ...lines,
      'Apply these lessons: repeat successful patterns, avoid repeated mistakes.',
      '[END RETROSPECTIVE]',
    ].join('\n');
  } catch { return ''; }
}
