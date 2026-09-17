#!/usr/bin/env node
/**
 * backfill-bench-return.mjs — 과거 평가에 **시장에 맞춘 벤치마크**를 채운다. (2026-09-18 신설)
 *
 * 왜: 종전에는 한국 종목도 SPY 와 비교했다. 9월처럼 미국이 오르고 한국이 빠진 달에는
 *   한국 추천이 실제보다 훨씬 나쁘게 보인다 — 실측: 9월 한국 평균 -3.94% 를
 *   SPY 기준 -4.55%p 로 읽었지만 코스피(-2.2%) 기준으로는 -1.7%p 다.
 *   알파 = 수익 - 벤치마크 인데 오른쪽이 다른 시장이면 그 뺄셈은 알파가 아니다.
 *
 * 미국 종목은 기존 spy_return 을 그대로 옮긴다(계산이 이미 건별 보유구간이라 맞다).
 * 한국 종목은 코스피(^KS11) 시계열로 **추천 생성 → 평가 시각** 구간을 다시 낸다.
 * 시계열이 그 구간을 못 덮으면 비워 둔다 — 없는 값을 지어내지 않는다.
 *
 * 사용: node scripts/backfill-bench-return.mjs [--dry]
 */
import { openDb } from './lib/db.mjs';
import { fetchSpySeries, spyReturnBetween, spanOf } from './lib/spy-benchmark.mjs';

const DRY = process.argv.includes('--dry');
const db = openDb();
const isKR = (t) => /\.(KS|KQ)$/i.test(String(t ?? ''));

const rows = db.prepare(`
  SELECT o.id, o.evaluated_at, o.spy_return, r.ticker, r.generated_at
  FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id
  WHERE o.bench_return IS NULL AND o.pnl_pct IS NOT NULL
`).all();
const kr = rows.filter((r) => isKR(r.ticker));
const us = rows.filter((r) => !isKR(r.ticker));
console.log(`채울 행 ${rows.length}건 — 미국 ${us.length} · 한국 ${kr.length}`);

let kospi = [];
if (kr.length) {
  const span = spanOf([...kr.map((r) => ({ t: r.generated_at })), ...kr.map((r) => ({ t: r.evaluated_at }))], 't');
  kospi = await fetchSpySeries(span.minMs, span.maxMs, { symbol: '^KS11' });
  console.log(`코스피 시계열 ${kospi.length}일 (${new Date(span.minMs).toISOString().slice(0, 10)} ~ ${new Date(span.maxMs).toISOString().slice(0, 10)})`);
  if (!kospi.length) { console.error('❌ 코스피 시계열을 못 받았다 — 한국 행은 건드리지 않는다'); }
}

const upd = db.prepare('UPDATE recommendation_outcomes SET bench_symbol=?, bench_return=? WHERE id=?');
let nUS = 0, nKR = 0, skip = 0;
const run = db.transaction(() => {
  for (const r of us) {
    if (r.spy_return == null) { skip++; continue; }
    if (!DRY) upd.run('SPY', r.spy_return, r.id);
    nUS++;
  }
  for (const r of kr) {
    if (!kospi.length) { skip++; continue; }
    const v = spyReturnBetween(kospi, Date.parse(r.generated_at), Date.parse(r.evaluated_at));
    if (v == null) { skip++; continue; }   // 구간을 못 덮으면 비워 둔다
    if (!DRY) upd.run('^KS11', v, r.id);
    nKR++;
  }
});
run();
console.log(`${DRY ? '[미적용] ' : ''}채움 — 미국 ${nUS} · 한국 ${nKR} · 건너뜀 ${skip}`);
