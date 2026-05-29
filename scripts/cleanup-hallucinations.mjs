#!/usr/bin/env node
/**
 * scripts/cleanup-hallucinations.mjs
 *
 * LLM 환각으로 적재된 결함 row 식별 + (옵션) 삭제.
 *
 * 식별 기준:
 *   A. candidate-tickers.json 풀에 없는 KR 6자리 ticker (.KS/.KQ)
 *   B. entry_low~entry_high mid 가 price_at_gen 대비 ±10% 초과 (entryZone 환각)
 *
 * 사용:
 *   node scripts/cleanup-hallucinations.mjs           # dry-run (식별만)
 *   node scripts/cleanup-hallucinations.mjs --apply   # 실제 DELETE
 *
 * 영향 테이블: recommendations + recommendation_outcomes (FK).
 * sell_recommendations / buy_candidates 는 영향 X (풀 기반).
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APPLY = process.argv.includes('--apply');
const ROOT = resolve(process.cwd());
const DB = resolve(ROOT, 'data/flowvium.db');
const POOL = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'));

const krSet = new Set();
for (const t of (POOL.tickers ?? [])) {
  const m = String(t).match(/^(\d{6})\.(KS|KQ)$/);
  if (m) { krSet.add(`${m[1]}.KS`); krSet.add(`${m[1]}.KQ`); }
}

const db = new Database(DB);

console.log('═══════════════════════════════════════════════════════════');
console.log(`  Hallucination Cleanup — ${APPLY ? '🔥 APPLY' : '🔍 DRY-RUN'}`);
console.log('═══════════════════════════════════════════════════════════\n');

// A. 풀 외 KR ticker
const recsA = db.prepare(`SELECT id, report_id, ticker, entry_low, entry_high, price_at_gen FROM recommendations WHERE ticker LIKE '%.K%'`).all();
const badA = recsA.filter(r => !krSet.has(r.ticker));
console.log(`## [A] 풀 외 KR ticker (LLM 환각 6자리 코드)`);
console.log(` 식별: ${badA.length} row`);
for (const r of badA) console.log(`   ❌ ${r.id.padEnd(40)} ${r.ticker}`);

// B. entryZone gap ±10% 초과
const recsB = db.prepare(`SELECT id, report_id, ticker, entry_low, entry_high, price_at_gen FROM recommendations WHERE price_at_gen IS NOT NULL AND entry_low IS NOT NULL AND entry_high IS NOT NULL`).all();
const badB = [];
for (const r of recsB) {
  if (!isFinite(r.entry_low) || !isFinite(r.entry_high) || !isFinite(r.price_at_gen) || r.price_at_gen <= 0) continue;
  const mid = (r.entry_low + r.entry_high) / 2;
  const gap = Math.abs(mid / r.price_at_gen - 1) * 100;
  if (gap > 10) badB.push({ ...r, gap });
}
console.log(`\n## [B] entryZone gap ±10% 초과 (가격 환각)`);
console.log(` 식별: ${badB.length} row`);
for (const r of badB) console.log(`   ❌ ${r.id.padEnd(40)} ${r.ticker.padEnd(10)} EZ=${r.entry_low}-${r.entry_high} real=${r.price_at_gen} gap=${r.gap.toFixed(0)}%`);

// 합집합
const allBadIds = new Set([...badA.map(r => r.id), ...badB.map(r => r.id)]);
console.log(`\n## 합집합: ${allBadIds.size} row`);

// outcomes 있는지 확인 (FK)
const outcomesAffected = db.prepare(`SELECT COUNT(*) c FROM recommendation_outcomes WHERE recommendation_id IN (${[...allBadIds].map(() => '?').join(',')})`).all(...allBadIds);
console.log(` recommendation_outcomes 영향: ${outcomesAffected[0]?.c ?? 0} row`);

if (!APPLY) {
  console.log('\n[DRY-RUN] 실제 삭제하려면 --apply 옵션 추가.');
  db.close();
  process.exit(0);
}

// 실제 삭제
const txn = db.transaction(() => {
  const delOut = db.prepare(`DELETE FROM recommendation_outcomes WHERE recommendation_id = ?`);
  const delRec = db.prepare(`DELETE FROM recommendations WHERE id = ?`);
  let nOut = 0, nRec = 0;
  for (const id of allBadIds) {
    nOut += delOut.run(id).changes;
    nRec += delRec.run(id).changes;
  }
  return { nOut, nRec };
});
const { nOut, nRec } = txn();
console.log(`\n✅ 삭제 완료 — recommendations ${nRec} row + recommendation_outcomes ${nOut} row.`);
db.close();
