#!/usr/bin/env node
/**
 * analyze-recs.mjs — Phase 1 outcome 마이닝
 *
 * SQLite 의 recommendations + outcomes 데이터 기반 종합 분석:
 *   1. ticker 별 hit rate / not_entered 비율 / avg pnl
 *   2. entry zone calibration 진단 (entry_high vs low_seen 차이)
 *   3. confidence-vs-outcome 상관
 *   4. sector 별 성과
 *   5. 컬링 (BAN) 후보 + 강화 (BOOST) 후보 자동 추천
 *
 * 사용:
 *   node scripts/analyze-recs.mjs              # 콘솔 요약
 *   node scripts/analyze-recs.mjs --json       # 머신리더블 JSON
 *   node scripts/analyze-recs.mjs --export     # data/ban-list.json + boost-list.json 자동 생성
 */
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { openDb, getTickerStats } from './lib/db.mjs';

const __d = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__d, '..');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const EXPORT = args.includes('--export');

const db = openDb();

// ── 1. ticker 통계 ────────────────────────────────────────────────────────────
const tickers = getTickerStats();

// ── 2. entry calibration: entry_high vs low_seen ──────────────────────────────
// not_entered 케이스의 entry_high 와 low_seen 차이 = "얼마나 더 위에 entry 잡았어야 했나"
const entryGapRows = db.prepare(`
  SELECT r.ticker,
         r.entry_high,
         o.low_seen,
         o.price_at_eval,
         o.outcome,
         (o.low_seen - r.entry_high) / r.entry_high * 100 AS gap_pct
  FROM recommendations r
  JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  WHERE o.outcome = 'not_entered'
    AND r.entry_high IS NOT NULL
    AND r.entry_high > 0
    AND o.low_seen IS NOT NULL
    AND o.low_seen > 0
`).all();

const entryGapByTicker = new Map();
for (const r of entryGapRows) {
  const list = entryGapByTicker.get(r.ticker) ?? [];
  list.push(r.gap_pct);
  entryGapByTicker.set(r.ticker, list);
}

// ── 3. confidence vs outcome ──────────────────────────────────────────────────
const confStats = db.prepare(`
  SELECT r.confidence,
         COUNT(o.id)                                              AS evaluated,
         SUM(CASE WHEN o.outcome='hit_target'  THEN 1 ELSE 0 END) AS hits,
         SUM(CASE WHEN o.outcome='stop_loss'   THEN 1 ELSE 0 END) AS stops,
         SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) AS skipped,
         ROUND(AVG(o.pnl_pct), 1)                                 AS avg_pnl
  FROM recommendations r
  JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  GROUP BY r.confidence
`).all();

// ── 4. sector 별 ──────────────────────────────────────────────────────────────
const sectorStats = db.prepare(`
  SELECT r.sector,
         COUNT(o.id)                                              AS evaluated,
         SUM(CASE WHEN o.outcome='hit_target'  THEN 1 ELSE 0 END) AS hits,
         SUM(CASE WHEN o.outcome='stop_loss'   THEN 1 ELSE 0 END) AS stops,
         SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) AS skipped,
         ROUND(AVG(o.pnl_pct), 1)                                 AS avg_pnl
  FROM recommendations r
  JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  WHERE r.sector IS NOT NULL
  GROUP BY r.sector
  ORDER BY evaluated DESC
`).all();

// ── 5. 컬링/부스트 추천 ───────────────────────────────────────────────────────
const BAN_CRITERIA = (t) => {
  if (t.evaluated < 2) return null;
  if (t.stops >= 2 && t.hits === 0) return 'BAN: 2+ stops, 0 hits';
  if (t.avg_pnl != null && t.avg_pnl < -10 && t.evaluated >= 2) return `BAN: avg_pnl ${t.avg_pnl}% < -10%`;
  return null;
};
const BOOST_CRITERIA = (t) => {
  if (t.evaluated < 3) return null;
  const hitRate = t.hits / t.evaluated;
  if (hitRate >= 0.5 && t.stops === 0) return `BOOST: ${(hitRate*100).toFixed(0)}% hit rate, 0 stops`;
  if (t.avg_pnl != null && t.avg_pnl > 20 && t.evaluated >= 4) return `BOOST: avg_pnl ${t.avg_pnl}% > 20%`;
  return null;
};

const banList = [];
const boostList = [];
for (const t of tickers) {
  const ban = BAN_CRITERIA(t);
  const boost = BOOST_CRITERIA(t);
  if (ban) banList.push({ ticker: t.ticker, reason: ban, evaluated: t.evaluated, hits: t.hits, stops: t.stops, avg_pnl: t.avg_pnl });
  if (boost) boostList.push({ ticker: t.ticker, reason: boost, evaluated: t.evaluated, hits: t.hits, stops: t.stops, avg_pnl: t.avg_pnl });
}

// ── JSON 출력 ─────────────────────────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify({ tickers, confStats, sectorStats, banList, boostList }, null, 2));
  process.exit(0);
}

// ── 사람용 리포트 ─────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}\n📊 Phase 1 — Outcome 분석 (FlowVium recommendations)\n${'='.repeat(70)}\n`);

// 1. 전체 요약
const allEvals = tickers.reduce((s, t) => s + t.evaluated, 0);
const allHits = tickers.reduce((s, t) => s + t.hits, 0);
const allStops = tickers.reduce((s, t) => s + t.stops, 0);
const allSkipped = tickers.reduce((s, t) => s + t.skipped, 0);
console.log(`총 평가: ${allEvals}건`);
console.log(`  hit_target:   ${allHits} (${(allHits/allEvals*100).toFixed(1)}%)`);
console.log(`  stop_loss:    ${allStops} (${(allStops/allEvals*100).toFixed(1)}%)`);
console.log(`  not_entered:  ${allSkipped} (${(allSkipped/allEvals*100).toFixed(1)}%)  ← 진입 미달성`);

// 2. Top tickers (5+ evaluations)
const topTickers = tickers.filter(t => t.evaluated >= 3).slice(0, 12);
console.log(`\n──── Ticker 별 (3+ 평가) ────`);
console.log(`ticker        | eval  hits stops skipped  hit%   avg_pnl`);
for (const t of topTickers) {
  const hitPct = t.evaluated > 0 ? (t.hits / t.evaluated * 100).toFixed(0) : '-';
  console.log(
    `${t.ticker.padEnd(13)} |  ${String(t.evaluated).padStart(3)}  ` +
    `${String(t.hits).padStart(3)} ${String(t.stops).padStart(4)}  ${String(t.skipped).padStart(5)}  ` +
    `${hitPct.padStart(3)}%   ${t.avg_pnl != null ? (t.avg_pnl > 0 ? '+' : '') + t.avg_pnl + '%' : '-'}`
  );
}

// 3. Entry calibration 진단
console.log(`\n──── Entry Calibration (not_entered 케이스 분석) ────`);
console.log(`ticker        | 샘플  중간값 gap%   진단`);
const gapInsights = [];
for (const [ticker, gaps] of entryGapByTicker.entries()) {
  if (gaps.length < 2) continue;
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const diagnosis = median > 5
    ? `entry 가 시장가 대비 ${median.toFixed(1)}% 낮음 — 거의 도달 불가`
    : median > 2
    ? `entry 가 시장가 -${median.toFixed(1)}% — 보수적`
    : `entry 가 적정 범위`;
  gapInsights.push({ ticker, samples: gaps.length, median, diagnosis });
  console.log(`${ticker.padEnd(13)} |  ${String(gaps.length).padStart(3)}  ${median.toFixed(1).padStart(5)}%  ${diagnosis}`);
}

// 4. Confidence calibration
console.log(`\n──── Confidence calibration ────`);
console.log(`conf       | eval  hits stops skipped hit%   avg_pnl`);
for (const c of confStats) {
  const hitPct = c.evaluated > 0 ? (c.hits / c.evaluated * 100).toFixed(0) : '-';
  console.log(
    `${(c.confidence ?? 'null').padEnd(10)} |  ${String(c.evaluated).padStart(3)}  ` +
    `${String(c.hits).padStart(3)} ${String(c.stops).padStart(4)}  ${String(c.skipped).padStart(5)}  ` +
    `${hitPct.padStart(3)}%   ${c.avg_pnl != null ? (c.avg_pnl > 0 ? '+' : '') + c.avg_pnl + '%' : '-'}`
  );
}

// 5. Sector
console.log(`\n──── Sector 별 ────`);
console.log(`sector                          | eval hits  hit%   avg_pnl`);
for (const s of sectorStats) {
  if (s.evaluated < 2) continue;
  const hitPct = s.evaluated > 0 ? (s.hits / s.evaluated * 100).toFixed(0) : '-';
  console.log(
    `${(s.sector ?? 'null').slice(0, 30).padEnd(31)} |  ${String(s.evaluated).padStart(3)} ${String(s.hits).padStart(3)}  ` +
    `${hitPct.padStart(3)}%   ${s.avg_pnl != null ? (s.avg_pnl > 0 ? '+' : '') + s.avg_pnl + '%' : '-'}`
  );
}

// 6. 컬링/부스트
console.log(`\n──── 🚫 BAN 후보 (allocation 0% / action=watch 강등) ────`);
if (banList.length === 0) console.log(`  (조건 충족 없음)`);
for (const b of banList) console.log(`  ${b.ticker.padEnd(13)}  ${b.reason}  [eval=${b.evaluated} hits=${b.hits} stops=${b.stops} pnl=${b.avg_pnl}%]`);

console.log(`\n──── 🚀 BOOST 후보 (allocation 상향 / 우선 추천) ────`);
if (boostList.length === 0) console.log(`  (조건 충족 없음)`);
for (const b of boostList) console.log(`  ${b.ticker.padEnd(13)}  ${b.reason}  [eval=${b.evaluated} hits=${b.hits} pnl=${b.avg_pnl}%]`);

// ── export ────────────────────────────────────────────────────────────────────
if (EXPORT) {
  const banPath = resolve(ROOT, 'data/ban-list.json');
  const boostPath = resolve(ROOT, 'data/boost-list.json');
  const calibPath = resolve(ROOT, 'data/entry-calibration.json');
  writeFileSync(banPath, JSON.stringify(banList, null, 2));
  writeFileSync(boostPath, JSON.stringify(boostList, null, 2));
  writeFileSync(calibPath, JSON.stringify(gapInsights, null, 2));
  console.log(`\n📦 Exported:`);
  console.log(`  ${banPath}  (${banList.length} ticker)`);
  console.log(`  ${boostPath}  (${boostList.length} ticker)`);
  console.log(`  ${calibPath}  (${gapInsights.length} ticker calibration)`);
}
