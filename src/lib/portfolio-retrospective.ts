/**
 * portfolio-retrospective.ts — Progressive Research Self-Improvement Loop
 *
 * 6차원 평가로 AI 리포트 품질을 자동 측정하고 교훈을 다음 리포트에 주입.
 *
 * Dimensions (weight):
 *   D1: Direction         25% — bullish/neutral/bearish vs SPY 실제 수익률
 *   D2: Entry calibration 15% — entryZone 실제 도달 여부
 *   D3: Target calibration 20% — target 공격성 vs 실제 최고가
 *   D4: Risk identification 15% — 예측 리스크 이벤트 실제 발생 여부
 *   D5: Sector allocation  15% — 오버웨이트 섹터 vs 실제 수익률 순위
 *   D6: Missing signals    10% — context에 있었는데 리포트에서 누락된 신호
 *
 * Redis keys:
 *   flowvium:retro:predictions:v2   — 미평가 예측 배열 (JSON, max 200)
 *   flowvium:retro:evaluated:v2     — 6차원 평가 완료 배열 (max 100)
 *   flowvium:retro:lessons:s2:v2    — S2(portfolio) 주입용 전술적 교훈
 *   flowvium:retro:lessons:s7:v2    — S7(critic) 주입용 전략적 교훈
 *   flowvium:retro:scores:v2        — 최근 N회 평균 점수 (차원별)
 */

import type { Redis } from '@upstash/redis';
import { loggedRedisSet } from '@/lib/logger';

const PRED_KEY    = 'flowvium:retro:predictions:v2';
const EVAL_KEY    = 'flowvium:retro:evaluated:v2';
const LESSONS_S2  = 'flowvium:retro:lessons:s2:v2';
const LESSONS_S7  = 'flowvium:retro:lessons:s7:v2';
const SCORES_KEY  = 'flowvium:retro:scores:v2';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PortfolioPrediction {
  id: string;            // `${kstDate}:${session}:${ticker}`
  reportId: string;      // full report cache key
  ticker: string;
  name: string;
  generatedAt: string;
  evaluateAfter: string; // generatedAt + 14d
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  target: number | null;
  stopLoss: number | null;
  priceAtGen: number | null;
  rationale: string;
  entryRationale?: string;
  targetRationale?: string;
  action: string;
  // Report-level context snapshot (저장 시 주입)
  reportStance?: string;   // bullish/neutral/bearish
  reportRiskEvents?: string[];
  sectorWeights?: Record<string, number>; // sector → allocation%
  contextSnapshot?: {      // 생성 당시 지표
    vix?: number | null;
    fearGreed?: number | null;
    yieldSpread?: number | null;
    momentum?: number | null;
  };
}

export interface DimensionScore {
  score: number;         // 0-1
  detail: string;        // 한국어 설명
}

export interface EvaluatedPrediction extends PortfolioPrediction {
  evaluatedAt: string;
  priceAtEval: number | null;
  ohlcDays: number;      // 실제 수집된 OHLC 일수

  // 6차원
  dim_direction: DimensionScore & { spyReturn: number | null };
  dim_entry: DimensionScore & { reached: boolean };
  dim_target: DimensionScore & { actualMaxGainPct: number | null };
  dim_risk: DimensionScore & { occurred: string[]; missed: string[] };
  dim_sector: DimensionScore & { topActual: string | null };
  dim_missing: DimensionScore & { missedSignals: string[] };

  quality_score: number;           // 0-100
  quality_grade: 'A'|'B'|'C'|'D'|'F';
  what_i_missed: string[];         // 한국어 인사이트
  outcome: 'hit_target'|'stop_loss'|'still_holding'|'not_entered'|'unknown';
  pnlPct: number | null;
}

export interface AggregateScores {
  samples: number;
  avg_quality: number;
  avg_direction: number;
  avg_entry: number;
  avg_target: number;
  avg_risk: number;
  avg_sector: number;
  avg_missing: number;
  updatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseZone(zone?: string): [number|null, number|null] {
  if (!zone || zone === '-' || /market|±|N\/A/i.test(zone)) return [null, null];
  const nums = zone.replace(/[$₩,]/g, '').split(/[-~]/);
  const lo = parseFloat(nums[0]); const hi = parseFloat(nums[1] ?? nums[0]);
  return [isNaN(lo)?null:lo, isNaN(hi)?null:hi];
}

function parsePrice(s?: string): number|null {
  if (!s || s==='-') return null;
  const n = parseFloat(s.replace(/[$₩,%]/g,''));
  return isNaN(n)?null:n;
}

function grade(score: number): 'A'|'B'|'C'|'D'|'F' {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

async function yahooOHLC(ticker: string, days = 20): Promise<{
  closes: number[]; highs: number[]; lows: number[];
}> {
  const range = days <= 7 ? '5d' : days <= 30 ? '1mo' : '3mo';
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return { closes: [], highs: [], lows: [] };
    const d = await res.json();
    const q = d?.chart?.result?.[0]?.indicators?.quote?.[0] ?? {};
    return {
      closes: (q.close ?? []).filter(Boolean),
      highs:  (q.high  ?? []).filter(Boolean),
      lows:   (q.low   ?? []).filter(Boolean),
    };
  } catch { return { closes: [], highs: [], lows: [] }; }
}

// ── Dimension evaluators ──────────────────────────────────────────────────────

async function evalDirection(stance: string|undefined): Promise<DimensionScore & { spyReturn: number|null }> {
  const { closes } = await yahooOHLC('SPY', 14);
  if (closes.length < 2) return { score: 0.5, detail: 'SPY 데이터 부족', spyReturn: null };
  const spyReturn = (closes[closes.length-1] - closes[0]) / closes[0] * 100;
  const bull = spyReturn > 1; const bear = spyReturn < -1;
  let score = 0.5;
  if (stance === 'bullish') score = bull ? 1.0 : bear ? 0.0 : 0.4;
  else if (stance === 'bearish') score = bear ? 1.0 : bull ? 0.0 : 0.4;
  else score = (!bull && !bear) ? 1.0 : 0.5; // neutral
  const detail = `SPY ${spyReturn >= 0?'+':''}${spyReturn.toFixed(1)}% vs 예측 ${stance ?? '?'}`;
  return { score, detail, spyReturn };
}

function evalEntry(ticker: string, entryLow: number|null, entryHigh: number|null,
  lows: number[]): DimensionScore & { reached: boolean } {
  if (!entryHigh || !lows.length) return { score: 0.5, detail: '데이터 없음', reached: false };
  const minLow = Math.min(...lows);
  const reached = minLow <= entryHigh * 1.01; // 1% 여유
  const score = reached ? 1.0 : Math.max(0, 1 - (minLow - entryHigh) / entryHigh * 5);
  const detail = reached
    ? `진입 구간 도달 (최저 $${minLow.toFixed(1)} ≤ 구간상단 $${entryHigh})`
    : `미도달 (최저 $${minLow.toFixed(1)} > 구간상단 $${entryHigh})`;
  return { score, detail, reached };
}

function evalTarget(priceAtGen: number|null, target: number|null, highs: number[]): DimensionScore & { actualMaxGainPct: number|null } {
  if (!target || !priceAtGen || priceAtGen <= 0 || !highs.length)
    return { score: 0.5, detail: '데이터 없음', actualMaxGainPct: null };
  const maxHigh = Math.max(...highs);
  const targetGain = (target - priceAtGen) / priceAtGen;
  const actualMaxGain = (maxHigh - priceAtGen) / priceAtGen;
  const actualMaxGainPct = actualMaxGain * 100;
  if (targetGain <= 0) return { score: 0.5, detail: '목표가 설정 오류', actualMaxGainPct };
  const ratio = actualMaxGain / targetGain;
  const score = ratio >= 0.8 ? 1.0 : ratio >= 0.4 ? 0.5 : 0.0;
  const detail = `목표 ${(targetGain*100).toFixed(1)}% vs 실제최고 ${actualMaxGainPct.toFixed(1)}% (비율 ${(ratio*100).toFixed(0)}%)`;
  return { score, detail, actualMaxGainPct };
}

async function evalRisk(riskEvents: string[]|undefined, spy14dReturn: number|null, vix14dHigh?: number): Promise<DimensionScore & { occurred: string[]; missed: string[] }> {
  const TEXT = (riskEvents ?? []).join(' ').toLowerCase();
  const occurred: string[] = [];
  const predicted: string[] = [];
  // 간단한 rule-based: VIX 급등 or SPY 급락 발생 여부
  const vixShock = vix14dHigh != null && vix14dHigh > 25;
  const spyDrop  = spy14dReturn != null && spy14dReturn < -3;
  if (vixShock) occurred.push('VIX급등');
  if (spyDrop) occurred.push('SPY급락');
  if (/vix|volatility|공포/.test(TEXT)) predicted.push('VIX');
  if (/rate|fed|금리|yield/.test(TEXT)) predicted.push('금리');
  if (/recession|경기침체|earnings|실적/.test(TEXT)) predicted.push('성장');
  const missed = occurred.filter(o => !predicted.some(p => o.toLowerCase().includes(p.toLowerCase())));
  const precision = occurred.length === 0 ? 0.5 : (occurred.length - missed.length) / occurred.length;
  const detail = missed.length ? `미예측 리스크: ${missed.join(',')}` : `리스크 예측 적절`;
  return { score: precision, detail, occurred, missed };
}

async function evalSector(sectorWeights: Record<string,number>|undefined): Promise<DimensionScore & { topActual: string|null }> {
  const SECTORS: [string, string][] = [
    ['XLK','Technology'],['XLE','Energy'],['XLF','Financials'],['XLV','Health Care'],
    ['XLI','Industrials'],['XLY','Consumer Discr'],['XLP','Consumer Staples'],
  ];
  if (!sectorWeights || Object.keys(sectorWeights).length < 2)
    return { score: 0.5, detail: '섹터 데이터 없음', topActual: null };
  try {
    const returns: [string,number][] = await Promise.all(
      SECTORS.map(async ([etf, label]) => {
        const { closes } = await yahooOHLC(etf, 14);
        return [label, closes.length >= 2 ? (closes.at(-1)! - closes[0]) / closes[0] * 100 : 0] as [string,number];
      })
    );
    returns.sort((a,b) => b[1]-a[1]);
    const topActual = returns[0][0];
    // Spearman: 보고서 비중 순위 vs 실제 수익률 순위
    const sectorOrder = Object.entries(sectorWeights).sort((a,b)=>b[1]-a[1]).map(([s])=>s);
    let d2sum = 0;
    for (let i=0; i<Math.min(sectorOrder.length, returns.length); i++) {
      const ri = returns.findIndex(([l])=>l.includes(sectorOrder[i]));
      if (ri !== -1) d2sum += (i - ri) ** 2;
    }
    const n = Math.min(sectorOrder.length, returns.length);
    const rho = n < 3 ? 0.5 : 1 - (6 * d2sum) / (n * (n*n - 1));
    const score = Math.max(0, Math.min(1, (rho + 1) / 2));
    return { score, detail: `섹터 상관 ρ=${rho.toFixed(2)}, 실제1위: ${topActual}`, topActual };
  } catch { return { score: 0.5, detail: '섹터 조회 실패', topActual: null }; }
}

function evalMissing(snap: PortfolioPrediction['contextSnapshot'], narrative: string): DimensionScore & { missedSignals: string[] } {
  if (!snap) return { score: 0.5, detail: '컨텍스트 스냅샷 없음', missedSignals: [] };
  const TEXT = narrative.toLowerCase();
  const flags: string[] = [];
  if (snap.vix != null && snap.vix > 25) flags.push('VIX고위험');
  if (snap.fearGreed != null && snap.fearGreed < 30) flags.push('극단공포');
  if (snap.fearGreed != null && snap.fearGreed > 75) flags.push('극단탐욕');
  if (snap.yieldSpread != null && snap.yieldSpread < 0) flags.push('금리역전');
  if (snap.momentum != null && snap.momentum < -5) flags.push('하락모멘텀');
  const missed = flags.filter(f => {
    if (f.includes('VIX')) return !/vix|volatility|변동성/.test(TEXT);
    if (f.includes('공포')) return !/fear|공포|극단/.test(TEXT);
    if (f.includes('탐욕')) return !/greed|탐욕|과열/.test(TEXT);
    if (f.includes('역전')) return !/invert|역전|수익률곡선/.test(TEXT);
    if (f.includes('모멘텀')) return !/momentum|하락세|약세/.test(TEXT);
    return false;
  });
  const score = flags.length === 0 ? 1.0 : Math.max(0, 1 - missed.length / flags.length);
  return { score, detail: missed.length ? `누락 신호: ${missed.join(',')}` : '신호 포착 양호', missedSignals: missed };
}

function generateWhatIMissed(e: Partial<EvaluatedPrediction>): string[] {
  const out: string[] = [];
  if (!e.dim_direction || !e.dim_entry || !e.dim_target || !e.dim_risk || !e.dim_sector || !e.dim_missing) return out;
  if (e.dim_direction.score < 0.3) {
    const r = (e.dim_direction.spyReturn ?? 0).toFixed(1);
    out.push(e.reportStance === 'bullish'
      ? `bullish 예측했으나 SPY ${r}% → 거시 과신, 다음엔 하방 시나리오 추가`
      : `bearish 예측했으나 SPY +${r}% → 하방 과신, 다음엔 모멘텀 신호 우선`);
  }
  if (e.dim_entry.score < 0.5 && !e.dim_entry.reached)
    out.push(`entryZone 미도달 → 진입 구간을 현재가 +3~5% 높게 잡아야 함`);
  if (e.dim_target.score < 0.4) {
    const a = (e.dim_target.actualMaxGainPct ?? 0).toFixed(1);
    out.push(`목표가 과도 — 실제 최고 상승 ${a}%에 그침 → target을 ATR×2 이내로 보수적으로`);
  }
  if (e.dim_risk.missed && e.dim_risk.missed.length > 0)
    out.push(`context에 [${e.dim_risk.missed.join(', ')}] 신호 있었으나 리포트 미반영`);
  if (e.dim_sector.topActual && e.dim_sector.score < 0.4)
    out.push(`실제 1위 섹터 ${e.dim_sector.topActual} 미반영 — 섹터 사이클 업데이트 필요`);
  if (e.dim_missing.missedSignals && e.dim_missing.missedSignals.length > 0)
    out.push(`누락 신호: ${e.dim_missing.missedSignals.join(', ')} — 다음 리포트 반드시 언급`);
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** 리포트 생성 후 즉시 호출 — 예측 저장 */
export async function logPortfolioPredictions(
  redis: Redis,
  portfolio: Array<{
    ticker: string; name?: string; action?: string; rationale?: string;
    entryZone?: string; target?: string; stopLoss?: string; currentPrice?: number;
    entryRationale?: string; targetRationale?: string;
    allocation?: number; sector?: string;
  }>,
  generatedAt: string,
  opts?: {
    reportId?: string;
    stance?: string;
    riskEvents?: string[];
    sectorWeights?: Record<string, number>;
    contextSnapshot?: PortfolioPrediction['contextSnapshot'];
  },
): Promise<void> {
  if (!portfolio?.length) return;
  try {
    const raw = await redis.get<unknown>(PRED_KEY);
    const existing: PortfolioPrediction[] = Array.isArray(raw) ? (raw as PortfolioPrediction[]) : [];
    const evalDate = new Date(Date.now() + 14 * 86400000).toISOString();
    const kstDate = new Date(Date.now() + 9*3600000).toISOString().slice(0,10);
    const hour = new Date(Date.now() + 9*3600000).getUTCHours();
    const session = hour < 16 ? 'morning' : hour < 22 ? 'afternoon' : 'evening';
    // 2026-05-27: 'watch' 도 'hold' 아니라 추적 대상으로 잡혀 NE 인플레이션 야기.
    // 실제 buy 추천만 outcome 추적 (watch 는 사용자에게 "참고" 표시일 뿐).
    const newPreds: PortfolioPrediction[] = portfolio
      .filter(p => p.ticker && p.action === 'buy')
      .map(p => {
        const [lo, hi] = parseZone(p.entryZone);
        return {
          id: `${kstDate}:${session}:${p.ticker}`,
          reportId: opts?.reportId ?? `${kstDate}:${session}`,
          ticker: p.ticker, name: p.name ?? p.ticker,
          generatedAt, evaluateAfter: evalDate,
          entryZoneLow: lo, entryZoneHigh: hi,
          target: parsePrice(p.target), stopLoss: parsePrice(p.stopLoss),
          priceAtGen: p.currentPrice ?? null,
          rationale: (p.rationale ?? '').slice(0, 120),
          entryRationale: p.entryRationale, targetRationale: p.targetRationale,
          action: p.action ?? 'watch',
          reportStance: opts?.stance,
          reportRiskEvents: opts?.riskEvents,
          sectorWeights: opts?.sectorWeights,
          contextSnapshot: opts?.contextSnapshot,
        };
      });
    const idSet = new Set(newPreds.map(p => p.id));
    const merged = [...newPreds, ...existing.filter(e => !idSet.has(e.id))].slice(0, 200);
    await loggedRedisSet(redis, 'retro', PRED_KEY, merged, { ex: 90 * 86400 });
  } catch { /* non-fatal */ }
}

/** 크론 호출 — 14일 지난 예측 6차원 평가 */
export async function evaluatePendingPredictions(redis: Redis): Promise<{ evaluated: number }> {
  const now = new Date().toISOString();
  const rawPred = await redis.get<unknown>(PRED_KEY);
  const pending: PortfolioPrediction[] = Array.isArray(rawPred) ? (rawPred as PortfolioPrediction[]) : [];
  const rawEval = await redis.get<unknown>(EVAL_KEY);
  const evaluated: EvaluatedPrediction[] = Array.isArray(rawEval) ? (rawEval as EvaluatedPrediction[]) : [];
  const due = pending.filter(p => p.evaluateAfter <= now);
  const notDue = pending.filter(p => p.evaluateAfter > now);
  if (!due.length) return { evaluated: 0 };

  const batch = due.slice(0, 8);
  const newEval: EvaluatedPrediction[] = [];

  // Direction (공통, SPY 한 번만)
  const directionScore = await evalDirection(batch[0]?.reportStance);

  for (const pred of batch) {
    try {
      const { closes, highs, lows } = await yahooOHLC(pred.ticker, 20);
      const actualPrice = closes.at(-1) ?? null;

      const dim_direction = { ...directionScore, detail: `${pred.ticker}:${directionScore.detail}` };
      const dim_entry = evalEntry(pred.ticker, pred.entryZoneLow, pred.entryZoneHigh, lows);
      const dim_target = evalTarget(pred.priceAtGen, pred.target, highs);
      const dim_risk = await evalRisk(pred.reportRiskEvents, directionScore.spyReturn);
      const dim_sector = await evalSector(pred.sectorWeights);
      const dim_missing = evalMissing(pred.contextSnapshot, pred.rationale + ' ' + (pred.entryRationale ?? '') + ' ' + (pred.targetRationale ?? ''));

      const quality_score = Math.round(
        (dim_direction.score * 0.25 + dim_target.score * 0.20 + dim_entry.score * 0.15 +
         dim_risk.score * 0.15 + dim_sector.score * 0.15 + dim_missing.score * 0.10) * 100
      );

      const entry = pred.entryZoneLow ?? pred.priceAtGen;
      const pnlPct = entry && actualPrice ? parseFloat(((actualPrice - entry) / entry * 100).toFixed(1)) : null;
      // 2026-05-27: Codex 진단 — actualPrice (마지막 close) 만 보면 intraperiod 에
      // hit/stop 한 케이스 미검출. highs/lows 로 day-by-day 검사 (worst-case stop 우선).
      let outcome: EvaluatedPrediction['outcome'] = 'still_holding';
      if (!dim_entry.reached) {
        outcome = 'not_entered';
      } else {
        const n = Math.min(highs?.length ?? 0, lows?.length ?? 0);
        let resolved = false;
        for (let i = 0; i < n; i++) {
          const high = highs[i], low = lows[i];
          if (!isFinite(high) || high <= 0 || !isFinite(low) || low <= 0) continue;
          if (pred.stopLoss && low <= pred.stopLoss * 1.02) { outcome = 'stop_loss'; resolved = true; break; }
          if (pred.target && high >= pred.target * 0.98) { outcome = 'hit_target'; resolved = true; break; }
        }
        if (!resolved) outcome = 'still_holding';
      }

      const evaled: EvaluatedPrediction = {
        ...pred, evaluatedAt: now, priceAtEval: actualPrice, ohlcDays: closes.length,
        dim_direction, dim_entry, dim_target, dim_risk, dim_sector, dim_missing,
        quality_score, quality_grade: grade(quality_score),
        what_i_missed: generateWhatIMissed({ reportStance: pred.reportStance, dim_direction, dim_entry, dim_target, dim_risk, dim_sector, dim_missing }),
        outcome, pnlPct,
      };
      newEval.push(evaled);
    } catch { /* skip this ticker */ }
  }

  const remaining = due.slice(8);
  const updatedEval = [...newEval, ...evaluated].slice(0, 100);
  await Promise.allSettled([
    loggedRedisSet(redis, 'retro', PRED_KEY, [...notDue, ...remaining], { ex: 90 * 86400 }),
    loggedRedisSet(redis, 'retro', EVAL_KEY, updatedEval, { ex: 180 * 86400 }),
  ]);

  // 집계 점수 업데이트
  if (newEval.length) await updateAggregateScores(redis, updatedEval);
  // 교훈 텍스트 업데이트
  await updateLessons(redis, updatedEval.slice(0, 20));

  return { evaluated: newEval.length };
}

async function updateAggregateScores(redis: Redis, evals: EvaluatedPrediction[]): Promise<void> {
  const n = evals.length;
  if (!n) return;
  const agg: AggregateScores = {
    samples: n,
    avg_quality:   Math.round(evals.reduce((s,e) => s + e.quality_score, 0) / n),
    avg_direction: parseFloat((evals.reduce((s,e) => s + e.dim_direction.score, 0) / n).toFixed(2)),
    avg_entry:     parseFloat((evals.reduce((s,e) => s + e.dim_entry.score, 0) / n).toFixed(2)),
    avg_target:    parseFloat((evals.reduce((s,e) => s + e.dim_target.score, 0) / n).toFixed(2)),
    avg_risk:      parseFloat((evals.reduce((s,e) => s + e.dim_risk.score, 0) / n).toFixed(2)),
    avg_sector:    parseFloat((evals.reduce((s,e) => s + e.dim_sector.score, 0) / n).toFixed(2)),
    avg_missing:   parseFloat((evals.reduce((s,e) => s + e.dim_missing.score, 0) / n).toFixed(2)),
    updatedAt: new Date().toISOString(),
  };
  await loggedRedisSet(redis, 'retro', SCORES_KEY, agg, { ex: 90 * 86400 });
}

async function updateLessons(redis: Redis, evals: EvaluatedPrediction[]): Promise<void> {
  const agg = await redis.get<AggregateScores>(SCORES_KEY);
  if (!agg) return;

  // S2: 전술적 (entry/target calibration)
  const s2Lines: string[] = [
    `[PORTFOLIO RETROSPECTIVE — Entry/Target Calibration, ${agg.samples} samples]`,
    `품질점수 평균: ${agg.avg_quality}/100 | Entry: ${(agg.avg_entry*100).toFixed(0)}% | Target: ${(agg.avg_target*100).toFixed(0)}%`,
  ];
  if (agg.avg_entry < 0.6) s2Lines.push(`→ entryZone을 현재가 +3~5% 높게 설정 필요 (${((1-agg.avg_entry)*100).toFixed(0)}% 미도달)`);
  if (agg.avg_target < 0.5) s2Lines.push(`→ target 과공격적, ATR×2 이내로 보수적 설정 권장`);
  const recentMissed = Array.from(new Set(evals.flatMap(e => e.what_i_missed))).slice(0, 4);
  if (recentMissed.length) s2Lines.push(`최근 교훈: ${recentMissed.join(' | ')}`);

  // S7: 전략적 (direction/missing signals)
  const s7Lines: string[] = [
    `[CRITIC RETROSPECTIVE — Direction & Missing Signals, ${agg.samples} samples]`,
    `Direction: ${(agg.avg_direction*100).toFixed(0)}% | Risk ID: ${(agg.avg_risk*100).toFixed(0)}% | Missing: ${(agg.avg_missing*100).toFixed(0)}%`,
  ];
  if (agg.avg_direction < 0.6) s7Lines.push(`→ macro 스탠스 과신 패턴 — draft 리뷰 시 반대 시나리오 추가`);
  const missedSignals = Array.from(new Set(evals.flatMap(e => e.dim_missing.missedSignals))).slice(0, 5);
  if (missedSignals.length) s7Lines.push(`자주 누락된 신호: ${missedSignals.join(', ')} — 현재 context에도 존재하는지 확인`);

  await Promise.allSettled([
    loggedRedisSet(redis, 'retro', LESSONS_S2, s2Lines.join('\n'), { ex: 90 * 86400 }),
    loggedRedisSet(redis, 'retro', LESSONS_S7, s7Lines.join('\n'), { ex: 90 * 86400 }),
  ]);
}

/** S2(portfolio) 프롬프트에 주입할 전술 교훈 */
export async function getRetrospectiveForS2(redis: Redis): Promise<string> {
  try { return (await redis.get<string>(LESSONS_S2)) ?? ''; } catch { return ''; }
}

/** S7(critic) 프롬프트에 주입할 전략 교훈 */
export async function getRetrospectiveForS7(redis: Redis): Promise<string> {
  try { return (await redis.get<string>(LESSONS_S7)) ?? ''; } catch { return ''; }
}

/** 최근 평균 점수 조회 */
export async function getAggregateScores(redis: Redis): Promise<AggregateScores|null> {
  try { return await redis.get<AggregateScores>(SCORES_KEY); } catch { return null; }
}

/** @deprecated v1 compat */
export async function getRetrospectiveSummary(redis: Redis): Promise<string> {
  return getRetrospectiveForS2(redis);
}
