#!/usr/bin/env node
/**
 * judge-outcome.test.mjs — 매수 추천 성적 판정이 '그 가격에 실제로 체결될 수 있었는가'를 따르는가. 2026-10-25 신설.
 *
 * 사장님(10/25) "공포 높을 때 매수 권하는 게 실력 똥망 — 이런 전향적 연구 안 하냐". 성적을 다시 재다가 판정 자체가 틀린 걸 찾았다.
 * 실측(매수 진입 2,048건, recommendation_outcomes):
 *   ① 손절은 `저가 <= 손절가×1.02` 로 판정하고 손익은 손절가로 적었다 — 손절가에 닿지도 않았는데 손절 손실을 기록.
 *      한국 손절 313건 중 140건, 미국 160건 중 73건이 그 기간 저가가 손절가 위였다(예: 제주반도체 손절 59,500 · 저가 60,200 → −5.56%).
 *   ② 목표는 `고가 >= 목표가×0.98` 로 판정하고 손익은 목표가로 적었다 — 닿지 않은 목표 수익을 기록.
 *      미국 목표 도달 81건 중 62건, 한국 37건 중 16건이 그 기간 고가가 목표가 아래였다.
 *   ③ 첫 일봉이 추천 **전** 가격을 포함했다 — 14:38 에 낸 추천을 그날 오전 저가로 진입·손절 판정.
 *   ④ 진입은 `저가 <= 진입 상단` 이면 됐다고 보면서 손익은 진입 **하단** 가격으로 쟀다 — 살 수 없던 싼 값.
 *   ⑤ 결측일을 고가·저가 배열에서 따로 걸러 날짜가 어긋날 수 있었다.
 *   한국은 나쁘게(①), 미국은 좋게(②) 보였다 — 방향이 시장마다 달라 '한국 실력 바닥·미국 지수 초과'라는 결론 자체가 흔들린다.
 *   (9/03 repair-outcome-labels 가 ①을 알아채고도 '앞을 보는 탐지 기준'이라며 남겼다 — 성적 판정은 일어난 일만 센다.)
 * 규칙: 추천 시각 뒤에 열린 장만 · 손절은 저가가 손절가 이하일 때(시가가 이미 아래면 시가에 체결) ·
 *   목표는 고가가 목표가 이상일 때(시가가 이미 위면 시가) · 진입가는 min(시가, 진입 상단) · 같은 날 둘 다면 손절(보수적).
 */
const M = await import('./judge-outcome.mjs').catch(() => null);
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
if (!M || typeof M.judgeOutcome !== 'function') { bad('[0] lib/judge-outcome.mjs judgeOutcome 이 없다'); console.log('\n❌ 1건 실패'); process.exit(1); }
const { judgeOutcome, barsFromChart } = M;

const GEN = '2026-10-23T05:38:00Z';                  // 14:38 KST
const day = (d) => Date.parse(`2026-10-${d}T00:00:00Z`) / 1000;   // 한국 장 시작(09:00 KST)
const bar = (d, o, h, l, c) => ({ t: day(d), o, h, l, c });
const rec = { generated_at: GEN, entry_low: 63000, entry_high: 65600, stop_loss: 59500, target: 74000, price_at_gen: 65600 };

{ // ① 제주반도체 실측 모양: 저가 60,200 은 손절 59,500 의 1.02배 안이지만 손절가에 닿지 않았다
  const r = judgeOutcome(rec, [bar(24, 65000, 66200, 60200, 61000), bar(27, 61000, 62000, 60500, 61500)]);
  r.outcome !== 'stop_loss' ? ok(`[1] 손절가에 안 닿으면 손절이 아니다 (${r.outcome})`) : bad(`[1] ${JSON.stringify(r)}`);
}
{ // ② 목표 74,000 의 0.98배(72,520)는 넘었지만 목표가에는 못 닿음
  const r = judgeOutcome(rec, [bar(24, 64000, 65000, 63500, 64500), bar(27, 70000, 73000, 69000, 72000)]);
  r.outcome !== 'hit_target' ? ok(`[2] 목표가에 안 닿으면 목표 도달이 아니다 (${r.outcome})`) : bad(`[2] ${JSON.stringify(r)}`);
}
{ // ③ 추천(14:38) 전 오전에 연 23일 봉은 보지 않는다 — 그날 저가 58,000 이 손절을 만들면 안 된다
  const r = judgeOutcome(rec, [bar(23, 66000, 66500, 58000, 65600), bar(24, 66000, 67000, 65800, 66500)]);
  r.outcome === 'not_entered' ? ok('[3] 추천 시각 전에 연 장은 판정에 안 쓴다') : bad(`[3] ${JSON.stringify(r)}`);
}
{ // 진짜 손절: 저가가 손절가 이하 → 손절가 체결
  const r = judgeOutcome(rec, [bar(24, 65000, 65500, 64000, 64500), bar(27, 64000, 64200, 59000, 59800)]);
  (r.outcome === 'stop_loss' && r.exitPrice === 59500 && r.entryPrice === 65000) ? ok('[4] 저가가 손절가를 깨면 손절 · 손절가에 청산 · 진입은 그날 시가(진입 상단 아래)') : bad(`[4] ${JSON.stringify(r)}`);
}
{ // 갭 하락: 시가가 이미 손절가 아래면 시가에 체결된다(손절가보다 나쁘다)
  const r = judgeOutcome(rec, [bar(24, 64000, 64500, 63800, 64200), bar(27, 57000, 58000, 56500, 57500)]);
  (r.outcome === 'stop_loss' && r.exitPrice === 57000) ? ok('[5] 갭 하락은 시가에 손절(손절가로 꾸미지 않는다)') : bad(`[5] ${JSON.stringify(r)}`);
}
{ // 진입가: 시가가 진입 상단 위에서 열고 내려와 상단에 닿음 → 상단 가격(하단 63,000 이 아니다)
  const r = judgeOutcome(rec, [bar(24, 67000, 67500, 65000, 66000), bar(27, 66000, 74500, 65800, 74000)]);
  (r.entryPrice === 65600 && r.outcome === 'hit_target' && r.exitPrice === 74000) ? ok('[6] 진입가 = min(시가, 진입 상단) · 목표가에 닿으면 목표가 청산') : bad(`[6] ${JSON.stringify(r)}`);
}
{ // 같은 날 손절·목표 둘 다 → 손절(보수적)
  const r = judgeOutcome(rec, [bar(24, 64000, 75000, 59000, 70000)]);
  r.outcome === 'stop_loss' ? ok('[7] 같은 날 둘 다 닿으면 손절로 본다') : bad(`[7] ${JSON.stringify(r)}`);
}
{ // 끝까지 아무것도 안 닿음 → 보유 중, 마지막 종가
  const r = judgeOutcome(rec, [bar(24, 65000, 66000, 64000, 65500), bar(27, 65500, 67000, 65000, 66800)]);
  (r.outcome === 'still_holding' && r.lastClose === 66800 && r.entryPrice === 65000) ? ok('[8] 아무것도 안 닿으면 보유 중 · 마지막 종가') : bad(`[8] ${JSON.stringify(r)}`);
}
{ // ⑤ 결측일: 날짜별로 같이 버린다 — 고가만 빠진 날이 다음 날 저가와 짝지어지면 안 된다
  const chart = { timestamp: [day(24), day(27), day(28)], indicators: { quote: [{ open: [65000, 64000, 64000], high: [66000, null, 64500], low: [64000, 59000, 63900], close: [65500, 60000, 64200] }] } };
  const b = barsFromChart(chart);
  (b.length === 2 && b[1].t === day(28) && b[1].l === 63900) ? ok('[9] 결측 봉은 날짜째로 뺀다(배열이 어긋나지 않는다)') : bad(`[9] ${JSON.stringify(b)}`);
}
{ // 판정할 봉이 없으면 unknown(지어내지 않는다)
  const r = judgeOutcome(rec, []);
  r.outcome === 'unknown' ? ok('[10] 봉이 없으면 unknown') : bad(`[10] ${JSON.stringify(r)}`);
}
{ // evaluate-recommendations 가 이 판정과 체결가를 쓴다(1.02/0.98 여유 판정이 남아 있지 않다)
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../evaluate-recommendations.mjs', import.meta.url), 'utf8');
  (/from '\.\/lib\/judge-outcome\.mjs'/.test(src) && !/stop_loss \* 1\.02|target \* 0\.98/.test(src) && /judge\.entryPrice/.test(src) && /judge\.exitPrice/.test(src))
    ? ok('[11] evaluate-recommendations 가 같은 판정·체결가를 쓴다') : bad('[11] evaluate-recommendations 에 옛 판정(×1.02/×0.98)이 남았거나 체결가를 안 쓴다');
}
{ // [12] 2026-10-26: 매도 추천이 장이 한 번도 열리기 전에 매수 추천을 닫았다(HOOD 10/23 자정 → 10/24 매도 등 5건).
  //   추천 뒤 봉이 0개 → judge 'unknown' 인데, 재검증 경로가 이를 '체결됨' 으로 보고 'sold' 손익을 low_seen 없이 적었다(outcome-integrity 실패).
  //   추천과 매도 사이에 장이 없었으면 살 수 없었다 → 'not_entered'. 봉을 아예 못 받은 경우(ohlc 없음)는 부르는 쪽이 건너뛴다.
  const { verifiedOutcome } = await import('./judge-outcome.mjs');
  (typeof verifiedOutcome === 'function'
    && verifiedOutcome({ outcome: 'unknown' }, 'sold') === 'not_entered'
    && verifiedOutcome({ outcome: 'not_entered' }, 'sold') === 'not_entered'
    && verifiedOutcome({ outcome: 'stop_loss' }, 'sold') === 'stop_loss'
    && verifiedOutcome({ outcome: 'still_holding' }, 'sold') === 'sold'
    && verifiedOutcome({ outcome: 'hit_target' }, 'hit_target') === 'hit_target'
    && verifiedOutcome({ outcome: 'still_holding' }, 'still_holding') === 'still_holding')
    ? ok('[12] 재검증: 추천 뒤 장이 없으면 not_entered · 손절은 손절 · 나머지는 매도 마감 유지')
    : bad('[12] verifiedOutcome 이 없거나 unknown 을 체결로 본다');
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../evaluate-recommendations.mjs', import.meta.url), 'utf8');
  /verifiedOutcome\(judge, rec\.o_outcome\)/.test(src) ? ok('[12b] evaluate-recommendations --verify 가 verifiedOutcome 을 쓴다') : bad('[12b] 재검증 경로가 verifiedOutcome 을 안 쓴다');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
