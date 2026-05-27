#!/usr/bin/env node
/**
 * scripts/check-prospective-gaps.mjs — 전향적 연구 blind spot 분석
 *
 * 우리가 측정/평가했지만 활용 안 한 지표 + 측정조차 안 한 지표 + 잘못 해석한 지표.
 */
import Database from 'better-sqlite3';
const db = new Database('C:/NoAddsMakingApps/FlowVium/data/flowvium.db', { readonly: true });

console.log('═══════════════════════════════════════════════════════════');
console.log('  전향적 연구 blind spot 분석 — ' + new Date().toISOString().slice(0,19));
console.log('═══════════════════════════════════════════════════════════\n');

// ── BLIND SPOT 1: Confidence calibration 신뢰성 ────────────────────────────
console.log('## 1) Confidence calibration — high/medium/low 가 정말 hit 차이?\n');
const confCal = db.prepare(`
  SELECT r.confidence, COUNT(*) n,
    SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) hits,
    SUM(CASE WHEN o.outcome='stop_loss' THEN 1 ELSE 0 END) stops,
    SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) ne,
    ROUND(AVG(o.pnl_pct),1) avg_pnl,
    ROUND(AVG(CASE WHEN o.outcome IN ('hit_target','stop_loss','still_holding') THEN o.pnl_pct END),1) real_pnl
  FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
  WHERE r.action='buy' AND r.confidence IS NOT NULL
  GROUP BY r.confidence
`).all();
console.log('   conf      n     hit   stop  NE    hit%   avg_pnl%  real_pnl%(NE제외)');
for (const r of confCal) {
  const hitPct = ((r.hits / r.n) * 100).toFixed(0) + '%';
  console.log(`   ${String(r.confidence).padEnd(9)} ${String(r.n).padEnd(5)} ${String(r.hits).padEnd(5)} ${String(r.stops).padEnd(5)} ${String(r.ne).padEnd(5)} ${hitPct.padEnd(6)} ${String(r.avg_pnl ?? '').padEnd(9)} ${r.real_pnl ?? ''}`);
}
console.log('   → high vs medium 차이가 의미있는지? 신뢰도 calibration 정합성 점검.');

// ── BLIND SPOT 2: Alpha vs SPY (선택 알파 vs 시장 추종) ────────────────────
console.log('\n## 2) Alpha — SPY 대비 알파 (ticker selection 자체 가치)\n');
const alpha = db.prepare(`
  SELECT
    COUNT(*) n,
    ROUND(AVG(o.pnl_pct),2) ticker_avg,
    ROUND(AVG(o.spy_return),2) spy_avg,
    ROUND(AVG(o.pnl_pct - o.spy_return),2) alpha,
    SUM(CASE WHEN o.pnl_pct > o.spy_return THEN 1 ELSE 0 END) beat_spy,
    SUM(CASE WHEN o.pnl_pct < o.spy_return THEN 1 ELSE 0 END) lose_spy
  FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
  WHERE r.action='buy' AND o.outcome IN ('hit_target','stop_loss','still_holding') AND o.spy_return IS NOT NULL
`).get();
console.log(`   n=${alpha.n}, ticker avg=${alpha.ticker_avg}%, SPY avg=${alpha.spy_avg}%, ALPHA=${alpha.alpha}%`);
console.log(`   beat SPY: ${alpha.beat_spy} / lose: ${alpha.lose_spy} → win rate ${((alpha.beat_spy/(alpha.beat_spy+alpha.lose_spy))*100).toFixed(0)}%`);
console.log('   → ticker selection 이 단순 SPY 추종 보다 우월? 우월하면 진짜 alpha.');

// ── BLIND SPOT 3: Time-to-hit (빠른 hit vs 느린 hit) ──────────────────────
console.log('\n## 3) Time-to-hit — 평균 며칠 만에 hit/stop?\n');
const timeToHit = db.prepare(`
  SELECT
    o.outcome,
    COUNT(*) n,
    ROUND(AVG(o.ohlc_days),1) avg_days,
    MIN(o.ohlc_days) min_d, MAX(o.ohlc_days) max_d
  FROM recommendation_outcomes o
  WHERE o.outcome IN ('hit_target','stop_loss','still_holding','not_entered') AND o.ohlc_days IS NOT NULL
  GROUP BY o.outcome
`).all();
for (const r of timeToHit) {
  console.log(`   ${r.outcome.padEnd(14)} n=${String(r.n).padEnd(4)} avg=${r.avg_days}일 (range ${r.min_d}~${r.max_d})`);
}
console.log('   → hit_target 이 너무 빠르면 (e.g., <3일) target 이 너무 작게 설정된 거.');

// ── BLIND SPOT 4: 종목 다양성 감소 패턴 ───────────────────────────────────
console.log('\n## 4) 종목 다양성 — 매주 unique ticker 추세\n');
const divers = db.prepare(`
  SELECT
    strftime('%Y-W%W', generated_at) wk,
    COUNT(*) n_recs,
    COUNT(DISTINCT ticker) uniq,
    ROUND(100.0 * COUNT(DISTINCT ticker) / COUNT(*), 1) diversity_pct
  FROM recommendations
  WHERE action='buy'
  GROUP BY wk
  ORDER BY wk DESC LIMIT 6
`).all();
console.log('   week        n_recs  unique  diversity%');
for (const r of divers) {
  console.log(`   ${r.wk.padEnd(11)} ${String(r.n_recs).padEnd(7)} ${String(r.uniq).padEnd(7)} ${r.diversity_pct}%`);
}

// ── BLIND SPOT 5: hit_target 의 평균 pnl — target 이 작게 설정됐나? ──────
console.log('\n## 5) hit_target pnl 분포 — target 이 너무 보수적?\n');
const targetDist = db.prepare(`
  SELECT
    ROUND(MIN(o.pnl_pct),1) min_pnl,
    ROUND(AVG(o.pnl_pct),1) avg_pnl,
    ROUND(MAX(o.pnl_pct),1) max_pnl,
    COUNT(*) n
  FROM recommendation_outcomes o
  WHERE o.outcome='hit_target'
`).get();
console.log(`   hit_target n=${targetDist.n}, pnl: min ${targetDist.min_pnl}% / avg ${targetDist.avg_pnl}% / max ${targetDist.max_pnl}%`);
// hit_target +10% 미만 비율 (작은 target)
const smallTarget = db.prepare(`SELECT COUNT(*) c FROM recommendation_outcomes WHERE outcome='hit_target' AND pnl_pct < 10`).get().c;
const totalHit = db.prepare(`SELECT COUNT(*) c FROM recommendation_outcomes WHERE outcome='hit_target'`).get().c;
console.log(`   hit_target 중 pnl < +10% 비율: ${smallTarget}/${totalHit} = ${((smallTarget/totalHit)*100).toFixed(0)}%`);
console.log('   → 다수가 +10% 미만이면 target 이 너무 작게 설정됨 (= "쉬운 hit").');

// ── BLIND SPOT 6: Sector 별 hit rate — 어떤 sector 가 진짜 강했나? ────────
console.log('\n## 6) Sector hit rate — 어디서 진짜 잘 맞나?\n');
const sec = db.prepare(`
  SELECT
    COALESCE(r.sector, '(null)') sec,
    COUNT(*) n,
    SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) hits,
    SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) ne,
    ROUND(AVG(o.pnl_pct),1) avg_pnl,
    ROUND(AVG(o.pnl_pct - COALESCE(o.spy_return,0)),1) alpha
  FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
  WHERE r.action='buy'
  GROUP BY sec
  HAVING n >= 4
  ORDER BY hits*1.0/n DESC
`).all();
console.log('   sector                    n     hit   NE   hit%   avg_pnl%   alpha%');
for (const r of sec) {
  const hitPct = ((r.hits/r.n)*100).toFixed(0)+'%';
  console.log(`   ${r.sec.padEnd(25)} ${String(r.n).padEnd(5)} ${String(r.hits).padEnd(5)} ${String(r.ne).padEnd(4)} ${hitPct.padEnd(6)} ${String(r.avg_pnl).padEnd(10)} ${r.alpha}`);
}

// ── BLIND SPOT 7: NE 의 entry vs market gap 측정 안 됨 ────────────────────
console.log('\n## 7) NE 케이스의 entry gap 분포 — 얼마나 멀어서 진입 못함?\n');
const neGap = db.prepare(`
  SELECT
    r.ticker,
    COUNT(*) n_ne,
    ROUND(AVG((o.high_seen - r.entry_high) / r.entry_high * 100), 1) median_gap
  FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
  WHERE o.outcome='not_entered' AND r.entry_high > 0 AND o.high_seen IS NOT NULL
  GROUP BY r.ticker
  HAVING n_ne >= 3
  ORDER BY median_gap DESC LIMIT 10
`).all();
console.log('   ticker        n_NE   avg_gap%');
for (const r of neGap) console.log(`   ${r.ticker.padEnd(13)} ${String(r.n_ne).padEnd(6)} ${r.median_gap}%`);
console.log('   → 양수 gap% = 시장가가 entry 보다 위. 음수면 시장가가 더 낮아 진입 가능했어야 했음 (왜 NE?)');

// ── BLIND SPOT 8: still_holding 이 평가 기간 만료 후에도 처리됐나? ───────
console.log('\n## 8) still_holding — 평가 기간 만료 후 outcome 갱신 패턴\n');
const sh = db.prepare(`
  SELECT
    ROUND(AVG(o.pnl_pct),1) avg_pnl,
    ROUND(AVG(o.ohlc_days),1) avg_days,
    COUNT(*) n,
    SUM(CASE WHEN o.pnl_pct > 0 THEN 1 ELSE 0 END) profitable
  FROM recommendation_outcomes o
  WHERE o.outcome='still_holding'
`).get();
console.log(`   n=${sh.n}, avg_pnl=${sh.avg_pnl}%, avg_days=${sh.avg_days}일, profitable=${sh.profitable}/${sh.n} (${((sh.profitable/sh.n)*100).toFixed(0)}%)`);
console.log('   → "still_holding" 이 30% 차지. 평가 기간 끝나도 종결 outcome (close_at_period) 으로 안 옮겨감 = 측정 lag.');

// ── BLIND SPOT 9: Quality score 활용 안 됨 ───────────────────────────────
console.log('\n## 9) Quality score (DB 에 저장 — 활용?)\n');
const qs = db.prepare(`
  SELECT
    ROUND(AVG(o.quality_score),1) avg_qs,
    MIN(o.quality_score) min_qs,
    MAX(o.quality_score) max_qs,
    COUNT(o.quality_score) n
  FROM recommendation_outcomes o WHERE o.quality_score IS NOT NULL
`).get();
console.log(`   quality_score: n=${qs.n}, avg=${qs.avg_qs}, range=${qs.min_qs}~${qs.max_qs}`);
const qsByOutcome = db.prepare(`
  SELECT o.outcome, ROUND(AVG(o.quality_score),1) avg_qs, COUNT(*) n
  FROM recommendation_outcomes o WHERE o.quality_score IS NOT NULL
  GROUP BY o.outcome
`).all();
for (const r of qsByOutcome) console.log(`   ${r.outcome.padEnd(14)} avg_qs=${r.avg_qs} n=${r.n}`);
console.log('   → quality_score 가 outcome 과 상관 있나? 측정만 하고 보고서 prompt 에 반영 안 됨.');

// ── BLIND SPOT 10: 평가 burst 패턴 — cron 부정기 ──────────────────────────
console.log('\n## 10) 평가 cron 부정기 실행 — 평일 평가 0건?\n');
const evalBurst = db.prepare(`
  SELECT substr(evaluated_at,1,10) d, COUNT(*) c
  FROM recommendation_outcomes
  WHERE evaluated_at >= date('now','-30 days')
  GROUP BY d ORDER BY d DESC LIMIT 30
`).all();
const evalDays = new Map(evalBurst.map(r => [r.d, r.c]));
let zeroDays = 0, totalDays = 0;
for (let i = 0; i < 30; i++) {
  const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
  totalDays++;
  if (!evalDays.has(d)) zeroDays++;
}
console.log(`   최근 30일 중 평가 0건 일자: ${zeroDays}/${totalDays}`);
console.log(`   evaluate-signals cron 이 일요일 03:00 UTC 만 실행 → 주중 평가 누적 → 일요일 burst.`);
console.log(`   → eval_after 이미 지난 추천이 5-6일 동안 미평가 상태로 노출 (사용자에게는 stale).`);
