#!/usr/bin/env node
import Database from 'better-sqlite3';
const db = new Database('C:/Flowvium/data/flowvium.db', { readonly: true });

console.log('=== 전향적 평가 메커니즘 quality ===\n');

const totalRec = db.prepare('SELECT COUNT(*) c FROM recommendations').get().c;
const totalOut = db.prepare('SELECT COUNT(*) c FROM recommendation_outcomes').get().c;
console.log(`1) 평가 진행률: ${totalOut}/${totalRec} = ${((totalOut/totalRec)*100).toFixed(1)}%`);

const lastOut = db.prepare(`SELECT substr(evaluated_at,1,10) d, COUNT(*) c FROM recommendation_outcomes GROUP BY d ORDER BY d DESC LIMIT 7`).all();
console.log('\n2) 최근 7일 평가량:');
for (const r of lastOut) console.log(`   ${r.d}: ${r.c}건`);

const overdue = db.prepare(`SELECT ticker, evaluate_after, ROUND(julianday('now') - julianday(evaluate_after),1) days FROM recommendations WHERE action='buy' AND id NOT IN (SELECT recommendation_id FROM recommendation_outcomes) AND evaluate_after < date('now') AND evaluate_after IS NOT NULL ORDER BY days DESC LIMIT 10`).all();
console.log('\n3) 평가 기한 지났는데 미평가 (overdue):');
if (overdue.length === 0) console.log('   (없음)');
for (const r of overdue) console.log(`   ${r.ticker.padEnd(12)} eval_after=${r.evaluate_after} (${r.days}일 지남)`);

const status = db.prepare(`SELECT CASE WHEN id IN (SELECT recommendation_id FROM recommendation_outcomes) THEN 'evaluated' ELSE 'pending' END s, COUNT(*) c FROM recommendations WHERE action='buy' GROUP BY s`).all();
console.log('\n4) buy 평가 상태:');
for (const r of status) console.log(`   ${r.s}: ${r.c}`);

const quality = db.prepare(`SELECT outcome, COUNT(*) c, ROUND(AVG(pnl_pct),1) avg_ret FROM recommendation_outcomes GROUP BY outcome ORDER BY c DESC`).all();
console.log('\n5) 누적 quality:');
console.log('   outcome         n      avg_ret%');
for (const r of quality) console.log(`   ${r.outcome.padEnd(15)} ${String(r.c).padEnd(6)} ${r.avg_ret ?? 'N/A'}`);

const topAcc = db.prepare(`SELECT r.ticker, COUNT(*) n, SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) hits, SUM(CASE WHEN o.outcome='stop_loss' THEN 1 ELSE 0 END) stops, SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) ne, ROUND(AVG(o.pnl_pct),1) avg_pnl FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id WHERE r.action='buy' GROUP BY r.ticker HAVING n >= 4 ORDER BY hits*1.0/n DESC, n DESC LIMIT 12`).all();
console.log('\n6) Top hit rate (n >= 4):');
console.log('   ticker        n     hit  stop  NE   hit%   avg_pnl%');
for (const r of topAcc) {
  const hitRate = ((r.hits / r.n) * 100).toFixed(0);
  console.log(`   ${r.ticker.padEnd(13)} ${String(r.n).padEnd(5)} ${String(r.hits).padEnd(4)} ${String(r.stops).padEnd(5)} ${String(r.ne).padEnd(4)} ${hitRate.padEnd(6)} ${r.avg_pnl}`);
}

const recent = db.prepare(`SELECT r.ticker, o.outcome, o.pnl_pct, o.evaluated_at FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id ORDER BY o.evaluated_at DESC LIMIT 10`).all();
console.log('\n7) 최근 평가 10건:');
for (const r of recent) console.log(`   ${r.evaluated_at?.slice(0,10)} ${r.ticker.padEnd(12)} ${r.outcome.padEnd(14)} ret=${r.pnl_pct?.toFixed(1) ?? 'null'}%`);

const lastRec = db.prepare(`SELECT substr(generated_at,1,10) d, COUNT(*) c FROM reports WHERE generated_at >= date('now','-7 days') GROUP BY d ORDER BY d DESC`).all();
console.log('\n8) 최근 7일 보고서 생성:');
for (const r of lastRec) console.log(`   ${r.d}: ${r.c}건`);
