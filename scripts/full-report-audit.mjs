import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import Database from 'better-sqlite3';

const REPORTS_DIR = 'C:/NoAddsMakingApps/FlowVium/reports';
const DB_PATH = 'C:/NoAddsMakingApps/FlowVium/data/flowvium.db';

// ── 1. 전체 보고서 메타 + harness 추세 ──
const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('-ko.json')).sort();
console.log(`=== 전체 보고서 ${files.length}건 메타분석 ===\n`);

const reportStats = [];
for (const f of files) {
  try {
    const r = JSON.parse(readFileSync(resolve(REPORTS_DIR, f), 'utf8'));
    const fixes = r.harnessAudit?.totalFixes ?? 0;
    const port = r.portfolio ?? [];
    const buys = port.filter(p => p.action === 'buy').length;
    const watches = port.filter(p => p.action === 'watch').length;
    const holds = port.filter(p => p.action === 'hold').length;
    const hasPlan = port.filter(p => p.entryPlan).length;
    const undefinedEntry = port.filter(p => !p.entryZone || p.entryZone === 'undefined').length;
    const tickers = port.map(p => p.ticker).join(',');
    const date = f.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '?';
    const session = f.match(/(morning|afternoon|evening)/)?.[1] ?? '?';
    reportStats.push({ date, session, fixes, total: port.length, buys, watches, holds, hasPlan, undefinedEntry, tickers, source: r.source ?? '?' });
  } catch (e) { /* skip non-ko or broken */ }
}

console.log('date        session    src                 fix  tot buy wat hld plan undef');
console.log('-'.repeat(90));
for (const s of reportStats) {
  console.log(
    s.date.padEnd(12) + s.session.padEnd(11) +
    (s.source ?? '?').slice(0, 20).padEnd(21) +
    String(s.fixes).padStart(3) + String(s.total).padStart(5) +
    String(s.buys).padStart(4) + String(s.watches).padStart(4) +
    String(s.holds).padStart(4) + String(s.hasPlan).padStart(5) +
    String(s.undefinedEntry).padStart(6)
  );
}

// ── 2. Harness fix 추세 ──
console.log('\n=== Harness fix 추세 ===');
const fixTotals = reportStats.map(s => s.fixes);
console.log('  min=' + Math.min(...fixTotals) + ' max=' + Math.max(...fixTotals) + ' avg=' + (fixTotals.reduce((a,b)=>a+b,0)/fixTotals.length).toFixed(1));
console.log('  최근 5건:', fixTotals.slice(-5).join(', '));

// ── 3. 반복 ticker 분석 ──
console.log('\n=== Ticker 출현 빈도 (전체 보고서) ===');
const tickerCount = {};
for (const s of reportStats) {
  for (const t of s.tickers.split(',')) {
    if (t) tickerCount[t] = (tickerCount[t] || 0) + 1;
  }
}
Object.entries(tickerCount).sort((a,b) => b[1] - a[1]).slice(0, 15).forEach(([t, c]) => {
  console.log('  ' + t.padEnd(12) + ' x' + c + '/' + reportStats.length + ' (' + (c/reportStats.length*100).toFixed(0) + '%)');
});

// ── 4. DB outcome 상세 분석 ──
console.log('\n=== DB Outcome 분석 ===');
const db = new Database(DB_PATH, { readonly: true });

// 전체 outcome 분포
const outcomes = db.prepare(`SELECT outcome, COUNT(*) AS c FROM recommendation_outcomes GROUP BY outcome ORDER BY c DESC`).all();
const total = outcomes.reduce((s,o) => s + o.c, 0);
console.log('\n전체 outcome 분포 (' + total + '건):');
outcomes.forEach(o => console.log('  ' + (o.outcome||'?').padEnd(16) + String(o.c).padStart(4) + ' (' + (o.c/total*100).toFixed(1) + '%)'));

// ticker별 적중률
console.log('\n=== Ticker별 적중률 (진입한 것만) ===');
const tickerPerf = db.prepare(`
  SELECT r.ticker,
    SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN o.outcome='stop_loss' THEN 1 ELSE 0 END) AS stops,
    SUM(CASE WHEN o.outcome='still_holding' THEN 1 ELSE 0 END) AS holding,
    SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) AS ne,
    COUNT(*) AS tot,
    AVG(CASE WHEN o.pnl_pct IS NOT NULL AND o.outcome != 'not_entered' THEN o.pnl_pct ELSE NULL END) AS avg_pnl
  FROM recommendation_outcomes o
  JOIN recommendations r ON r.id = o.recommendation_id
  GROUP BY r.ticker
  HAVING tot >= 3
  ORDER BY ne DESC
`).all();
console.log('ticker       hit  stop hold  NE  tot  hit%  avg_pnl');
for (const t of tickerPerf) {
  const entered = t.hits + t.stops + t.holding;
  const hitPct = entered > 0 ? (t.hits / entered * 100).toFixed(0) : '-';
  console.log(
    (t.ticker||'?').padEnd(13) +
    String(t.hits).padStart(3) + String(t.stops).padStart(5) +
    String(t.holding).padStart(5) + String(t.ne).padStart(4) +
    String(t.tot).padStart(5) +
    String(hitPct + '%').padStart(6) +
    (t.avg_pnl != null ? (' ' + t.avg_pnl.toFixed(1) + '%') : '   -')
  );
}

// action 별 성과
console.log('\n=== Action별 성과 ===');
const actionPerf = db.prepare(`
  SELECT r.action,
    SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN o.outcome='stop_loss' THEN 1 ELSE 0 END) AS stops,
    SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) AS ne,
    COUNT(*) AS tot,
    AVG(CASE WHEN o.pnl_pct IS NOT NULL AND o.outcome != 'not_entered' THEN o.pnl_pct ELSE NULL END) AS avg_pnl
  FROM recommendation_outcomes o
  JOIN recommendations r ON r.id = o.recommendation_id
  GROUP BY r.action
`).all();
for (const a of actionPerf) {
  const entered = a.hits + a.stops + (a.tot - a.ne - a.hits - a.stops);
  console.log('  ' + (a.action||'?').padEnd(8)
    + ' hit=' + a.hits + ' stop=' + a.stops + ' ne=' + a.ne + ' tot=' + a.tot
    + (a.avg_pnl != null ? ' avg_pnl=' + a.avg_pnl.toFixed(1) + '%' : ''));
}

// confidence별 성과
console.log('\n=== Confidence별 적중률 ===');
const confPerf = db.prepare(`
  SELECT r.confidence,
    SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN o.outcome='stop_loss' THEN 1 ELSE 0 END) AS stops,
    SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) AS ne,
    COUNT(*) AS tot
  FROM recommendation_outcomes o
  JOIN recommendations r ON r.id = o.recommendation_id
  GROUP BY r.confidence
`).all();
for (const c of confPerf) {
  const entered = c.tot - c.ne;
  const hitPct = entered > 0 ? (c.hits / entered * 100).toFixed(0) : '-';
  console.log('  ' + (c.confidence||'?').padEnd(8) + ' hit=' + c.hits + '/' + entered + '=' + hitPct + '% stop=' + c.stops + ' ne=' + c.ne + '/' + c.tot);
}

// 날짜별 추세
console.log('\n=== 날짜별 outcome 추세 ===');
const daily = db.prepare(`
  SELECT substr(o.evaluated_at, 1, 10) AS d,
    SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN o.outcome='stop_loss' THEN 1 ELSE 0 END) AS stops,
    SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) AS ne,
    SUM(CASE WHEN o.outcome='still_holding' THEN 1 ELSE 0 END) AS hold,
    COUNT(*) AS tot
  FROM recommendation_outcomes o
  GROUP BY d
  ORDER BY d
`).all();
for (const d of daily) {
  const entered = d.tot - d.ne;
  const hitPct = entered > 0 ? (d.hits / entered * 100).toFixed(0) : '-';
  console.log('  ' + d.d + ' hit=' + d.hits + '/' + entered + '(' + hitPct + '%) stop=' + d.stops + ' ne=' + d.ne + ' hold=' + d.hold + ' tot=' + d.tot);
}

// not_entered 세부: entry_high vs price_at_eval
console.log('\n=== not_entered 환각 분해 ===');
const ne = db.prepare(`
  SELECT r.ticker, r.entry_low, r.entry_high, o.price_at_eval, o.low_seen, o.high_seen
  FROM recommendation_outcomes o
  JOIN recommendations r ON r.id = o.recommendation_id
  WHERE o.outcome = 'not_entered'
    AND r.entry_high IS NOT NULL AND o.price_at_eval IS NOT NULL
`).all();
let halluc=0, narrowMiss=0, wideMiss=0;
for (const r of ne) {
  const ratio = r.entry_high / r.price_at_eval;
  if (ratio < 0.85) halluc++;
  else if (r.low_seen && r.low_seen > r.entry_high && (r.low_seen - r.entry_high) / r.price_at_eval < 0.03) narrowMiss++;
  else wideMiss++;
}
console.log('  환각 (entry < eval×0.85): ' + halluc);
console.log('  근접 미달 (low가 entry 3% 이내): ' + narrowMiss);
console.log('  넓은 미달: ' + wideMiss);

db.close();
