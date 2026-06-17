#!/usr/bin/env node
/**
 * scripts/db-retrospective.mjs — DB 적재 상태 + 후향적/전향적 분석.
 */
import Database from 'better-sqlite3';

const db = new Database('D:/Flowvium/data/flowvium.db', { readonly: true });
const PAD = (s, n) => String(s ?? '').padEnd(n);

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  DB 적재 + 후향/전향 분석 — ' + new Date().toISOString().slice(0,19) + ' ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// ── 1. 테이블별 row count + 시계열 분포 ────────────────────────────────────
console.log('=== [1] DB 적재 상태 ===');
const tables = ['reports', 'recommendations', 'recommendation_outcomes', 'endpoint_snapshots'];
const counts = {};
for (const t of tables) {
  counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  console.log(`  ${PAD(t, 26)} ${counts[t]} rows`);
}

console.log('\n=== [2] reports — 날짜별 ===');
const dayReports = db.prepare(`
  SELECT substr(generated_at, 1, 10) AS d, COUNT(*) AS cnt, GROUP_CONCAT(session, ',') AS sessions
  FROM reports GROUP BY d ORDER BY d
`).all();
dayReports.forEach(r => console.log(`  ${r.d}  reports=${r.cnt}  sessions=${r.sessions}`));

console.log('\n=== [3] recommendations — 날짜별 + ticker 다양성 ===');
const dayRecs = db.prepare(`
  SELECT substr(generated_at, 1, 10) AS d, COUNT(*) AS cnt, COUNT(DISTINCT ticker) AS uniq
  FROM recommendations GROUP BY d ORDER BY d
`).all();
console.log('  date         total  unique_tickers');
dayRecs.forEach(r => console.log(`  ${r.d}   ${PAD(r.cnt, 6)} ${r.uniq}`));

// ── [4] 후향적: 과거 outcome 추세 (주 단위) ─────────────────────────────────
console.log('\n=== [4] 후향적 — 주 단위 outcome 추세 (buy only) ===');
const weeklyOutcome = db.prepare(`
  SELECT strftime('%Y-%W', r.generated_at) AS wk,
    COUNT(*) AS n,
    SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN o.outcome='stop_loss' THEN 1 ELSE 0 END) AS stops,
    SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) AS ne,
    SUM(CASE WHEN o.outcome='still_holding' THEN 1 ELSE 0 END) AS hold,
    ROUND(AVG(CASE WHEN o.outcome != 'not_entered' THEN o.pnl_pct END), 2) AS avg_pnl
  FROM recommendations r
  JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  WHERE r.action = 'buy'
  GROUP BY wk ORDER BY wk
`).all();
console.log('  week        n   hit/stop  ne   hold  avg_pnl');
weeklyOutcome.forEach(w => {
  const entered = w.n - w.ne;
  const hitPct = entered ? (w.hits / entered * 100).toFixed(0) : '-';
  console.log(`  ${PAD(w.wk,10)} ${PAD(w.n,4)} ${PAD(w.hits+'/'+w.stops,8)} ${PAD(w.ne,4)} ${PAD(w.hold,5)} ${PAD(w.avg_pnl??'-',7)}%  hit=${hitPct}%`);
});

console.log('\n=== [5] 전향적 — 현재 미평가 (overdue 대기) ===');
const pending = db.prepare(`
  SELECT r.id, r.ticker, r.action, r.entry_high, r.target, r.generated_at, r.evaluate_after
  FROM recommendations r
  LEFT JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  WHERE o.id IS NULL AND r.action = 'buy'
  ORDER BY r.evaluate_after
  LIMIT 15
`).all();
console.log('  ' + pending.length + '개 buy 미평가 (recent only)');
pending.slice(0, 8).forEach(p => {
  console.log(`  ${PAD(p.ticker,11)} entry=${p.entry_high}  target=${p.target}  eval_after=${p.evaluate_after?.slice(0,10) ?? '?'}`);
});

console.log('\n=== [6] ticker 별 누적 성과 (buy, evaluated) ===');
const tickerPerf = db.prepare(`
  SELECT r.ticker, COUNT(*) AS n,
    SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN o.outcome='stop_loss' THEN 1 ELSE 0 END) AS stops,
    SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) AS ne,
    ROUND(AVG(CASE WHEN o.outcome IN ('hit_target','stop_loss','still_holding') THEN o.pnl_pct END), 2) AS avg_pnl
  FROM recommendations r
  JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  WHERE r.action = 'buy'
  GROUP BY r.ticker
  HAVING n >= 3
  ORDER BY avg_pnl DESC
`).all();
console.log('  ticker      n   hit/stop/ne   avg_pnl');
tickerPerf.forEach(t => {
  const cls = (t.avg_pnl ?? 0) >= 10 ? '🌟' : (t.avg_pnl ?? 0) >= 3 ? '✅' : (t.avg_pnl ?? 0) < 0 ? '❌' : '⚠️';
  console.log(`  ${cls} ${PAD(t.ticker,10)} ${PAD(t.n,3)} ${PAD(t.hits+'/'+t.stops+'/'+t.ne,12)} ${(t.avg_pnl??0)}%`);
});

console.log('\n=== [7] harness fixes 추세 (보고서 quality 지표) ===');
const harnessTrend = db.prepare(`
  SELECT substr(generated_at,1,10) AS d, AVG(json_extract(audit_json,'$.totalFixes')) AS avg_fixes, COUNT(*) AS n
  FROM reports WHERE audit_json IS NOT NULL
  GROUP BY d ORDER BY d
`).all();
console.log('  date         avg_fixes  n_reports');
harnessTrend.forEach(h => console.log(`  ${h.d}   ${PAD(h.avg_fixes?.toFixed(1)??'?', 9)} ${h.n}`));

console.log('\n=== [8] endpoint_snapshots — endpoint 별 health ===');
const epHealth = db.prepare(`
  SELECT endpoint, COUNT(*) AS total,
    SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) AS ok_cnt,
    MAX(captured_at) AS last_capture
  FROM endpoint_snapshots
  WHERE captured_at >= datetime('now', '-7 days')
  GROUP BY endpoint ORDER BY ok_cnt DESC
`).all();
epHealth.forEach(e => {
  const rate = ((e.ok_cnt/e.total)*100).toFixed(0);
  const icon = rate === '100' ? '✅' : rate >= '90' ? '⚠️' : '❌';
  console.log(`  ${icon} ${PAD(e.endpoint, 38)} ${e.ok_cnt}/${e.total} (${rate}%)  last=${e.last_capture?.slice(0,16)}`);
});

db.close();
