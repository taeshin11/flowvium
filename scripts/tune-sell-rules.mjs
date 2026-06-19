#!/usr/bin/env node
/**
 * scripts/tune-sell-rules.mjs
 *
 * Karpathy pathway 의 학습 단계 — 매도 룰 outcome back-tuning.
 *
 * 두 가지 학습을 수행한다:
 *   [A] 임계값 grid search (target_near / stop_near) — 기존 동작.
 *   [B] 룰 score(가중치) back-tuning — 각 매도 룰의 실제 발화 후 realized
 *       forward P&L 과 outcome(good_call/missed_upside/neutral)을 상관시켜
 *       "edge" 를 산출하고 score 를 재조정 제안/적용. (improvement #4)
 *
 * 데이터:
 *   - sell_recommendations.sell_type  = 발화한 룰 (rule id 로 정규화)
 *   - sell_outcomes.price_delta_pct   = 매도 신호 후 forward 가격 변화(%)
 *                                       (음수 = 매도 후 가격 하락 = 좋은 매도)
 *   - sell_outcomes.outcome           = good_call / missed_upside / neutral
 *   - recommendations + recommendation_outcomes = buy outcome (임계 grid 용)
 *
 * 실행 (기본 = DRY-RUN, 쓰기 없음):
 *   node scripts/tune-sell-rules.mjs            # 표 + 제안만 출력
 *   node scripts/tune-sell-rules.mjs --apply    # data/sell-rules-tuned.json 갱신 (.bak 백업)
 *
 * 주의: --apply 없이는 파일을 절대 수정하지 않는다 (사람 리뷰 후 적용).
 */
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, copyFileSync, renameSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RULES_PATH = resolve(ROOT, 'data/sell-rules-tuned.json');
const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });

const APPLY = process.argv.includes('--apply');

const spec = JSON.parse(readFileSync(RULES_PATH, 'utf8'));

// ── 룰 score back-tuning 파라미터 ───────────────────────────────────────────────
const MIN_SAMPLE = 5;        // 발화 표본 < 5 = 데이터 부족 → score 미변경
const MAX_CHANGE_PCT = 0.20; // cycle 당 score 변경 ±20% cap
const SCORE_MIN = 1;         // 절대 0 화 금지 — 룰은 항상 살아있음
const SCORE_MAX = 10;        // 기존 룰 score 최대치와 정합

/**
 * sell_recommendations.sell_type → sell-rules-tuned.json rule.id 정규화 매핑.
 * 과거 적재가 짧은 alias(stop_breach 등)를 쓴 시기가 있어 현재 rule id 로 통일.
 */
const SELL_TYPE_TO_RULE_ID = {
  stop_breach: 'price_stop_breach',
  price_stop_breach: 'price_stop_breach',
  stop_near: 'price_stop_near',
  price_stop_near: 'price_stop_near',
  target_near: 'price_target_near',
  price_target_near: 'price_target_near',
  dead_cross: 'tech_dead_cross',
  tech_dead_cross: 'tech_dead_cross',
  tech_200ma_breach: 'tech_200ma_breach',
  RSI_overbought: 'tech_rsi_overbought',
  rsi_overbought: 'tech_rsi_overbought',
  tech_rsi_overbought: 'tech_rsi_overbought',
  tech_volume_dry: 'tech_volume_dry',
  fund_margin_decline: 'fund_margin_decline',
  fund_pe_expansion: 'fund_pe_expansion',
  guru_lynch_overvalued: 'guru_lynch_overvalued',
  rotation_loss: 'rotation_loss',
  rotation_profit: 'rotation_profit',
  rotation_neutral: 'rotation_neutral',
  macro_high_risk: 'macro_high_risk',
  macro_vix_spike: 'macro_vix_spike',
  macro_fg_extreme_fear: 'macro_fg_extreme_fear',
  micro_sector_underweight: 'micro_sector_underweight',
  micro_region_bearish: 'micro_region_bearish',
  micro_news_negative: 'micro_news_negative',
  micro_insider_selling: 'micro_insider_selling',
  micro_13f_distribution: 'micro_13f_distribution',
  micro_options_put_flow: 'micro_options_put_flow',
  micro_supply_contract_loss: 'micro_supply_contract_loss',
};
const ruleIds = new Set(spec.rules.map((r) => r.id));
const normalizeRuleId = (sellType) => {
  if (!sellType) return null;
  return SELL_TYPE_TO_RULE_ID[sellType] ?? (ruleIds.has(sellType) ? sellType : null);
};

console.log(`▶ tune-sell-rules  (${APPLY ? 'APPLY — 파일 갱신' : 'DRY-RUN — 쓰기 없음'})`);

// ── [1] sell_outcomes 평가: 매도 추천 후 forward 가격 변화 ─────────────────────────
console.log('\n▶ [1] sell_outcomes 평가 (매도 후 forward 가격 변화 기반)');

const sellRecs = db.prepare(`
  SELECT s.id, s.ticker, s.market, s.sell_type, s.urgency, s.score,
         s.current_price, s.generated_at, s.evaluate_after,
         o.price_at_eval, o.price_delta_pct, o.outcome
  FROM sell_recommendations s
  LEFT JOIN sell_outcomes o ON o.sell_rec_id = s.id
  WHERE s.evaluate_after <= datetime('now')
`).all();

console.log(`  ${sellRecs.length} 매도 추천 평가 가능 (evaluate_after <= now)`);

// 룰 type(원문) 별 outcome 집계 — outcomeStats 보존용 (기존 호환).
const ruleStats = {};
for (const s of sellRecs) {
  const key = s.sell_type ?? 'unknown';
  if (!ruleStats[key]) ruleStats[key] = { n: 0, evaluated: 0, goodCall: 0, missedUpside: 0, neutral: 0, avgDelta: 0, deltaSum: 0 };
  ruleStats[key].n++;
  if (s.outcome) {
    ruleStats[key].evaluated++;
    if (s.outcome === 'good_call') ruleStats[key].goodCall++;
    else if (s.outcome === 'missed_upside') ruleStats[key].missedUpside++;
    else ruleStats[key].neutral++;
    if (s.price_delta_pct != null) ruleStats[key].deltaSum += s.price_delta_pct;
  }
}
for (const r of Object.values(ruleStats)) {
  if (r.evaluated > 0) r.avgDelta = Math.round((r.deltaSum / r.evaluated) * 10) / 10;
  // 매도 적중률 = good_call / evaluated (매도 후 하락 = 옳은 매도)
  r.precisionPct = r.evaluated > 0 ? Math.round((r.goodCall / r.evaluated) * 100) : null;
}

// ── [2] 룰 id 별 edge 산출 (score back-tuning 입력) ─────────────────────────────
//
// edge 정의:
//   매도 신호가 좋으려면 그 뒤로 가격이 떨어져야 한다(보유했으면 손실).
//   forward price_delta_pct 가 음수 → 매도가 손실을 회피 → 좋은 매도.
//
//   1) avoidedLossPct = -avg(price_delta_pct)
//        양수 = 평균적으로 매도 후 가격이 하락(손실 회피) → 좋음.
//        음수 = 매도 후 가격이 올랐음(상승 놓침) → 나쁨.
//   2) goodRate = good_call / evaluated  (0~1)
//
//   edge = avoidedLossPct/10 (≈ -1..+1 로 정규화) 의 60% + (goodRate-0.5)*2 의 40%
//        → 양수 edge = 가치 있는 룰, 음수 = 역효과.
const ruleEdge = {}; // ruleId → { fired, evaluated, avoidedLossPct, goodRate, edge }
for (const s of sellRecs) {
  const id = normalizeRuleId(s.sell_type);
  if (!id) continue;
  if (!ruleEdge[id]) ruleEdge[id] = { fired: 0, evaluated: 0, good: 0, missed: 0, neutral: 0, deltaSum: 0, fell: 0 };
  const e = ruleEdge[id];
  e.fired++;
  if (s.outcome && s.price_delta_pct != null) {
    e.evaluated++;
    e.deltaSum += s.price_delta_pct;
    if (s.price_delta_pct < 0) e.fell++;
    if (s.outcome === 'good_call') e.good++;
    else if (s.outcome === 'missed_upside') e.missed++;
    else e.neutral++;
  }
}
for (const e of Object.values(ruleEdge)) {
  e.avoidedLossPct = e.evaluated > 0 ? -(e.deltaSum / e.evaluated) : 0;
  e.goodRate = e.evaluated > 0 ? e.good / e.evaluated : 0;
  e.fellRate = e.evaluated > 0 ? e.fell / e.evaluated : 0;
  const lossComponent = Math.max(-1, Math.min(1, e.avoidedLossPct / 10)); // ±10% → ±1
  const callComponent = (e.goodRate - 0.5) * 2;                           // 0..1 → -1..+1
  e.edge = Math.round((lossComponent * 0.6 + callComponent * 0.4) * 100) / 100;
}

// ── [3] score back-tuning 제안 ──────────────────────────────────────────────────
//
// 매핑: edge ∈ [-1, +1] → score multiplier ∈ [1-MAX_CHANGE, 1+MAX_CHANGE].
//   edge=+1 → ×1.20, edge=0 → ×1.00, edge=-1 → ×0.80
// 표본 부족(evaluated < MIN_SAMPLE) 룰은 변경하지 않는다.
const proposals = []; // { id, fired, evaluated, edge, current, proposed, changed, reason }
for (const r of spec.rules) {
  // 2026-06-19(ChatGPT 지적): 구조적/음수 룰(ban·veto) 자동튜닝 금지 — clamp 가 부호·의미 뒤집음.
  if (r.tunable === false || r.score <= 0) {
    proposals.push({ id: r.id, fired: 0, evaluated: 0, edge: null, current: r.score, proposed: r.score, changed: false, reason: '구조적 룰(튜닝 제외)' });
    continue;
  }
  const e = ruleEdge[r.id];
  const current = r.score;
  if (!e || e.evaluated < MIN_SAMPLE) {
    proposals.push({
      id: r.id, fired: e?.fired ?? 0, evaluated: e?.evaluated ?? 0,
      edge: e?.edge ?? null, current, proposed: current, changed: false,
      reason: `표본부족(eval=${e?.evaluated ?? 0}<${MIN_SAMPLE})`,
    });
    continue;
  }
  const mult = 1 + Math.max(-MAX_CHANGE_PCT, Math.min(MAX_CHANGE_PCT, e.edge * MAX_CHANGE_PCT));
  let proposed = Math.round(current * mult);
  proposed = Math.max(SCORE_MIN, Math.min(SCORE_MAX, proposed)); // never 0, cap at bounds
  // 정수 반올림으로 cap 안에서 변화 0 일 수 있음 — 그대로 둠.
  proposals.push({
    id: r.id, fired: e.fired, evaluated: e.evaluated, edge: e.edge,
    avoidedLossPct: Math.round(e.avoidedLossPct * 10) / 10,
    goodRate: Math.round(e.goodRate * 100),
    current, proposed, changed: proposed !== current,
    reason: proposed !== current
      ? `edge=${e.edge} → ×${mult.toFixed(2)}`
      : `edge=${e.edge} (반올림 후 변화 없음)`,
  });
}

// 출력 표.
const pad = (v, n) => String(v).padEnd(n);
const padN = (v, n) => String(v).padStart(n);
console.log('\n▶ [2] 룰 score back-tuning 제안 (edge = forward-loss-avoided 60% + good-call rate 40%)');
console.log('  ' + pad('rule', 28) + padN('fired', 6) + padN('eval', 6) + padN('avoidΔ%', 9) + padN('good%', 7) + padN('edge', 7) + padN('cur', 5) + padN('→new', 6) + '  note');
console.log('  ' + '-'.repeat(96));
for (const p of proposals) {
  const mark = p.changed ? (p.proposed > p.current ? '▲' : '▼') : ' ';
  console.log('  ' + pad(p.id, 28)
    + padN(p.fired, 6)
    + padN(p.evaluated, 6)
    + padN(p.avoidedLossPct ?? '-', 9)
    + padN(p.goodRate != null ? p.goodRate + '%' : '-', 7)
    + padN(p.edge ?? '-', 7)
    + padN(p.current, 5)
    + padN(mark + p.proposed, 6)
    + '  ' + p.reason);
}
const changedScores = proposals.filter((p) => p.changed);
const tunable = proposals.filter((p) => p.evaluated >= MIN_SAMPLE);
console.log(`\n  요약: ${proposals.length} 룰 중 ${tunable.length} 룰 표본충분(eval≥${MIN_SAMPLE}), ${changedScores.length} 룰 score 변경 제안.`);

// ── [4] buy outcome 기반 cross-learning: target / stop 임계값 grid search ─────
console.log('\n▶ [3] buy outcome 기반 매도 룰 임계값 grid search');

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

function wilsonLB(wins, n, z = 1.96) {
  if (n <= 0) return 0;
  const p = wins / n;
  return (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n);
}
const MIN_FIRE = 8;
function evalTargetNearThreshold(threshold) {
  let truePos = 0, falsePos = 0, missed = 0;
  for (const r of buyOutcomes) {
    if (!r.high_seen) continue;
    const targetNearTriggered = (r.high_seen / r.target) >= threshold && (r.high_seen / r.target) < 1.0;
    if (targetNearTriggered) {
      if (r.outcome === 'hit_target') truePos++;
      else if (r.outcome === 'stop_loss') falsePos++;
    } else if (r.outcome === 'hit_target') {
      missed++;
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
const wScore = e => wilsonLB(e.truePos, e.truePos + e.falsePos) * e.recall;
let bestTarget = targetEval.reduce((a, b) => wScore(b) > wScore(a) ? b : a);
const targetFires = bestTarget.truePos + bestTarget.falsePos;
if (targetFires < MIN_FIRE) {
  console.log(`  ⚠️ target_near 발화 ${targetFires} < ${MIN_FIRE} (표본부족) → 임계 변경 보류(기존 유지). Wilson-LB 신뢰 불가.`);
  bestTarget = { ...bestTarget, threshold: null, lowConfidence: true };
}
console.log(`  → 최적 target_near 임계값: ${bestTarget.threshold ?? '(표본부족 — 미변경)'} (Wilson-LB P=${(wilsonLB(bestTarget.truePos, targetFires) * 100).toFixed(0)}%)`);

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
let bestStop = stopEval.reduce((a, b) => wScore(b) > wScore(a) ? b : a);
const stopFires = bestStop.truePos + bestStop.falsePos;
if (stopFires < MIN_FIRE) {
  console.log(`  ⚠️ stop_near 발화 ${stopFires} < ${MIN_FIRE} (표본부족) → 임계 변경 보류(기존 유지).`);
  bestStop = { ...bestStop, threshold: null, lowConfidence: true };
}
console.log(`  → 최적 stop_near 임계값: ${bestStop.threshold ?? '(표본부족 — 미변경)'} (Wilson-LB P=${(wilsonLB(bestStop.truePos, stopFires) * 100).toFixed(0)}%)`);

// ── [5] 적용 (--apply 일 때만 파일 쓰기) ────────────────────────────────────────
let thresholdUpdates = 0;
for (const r of spec.rules) {
  if (r.id === 'price_target_near' && bestTarget.threshold != null && bestTarget.recall > 0) {
    if (r.condition.ratio_gte !== bestTarget.threshold) {
      console.log(`  ◇ (제안) price_target_near 임계: ${r.condition.ratio_gte} → ${bestTarget.threshold}`);
      if (APPLY) { r.condition.ratio_gte = bestTarget.threshold; }
      thresholdUpdates++;
    }
  }
  if (r.id === 'price_stop_near' && bestStop.threshold != null && bestStop.recall > 0) {
    if (r.condition.ratio_lte !== bestStop.threshold) {
      console.log(`  ◇ (제안) price_stop_near 임계: ${r.condition.ratio_lte} → ${bestStop.threshold}`);
      if (APPLY) { r.condition.ratio_lte = bestStop.threshold; }
      thresholdUpdates++;
    }
  }
}

// 2026-06-19(ChatGPT #11): sell outcome 라벨이 비변별(거의 전부 neutral)이면 score 자동튜닝 동결 — 라벨 임계/평가
//   시점 연결을 먼저 고쳐야 함. 임계 grid(buy outcome 기반, 별개·신뢰도↑)는 유지. SELL_TUNE_FORCE=1 로 강제 가능.
const _totEval = Object.values(ruleStats).reduce((s, r) => s + r.evaluated, 0);
const _totNonNeutral = Object.values(ruleStats).reduce((s, r) => s + r.goodCall + r.missedUpside, 0);
const _discrim = _totEval > 0 ? _totNonNeutral / _totEval : 1;
const FREEZE_SCORE = _totEval >= 5 && _discrim < 0.15 && process.env.SELL_TUNE_FORCE !== '1';
if (FREEZE_SCORE) console.warn(`  ⚠️ [동결] sell outcome 비변별(non-neutral ${(_discrim * 100).toFixed(0)}% < 15%, eval ${_totEval}) — score 자동튜닝 SKIP(임계 grid 유지). 라벨링 수정 후 SELL_TUNE_FORCE=1.`);

if (APPLY) {
  // score 적용 (동결 시 SKIP).
  const proposalById = new Map(proposals.map((p) => [p.id, p]));
  if (!FREEZE_SCORE) for (const r of spec.rules) {
    const p = proposalById.get(r.id);
    if (p && p.changed) r.score = p.proposed;
  }
  spec.tunedAt = new Date().toISOString();
  spec.sampleSize = buyOutcomes.length;
  spec.outcomeStats = ruleStats;
  spec.scoreTuning = {
    minSample: MIN_SAMPLE,
    maxChangePct: MAX_CHANGE_PCT,
    edgeFormula: 'forward-loss-avoided*0.6 + (goodRate-0.5)*2*0.4',
    proposals: proposals.map((p) => ({
      id: p.id, fired: p.fired, evaluated: p.evaluated, edge: p.edge,
      current: p.current, applied: p.proposed, changed: p.changed,
    })),
  };
  spec.gridSearch = {
    target_near: targetEval,
    stop_near: stopEval,
    best: { target_near: bestTarget.threshold, stop_near: bestStop.threshold },
  };

  // .bak 백업 후 쓰기 — 원본 구조/포맷(2-space) 보존.
  const bakPath = RULES_PATH + '.bak';
  copyFileSync(RULES_PATH, bakPath);
  // 2026-06-19(ChatGPT #1): 원자적 교체 — tmp 쓰고 rename. 직접 덮어쓰기 중 부분 JSON 을 Next loader 가 읽는 race 방지.
  const tmpPath = RULES_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  renameSync(tmpPath, RULES_PATH);
  console.log(`\n✅ APPLY 완료 — score 변경 ${FREEZE_SCORE ? 0 : changedScores.length}${FREEZE_SCORE ? '(동결)' : ''}, 임계 변경 ${thresholdUpdates}.`);
  console.log(`   백업: ${bakPath}`);
  console.log(`   갱신: ${RULES_PATH}  (sample n=${spec.sampleSize})`);
} else {
  console.log('\n💡 DRY-RUN — 파일 미변경. 적용하려면:  node scripts/tune-sell-rules.mjs --apply');
  console.log(`   (적용 시 score 변경 ${changedScores.length}, 임계 변경 ${thresholdUpdates} 예정, .bak 백업 생성)`);
}

db.close();
