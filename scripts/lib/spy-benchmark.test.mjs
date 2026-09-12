#!/usr/bin/env node
/**
 * spy-benchmark.test.mjs — 벤치마크가 그 추천의 *자기* 보유구간으로 재어졌는가.
 *
 * 배경(2026-09-12 실측): alpha(pnl - spy) 가 -2.17% 로 나와 "종목 선택이 SPY 추종보다
 *   못하다" 로 읽힌다. 그런데 그 뺄셈의 오른쪽이 건별로 재어진 값이 아니었다.
 *
 *   evaluate-recommendations.mjs:205 는 한 배치에서 **가장 오래된 추천 시점 → 지금** 의
 *   SPY 수익률을 한 번 구해(fetchSpyReturn(oldestGen, nowIso)) 그 배치의 모든 행에
 *   그대로 찍는다(:237). 그래서 4일 보유한 추천이 126일치 SPY 수익률과 비교된다.
 *
 *   실측 배치 2026-09-08T15:06:27.649Z — 보유기간 4.4일 ~ 126.1일이 한 배치에 섞여 있다.
 *   같은 파일의 backfill-spy-return.mjs 는 이미 건별로 맞춰 계산하고 있다(closeOnOrBefore).
 *   두 경로가 같은 컬럼에 다른 의미를 쓴다 — 그래서 집계가 뭘 재는지 알 수 없다.
 *
 * 쇼츠 조회수에서 배운 것과 같은 규칙이다: **나이를 맞춰서 비교한다.**
 *   비교 구간이 다르면 그 차이는 알파가 아니라 구간 길이다.
 */
import { requires } from './test-env.mjs';
await requires({ dbTables: ['recommendation_outcomes', 'recommendations'] });

import { openDb } from './db.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// ── [1] 순수 함수: 보유구간이 다르면 벤치마크도 달라야 한다 ──────────────────
const M = await import('./spy-benchmark.mjs').catch((e) => {
  bad(`spy-benchmark.mjs 없음: ${String(e.message).slice(0, 60)}`);
  return null;
});

if (M) {
  // 하루 1% 씩 오르는 가짜 SPY 10 거래일
  const DAY = 86400000;
  const t0 = Date.parse('2026-01-05T21:00:00Z');
  const series = Array.from({ length: 10 }, (_, i) => ({ tMs: t0 + i * DAY, close: 100 * (1.01 ** i) }));

  const short = M.spyReturnBetween(series, t0 + 7 * DAY, t0 + 9 * DAY);  // 2일 보유
  const long  = M.spyReturnBetween(series, t0,            t0 + 9 * DAY);  // 9일 보유
  (short !== null && long !== null && Math.abs(long - short) > 5)
    ? ok(`보유구간별로 다른 값 (2일 ${short}% vs 9일 ${long}%)`)
    : bad(`보유구간이 달라도 같은 값이 나온다 (2일 ${short}% vs 9일 ${long}%)`);

  Math.abs(short - 2.01) < 0.02
    ? ok('2일 구간 = +2.01% (1.01^2)')
    : bad(`2일 구간 계산이 틀렸다: ${short}% (기대 +2.01%)`);

  // 거래일이 아닌 시각은 그 *이전* 마지막 종가를 쓴다 (주말·휴장)
  const weekend = M.spyReturnBetween(series, t0 + 7 * DAY + 3600e3 * 5, t0 + 9 * DAY + 3600e3 * 5);
  Math.abs(weekend - short) < 0.02
    ? ok('거래일 아닌 시각은 직전 종가로 낙착')
    : bad(`직전 종가 낙착 실패: ${weekend}% vs ${short}%`);

  // 시계열 시작 이전 진입은 잴 수 없다 — series[0] 으로 떨어뜨려 잰 척하면 안 된다
  M.spyReturnBetween(series, t0 - 30 * DAY, t0 + 5 * DAY) === null
    ? ok('시계열 시작 이전 진입은 null (잰 척하지 않는다)')
    : bad(`시계열 밖 진입에 값을 만들어 낸다: ${M.spyReturnBetween(series, t0 - 30 * DAY, t0 + 5 * DAY)}%`);

  M.spyReturnBetween([], t0, t0 + DAY) === null && M.spyReturnBetween(series, t0, t0) === 0
    ? ok('시계열 없으면 null, 같은 시각이면 0 — 0 과 모름을 구분')
    : bad('시계열 없음/동일시각 처리가 0 과 모름을 뭉갠다');
}

// ── [2] 실 DB 불변식: 한 배치가 보유구간이 제각각인데 벤치마크가 한 값이면 안 된다 ──
{
  const db = openDb();
  const rows = db.prepare(`
    SELECT o.evaluated_at ev, COUNT(*) n, COUNT(DISTINCT o.spy_return) kinds,
           ROUND(MAX(julianday(o.evaluated_at) - julianday(r.generated_at))
               - MIN(julianday(o.evaluated_at) - julianday(r.generated_at)), 1) span_d
    FROM recommendation_outcomes o
    JOIN recommendations r ON r.id = o.recommendation_id
    WHERE o.spy_return IS NOT NULL
    GROUP BY o.evaluated_at
    HAVING kinds = 1 AND n > 1 AND span_d > 7
    ORDER BY n DESC
  `).all();
  const contaminated = rows.reduce((s, r) => s + r.n, 0);
  const total = db.prepare(`SELECT COUNT(*) c FROM recommendation_outcomes WHERE spy_return IS NOT NULL`).get().c;

  contaminated === 0
    ? ok(`벤치마크가 전 행 건별로 맞춰져 있다 (${total}행)`)
    : bad(`일괄 스탬프 ${contaminated}/${total}행 (${(contaminated / total * 100).toFixed(1)}%) — 배치 ${rows.length}개, `
        + `최악 ${rows[0].n}행이 보유 ${rows[0].span_d}일 편차를 한 값으로 비교`);
}

// ── [3] 알파를 쓰는 쪽이 오염 행을 걸러 내는가 ────────────────────────────────
{
  const db = openDb();
  const has = db.prepare(`
    SELECT COUNT(*) c FROM recommendation_outcomes o
    JOIN recommendations r ON r.id = o.recommendation_id
    WHERE o.spy_return IS NOT NULL
      AND ABS(julianday(o.evaluated_at) - julianday(r.generated_at)) > 400
  `).get().c;
  has === 0
    ? ok('보유기간 400일 초과 행 없음 — 구간 자체가 비정상인 행은 없다')
    : bad(`보유 400일 초과 ${has}행 — 평가 큐가 오래된 추천을 계속 다시 재고 있다`);
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
