import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import Database from 'better-sqlite3';

const REPORTS_DIR = 'C:/Flowvium/reports';
const DB_PATH = 'C:/Flowvium/data/flowvium.db';

// ?? 1. ?꾩껜 蹂닿퀬??硫뷀? + harness 異붿꽭 ??
const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('-ko.json')).sort();
console.log(`=== ?꾩껜 蹂닿퀬??${files.length}嫄?硫뷀?遺꾩꽍 ===\n`);

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

// ?? 2. Harness fix 異붿꽭 ??
console.log('\n=== Harness fix 異붿꽭 ===');
const fixTotals = reportStats.map(s => s.fixes);
console.log('  min=' + Math.min(...fixTotals) + ' max=' + Math.max(...fixTotals) + ' avg=' + (fixTotals.reduce((a,b)=>a+b,0)/fixTotals.length).toFixed(1));
console.log('  理쒓렐 5嫄?', fixTotals.slice(-5).join(', '));

// ?? 3. 諛섎났 ticker 遺꾩꽍 ??
console.log('\n=== Ticker 異쒗쁽 鍮덈룄 (?꾩껜 蹂닿퀬?? ===');
const tickerCount = {};
for (const s of reportStats) {
  for (const t of s.tickers.split(',')) {
    if (t) tickerCount[t] = (tickerCount[t] || 0) + 1;
  }
}
Object.entries(tickerCount).sort((a,b) => b[1] - a[1]).slice(0, 15).forEach(([t, c]) => {
  console.log('  ' + t.padEnd(12) + ' x' + c + '/' + reportStats.length + ' (' + (c/reportStats.length*100).toFixed(0) + '%)');
});

// ?? 4. DB outcome ?곸꽭 遺꾩꽍 ??
console.log('\n=== DB Outcome 遺꾩꽍 ===');
const db = new Database(DB_PATH, { readonly: true });

// ?꾩껜 outcome 遺꾪룷
const outcomes = db.prepare(`SELECT outcome, COUNT(*) AS c FROM recommendation_outcomes GROUP BY outcome ORDER BY c DESC`).all();
const total = outcomes.reduce((s,o) => s + o.c, 0);
console.log('\n?꾩껜 outcome 遺꾪룷 (' + total + '嫄?:');
outcomes.forEach(o => console.log('  ' + (o.outcome||'?').padEnd(16) + String(o.c).padStart(4) + ' (' + (o.c/total*100).toFixed(1) + '%)'));

// ticker蹂??곸쨷瑜?
console.log('\n=== Ticker蹂??곸쨷瑜?(吏꾩엯??寃껊쭔) ===');
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

// action 蹂??깃낵
console.log('\n=== Action蹂??깃낵 ===');
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

// confidence蹂??깃낵
console.log('\n=== Confidence蹂??곸쨷瑜?===');
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

// ?좎쭨蹂?異붿꽭
console.log('\n=== ?좎쭨蹂?outcome 異붿꽭 ===');
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

// not_entered ?몃?: entry_high vs price_at_eval
console.log('\n=== not_entered ?섍컖 遺꾪빐 ===');
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
console.log('  ?섍컖 (entry < eval횞0.85): ' + halluc);
console.log('  洹쇱젒 誘몃떖 (low媛 entry 3% ?대궡): ' + narrowMiss);
console.log('  ?볦? 誘몃떖: ' + wideMiss);

db.close();
