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
 * --since=YYYY-MM-DD 로 검사 구간 지정. 기본은 수정일(FIXED_ON) 이후 생성분만 —
 *   기본이 전체 DB 였던 탓에 이미 고친 뒤에도 과거 행 때문에 계속 실패했다(문서와 코드 불일치).
 */
import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// 이 불변식이 코드에서 성립하게 된 날. 그 이전 행은 버그가 있던 시절의 기록이므로 다시 못 고친다 —
// 전체를 훑으면 이 테스트는 영원히 빨간불이고, 앞으로의 회귀를 알려주는 신호를 잃는다.
// (실측: 8/19 32행 중 17행 중복 → 8/20 39행 중 0행. 과거 감사는 --since=2026-07-01 처럼 명시.)
const FIXED_ON = '2026-08-20';
const since = (process.argv.find(a => a.startsWith('--since=')) ?? '').split('=')[1] ?? FIXED_ON;
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
