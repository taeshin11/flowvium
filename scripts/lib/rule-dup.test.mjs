#!/usr/bin/env node
/**
 * rule-dup.test.mjs — "한 룰은 후보당 최대 한 번만 점수에 기여한다" 불변식 검증.
 *
 * 배경(2026-08-20 실측): Stage1 은 price 룰 중 ['price_oversold_gap','price_momentum_52w_high'] 만
 *   평가하고(generate-report-local.mjs:5344), Stage2 는 price 룰 중 price_oversold_gap 만 제외한다(:5384).
 *   두 하드코딩 목록이 어긋나 price_momentum_52w_high 가 양쪽에서 평가돼 score 5 가 두 번 더해졌다.
 *   DB 실측 4,092행 중 1,267행(31%)에서 중복. 52주 신고가에 안 걸리는 종목이 상대적으로 5점 불리해져
 *   순위가 뒤집혔다(326030.KS·278470.KS 가 KO/VRTX/AMGN 아래로 밀림).
 *
 * --since=YYYY-MM-DD 로 검사 구간 지정. 기본은 수정 이후 생성분만.
 */
import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const since = (process.argv.find(a => a.startsWith('--since=')) ?? '').split('=')[1] ?? '';
const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
const rows = since
  ? db.prepare('SELECT ticker, generated_at, matched_rules FROM buy_candidates WHERE generated_at >= ?').all(since)
  : db.prepare('SELECT ticker, generated_at, matched_rules FROM buy_candidates').all();

let scanned = 0, dupRows = 0;
const dupBy = new Map();
for (const r of rows) {
  let ids = [];
  try { ids = JSON.parse(r.matched_rules || '[]').map(m => m.ruleId ?? m); } catch { continue; }
  if (!ids.length) continue;
  scanned++;
  const seen = new Map();
  let hit = false;
  for (const id of ids) {
    seen.set(id, (seen.get(id) ?? 0) + 1);
    if (seen.get(id) === 2) { hit = true; dupBy.set(id, (dupBy.get(id) ?? 0) + 1); }
  }
  if (hit) dupRows++;
}
console.log(`  검사 구간: ${since || '전체'} · 후보행 ${scanned}건`);
if (!scanned) { console.log('  SKIP  검사할 행이 없다 (보고서 생성 후 다시 실행)'); process.exit(0); }
if (dupRows) {
  console.log(`  FAIL  중복 점수 ${dupRows}/${scanned}행 (${Math.round(100 * dupRows / scanned)}%)`);
  for (const [k, v] of [...dupBy].sort((a, b) => b[1] - a[1])) console.log(`          ${k.padEnd(32)} ${v}행`);
  console.log('\n결과: 실패 1건'); process.exit(1);
}
console.log(`  PASS  중복 점수 0건 — 한 룰당 최대 1회 기여 불변식 유지`);
console.log('\n결과: 전부 통과');
