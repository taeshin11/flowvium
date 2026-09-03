#!/usr/bin/env node
/**
 * 매도추천이 매수추천을 마감할 때 **시각 순서**를 지키는가.
 *
 * 2026-09-04 실측: pnl 이 없는 126건을 파 보니 청산 시각이 추천 시각보다 앞서 있었다 —
 *   005380.KS  06-03 추천 → 05-29 청산 (-5.2일)  Yahoo HTTP 400
 *   000270.KS  05-31 추천 → 05-31 청산 (같은 날) 거래일 0
 *   사지도 않은 것을 그 전에 판 것으로 기록돼 있었다. OHLC 구간이 음수라 손익 계산이 아예 불가능하다.
 * 원인: 매도추천이 나오면 그 종목의 열린 매수추천을 **시각 확인 없이 전부** 마감했다.
 */
let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };
const { openDb } = await import('./db.mjs');
const db = openDb();

// 지금 DB 에 시각이 뒤집힌 기록이 남아 있는가
const inverted = db.prepare(`
  SELECT COUNT(*) c FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id
   WHERE o.outcome = 'sold' AND datetime(o.evaluated_at) < datetime(r.generated_at)`).get().c;
inverted === 0
  ? ok('청산이 추천보다 앞선 기록 0건')
  : bad(`청산이 추천보다 앞선 기록 ${inverted}건 — 사지도 않은 것을 판 것으로 돼 있다`);

// 같은 시각 마감도 손익을 못 낸다(거래일 0)
const sameTime = db.prepare(`
  SELECT COUNT(*) c FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id
   WHERE o.outcome = 'sold' AND o.pnl_pct IS NULL
     AND datetime(o.evaluated_at) <= datetime(r.generated_at, '+1 day')`).get().c;
sameTime === 0
  ? ok('추천 당일에 마감돼 손익을 못 낸 기록 0건')
  : bad(`추천 당일 마감 + 손익 없음 ${sameTime}건 — OHLC 구간이 비어 계산이 안 된다`);

console.log(fail === 0 ? '\n✅ close-on-sell 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
