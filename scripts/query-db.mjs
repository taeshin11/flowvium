#!/usr/bin/env node
/**
 * query-db.mjs — local SQLite ad-hoc 분석 도구
 *
 * 사용:
 *   node scripts/query-db.mjs                  # 전체 요약
 *   node scripts/query-db.mjs --ticker=NVDA    # 특정 ticker hit rate
 *   node scripts/query-db.mjs --recent=10      # 최근 outcome 10건
 *   node scripts/query-db.mjs --sql="SELECT..."# 자유 SQL
 *   node scripts/query-db.mjs --hit-rate       # 전체 hit rate by ticker
 */
import { openDb, getSummary } from './lib/db.mjs';

const args = process.argv.slice(2);
const tickerArg = args.find(a => a.startsWith('--ticker='))?.split('=')[1];
const recentArg = parseInt(args.find(a => a.startsWith('--recent='))?.split('=')[1] ?? '0', 10);
const sqlArg = args.find(a => a.startsWith('--sql='))?.slice(6);
const HIT_RATE = args.includes('--hit-rate');

const db = openDb();

if (sqlArg) {
  console.log(`\n>>> ${sqlArg}\n`);
  try {
    const rows = db.prepare(sqlArg).all();
    console.table(rows.slice(0, 100));
    if (rows.length > 100) console.log(`(${rows.length} rows, showing first 100)`);
  } catch (e) {
    console.error(`SQL error: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (tickerArg) {
  const ticker = tickerArg.toUpperCase();
  console.log(`\n=== ${ticker} 추천 이력 ===\n`);
  const rows = db.prepare(`
    SELECT r.generated_at, r.action, r.confidence, r.allocation,
           r.entry_low, r.target, r.stop_loss, r.price_at_gen,
           o.outcome, o.pnl_pct, o.evaluated_at
    FROM recommendations r
    LEFT JOIN recommendation_outcomes o ON o.recommendation_id = r.id
    WHERE r.ticker = ?
    ORDER BY r.generated_at DESC
  `).all(ticker);
  console.table(rows);
  process.exit(0);
}

if (HIT_RATE) {
  console.log(`\n=== ticker 별 hit rate ===\n`);
  const rows = db.prepare(`
    SELECT r.ticker,
           COUNT(o.id) AS evaluated,
           SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) AS hits,
           SUM(CASE WHEN o.outcome='stop_loss' THEN 1 ELSE 0 END) AS stops,
           SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) AS skipped,
           ROUND(AVG(o.pnl_pct), 1) AS avg_pnl
    FROM recommendations r
    JOIN recommendation_outcomes o ON o.recommendation_id = r.id
    GROUP BY r.ticker
    HAVING evaluated > 0
    ORDER BY evaluated DESC, hits DESC
  `).all();
  console.table(rows);
  process.exit(0);
}

if (recentArg > 0) {
  console.log(`\n=== 최근 ${recentArg} outcome ===\n`);
  const rows = db.prepare(`
    SELECT o.evaluated_at, r.ticker, r.generated_at, o.outcome, o.pnl_pct, o.spy_return
    FROM recommendation_outcomes o
    JOIN recommendations r ON r.id = o.recommendation_id
    ORDER BY o.evaluated_at DESC
    LIMIT ?
  `).all(recentArg);
  console.table(rows);
  process.exit(0);
}

// 기본 요약
const s = getSummary();
console.log(`\n=== local SQLite 요약 (data/flowvium.db) ===\n`);
console.log(`보고서:       ${s.reports}`);
console.log(`엔드포인트 스냅샷: ${s.snapshots}`);
console.log(`추천:         ${s.recs} (pending=${s.pending}, overdue=${s.overdue})`);
console.log(`outcomes:    ${s.outcomes}`);
if (s.byOutcome.length) {
  console.log(`\noutcome 분포:`);
  for (const o of s.byOutcome) console.log(`  ${o.outcome.padEnd(15)} ${o.n}`);
}
if (s.byEndpoint.length) {
  console.log(`\n스냅샷 by endpoint:`);
  for (const e of s.byEndpoint) console.log(`  ${e.endpoint.padEnd(40)} ${e.n}`);
}
console.log(`\n명령어:`);
console.log(`  --ticker=NVDA            # 특정 ticker 이력`);
console.log(`  --recent=10              # 최근 평가`);
console.log(`  --hit-rate               # ticker 별 hit rate`);
console.log(`  --sql="SELECT ..."       # 자유 SQL`);
