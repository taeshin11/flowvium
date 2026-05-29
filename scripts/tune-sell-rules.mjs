#!/usr/bin/env node
/**
 * scripts/tune-sell-rules.mjs
 *
 * Karpathy pathway 의 학습 단계.
 * 과거 sell_recommendations + 14일 후 가격 변화 데이터로 룰 임계값 grid search.
 * 추가로 recommendation_outcomes 의 buy outcome 도 함께 학습 (어떤 매도 룰이
 * 적중 시 buy 측 entry/target/stop 도 자동 조정 가능).
 *
 * 출력: data/sell-rules-tuned.json 업데이트 (rules + outcomeStats 갱신).
 * 실행 (주 1회):
 *   node scripts/tune-sell-rules.mjs
 */
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RULES_PATH = resolve(ROOT, 'data/sell-rules-tuned.json');
const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });

const spec = JSON.parse(readFileSync(RULES_PATH, 'utf8'));

// ── [1] sell_outcomes 평가: 매도 추천 후 14일 가격 변화 ─────────────────────────
console.log('▶ sell_outcomes 평가 (매도 후 14일 가격 변화 기반)');

const sellRecs = db.prepare(`
  SELECT s.id, s.ticker, s.market, s.sell_type, s.urgency, s.score,
         s.current_price, s.generated_at, s.evaluate_after,
         o.price_at_eval, o.price_delta_pct, o.outcome
  FROM sell_recommendations s
  LEFT JOIN sell_outcomes o ON o.sell_rec_id = s.id
  WHERE s.evaluate_after <= datetime('now')
`).all();

console.log(`  ${sellRecs.length} 매도 추천 평가 가능 (evaluate_after <= now)`);

// 룰 type 별 outcome 집계
const ruleStats = {};
for (const s of sellRecs) {
  const key = s.sell_type ?? 'unknown';
  if (!ruleStats[key]) ruleStats[key] = { n: 0, evaluated: 0, correctSell: 0, premature: 0, neutral: 0, avgDelta: 0, deltaSum: 0 };
  ruleStats[key].n++;
  if (s.outcome) {
    ruleStats[key].evaluated++;
    if (s.outcome === 'correct_sell') ruleStats[key].correctSell++;
    else if (s.outcome === 'premature') ruleStats[key].premature++;
    else ruleStats[key].neutral++;
    if (s.price_delta_pct != null) ruleStats[key].deltaSum += s.price_delta_pct;
  }
}
for (const r of Object.values(ruleStats)) {
  if (r.evaluated > 0) r.avgDelta = Math.round((r.deltaSum / r.evaluated) * 10) / 10;
  // 매도 적중률 = correct_sell / evaluated (낮은 price_delta = 좋은 매도)
  r.precisionPct = r.evaluated > 0 ? Math.round((r.correctSell / r.evaluated) * 100) : null;
}

console.log('\n  룰 type 별 적중률 / 평균 매도 후 14d 가격 변화:');
for (const [type, r] of Object.entries(ruleStats)) {
  console.log(`    ${type.padEnd(28)} n=${r.n} 평가=${r.evaluated} 적중=${r.precisionPct ?? '-'}% Δ${r.avgDelta}%`);
}

// ── [2] buy outcome 기반 cross-learning: target / stop 임계값 grid search ─────
console.log('\n▶ buy outcome 기반 매도 룰 임계값 grid search');

const buyOutcomes = db.prepare(`
  SELECT r.ticker, r.target, r.stop_loss, r.price_at_gen,
         o.outcome, o.pnl_pct, o.high_seen, o.low_seen, o.ohlc_days
  FROM recommendations r
  JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  WHERE r.action = 'buy'
    AND o.outcome IN ('hit_target', 'stop_loss', 'still_holding')
    AND r.target IS NOT NULL AND r.stop_loss IS NOT NULL AND r.price_at_gen IS NOT NULL
`).all();

console.log(`  ${buyOutcomes.length} buy 평가 완료 데이터 활용`);

// target_near 임계값 grid: 0.85 / 0.88 / 0.9 / 0.92 / 0.95
function evalTargetNearThreshold(threshold) {
  let truePos = 0, falsePos = 0, missed = 0;
  for (const r of buyOutcomes) {
    if (!r.high_seen) continue;
    const targetNearTriggered = (r.high_seen / r.target) >= threshold && (r.high_seen / r.target) < 1.0;
    if (targetNearTriggered) {
      if (r.outcome === 'hit_target') truePos++;       // 좋음: 진짜 target 근접 후 hit
      else if (r.outcome === 'stop_loss') falsePos++;  // 나쁨: 매도했는데 stop 까지 갔음 (성급)
    } else if (r.outcome === 'hit_target') {
      missed++; // 매도 신호 못 잡음
    }
  }
  return { threshold, truePos, falsePos, missed, total: truePos + falsePos + missed,
           precision: truePos / Math.max(1, truePos + falsePos),
           recall: truePos / Math.max(1, truePos + missed) };
}
const targetGrid = [0.85, 0.88, 0.9, 0.92, 0.95];
const targetEval = targetGrid.map(evalTargetNearThreshold);
console.log('\n  target_near 임계값 grid:');
for (const e of targetEval) {
  const f1 = (2 * e.precision * e.recall) / Math.max(0.001, e.precision + e.recall);
  console.log(`    ${e.threshold} → P=${(e.precision*100).toFixed(0)}% R=${(e.recall*100).toFixed(0)}% F1=${(f1*100).toFixed(0)}% (tp=${e.truePos} fp=${e.falsePos} miss=${e.missed})`);
}
const bestTarget = targetEval.reduce((a, b) => {
  const f1a = (2 * a.precision * a.recall) / Math.max(0.001, a.precision + a.recall);
  const f1b = (2 * b.precision * b.recall) / Math.max(0.001, b.precision + b.recall);
  return f1b > f1a ? b : a;
});
console.log(`  → 최적 target_near 임계값: ${bestTarget.threshold}`);

// stop_near 임계값 grid: 1.02 / 1.05 / 1.08 / 1.10
function evalStopNearThreshold(threshold) {
  let truePos = 0, falsePos = 0, missed = 0;
  for (const r of buyOutcomes) {
    if (!r.low_seen) continue;
    const stopNearTriggered = (r.low_seen / r.stop_loss) <= threshold && (r.low_seen / r.stop_loss) > 1.0;
    if (stopNearTriggered) {
      if (r.outcome === 'stop_loss') truePos++;
      else if (r.outcome === 'hit_target') falsePos++;
    } else if (r.outcome === 'stop_loss') missed++;
  }
  return { threshold, truePos, falsePos, missed,
           precision: truePos / Math.max(1, truePos + falsePos),
           recall: truePos / Math.max(1, truePos + missed) };
}
const stopGrid = [1.02, 1.05, 1.08, 1.10];
const stopEval = stopGrid.map(evalStopNearThreshold);
console.log('\n  stop_near 임계값 grid:');
for (const e of stopEval) {
  const f1 = (2 * e.precision * e.recall) / Math.max(0.001, e.precision + e.recall);
  console.log(`    ${e.threshold} → P=${(e.precision*100).toFixed(0)}% R=${(e.recall*100).toFixed(0)}% F1=${(f1*100).toFixed(0)}%`);
}
const bestStop = stopEval.reduce((a, b) => {
  const f1a = (2 * a.precision * a.recall) / Math.max(0.001, a.precision + a.recall);
  const f1b = (2 * b.precision * b.recall) / Math.max(0.001, b.precision + b.recall);
  return f1b > f1a ? b : a;
});
console.log(`  → 최적 stop_near 임계값: ${bestStop.threshold}`);

// ── [3] sell-rules-tuned.json 업데이트 ──────────────────────────────────────────
let updated = 0;
for (const r of spec.rules) {
  if (r.id === 'price_target_near' && bestTarget.recall > 0) {
    if (r.condition.ratio_gte !== bestTarget.threshold) {
      console.log(`  ◇ price_target_near: ${r.condition.ratio_gte} → ${bestTarget.threshold}`);
      r.condition.ratio_gte = bestTarget.threshold;
      updated++;
    }
  }
  if (r.id === 'price_stop_near' && bestStop.recall > 0) {
    if (r.condition.ratio_lte !== bestStop.threshold) {
      console.log(`  ◇ price_stop_near: ${r.condition.ratio_lte} → ${bestStop.threshold}`);
      r.condition.ratio_lte = bestStop.threshold;
      updated++;
    }
  }
}

spec.tunedAt = new Date().toISOString();
spec.sampleSize = buyOutcomes.length;
spec.outcomeStats = ruleStats;
spec.gridSearch = {
  target_near: targetEval,
  stop_near: stopEval,
  best: { target_near: bestTarget.threshold, stop_near: bestStop.threshold },
};

writeFileSync(RULES_PATH, JSON.stringify(spec, null, 2) + '\n', 'utf8');
console.log(`\n✅ 룰 ${updated}개 임계값 업데이트 → ${RULES_PATH}`);
console.log(`  sample n=${spec.sampleSize}, tunedAt=${spec.tunedAt}`);

db.close();
