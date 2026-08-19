#!/usr/bin/env node
/**
 * stop-floor.test.mjs — 손절폭 하한이 '발동 판정과 같은 지표'로 계산되는지 검증.
 *
 * 배경(2026-08-20 실측):
 *   · 손절 발동은 장중 저가(low)로 판정한다 — evaluate-recommendations.mjs:78 `low <= stop*1.02`.
 *   · 그런데 손절폭 하한은 종가-종가 변동성(ccVol14)으로 계산한다
 *     — generate-report-local.mjs applyVolatilityStopFloor: floor = clamp(1.5*ccVol, 4, 12).
 *   · 두 지표가 다르다. 실측 ATR/ccVol 비율:
 *       000810.KS 2.0배 · ANET 1.7배 · 082920.KQ 1.5배 · 005380.KS 1.4배
 *     종가끼리는 장중 등락을 못 본다 → 하한이 장중 노이즈보다 좁게 잡힌다.
 *   · 결과: KR 20건 중 19건 손절(승률 20%). KR 평균 ATR 6.5% 인데 손절폭 -6.5%.
 *     082920.KQ 는 ATR 9.42% — 하루 평균 변동폭보다 좁은 손절선이었다.
 *   · Kovner(RAG 코퍼스): "스톱은 정상적 시장 노이즈로는 도달하기 어려운 위치에 설정하라."
 *
 * 지표를 트리거와 일치시킨다(장중 범위=True Range). 배수·클램프는 설정에서 온다.
 */
const M = await import('./stop-floor.mjs').catch(() => null);
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
if (!M || typeof M.stopFloorPct !== 'function') {
  bad('stopFloorPct 미구현 — 하한이 여전히 종가-종가 지표로 계산된다');
  console.log('\n결과: 실패 1건'); process.exit(1);
}

// ① 장중 범위 지표를 쓴다 — 같은 종목에서 cc 보다 넓은 하한이 나와야 한다
// 클램프에 포화되지 않는 구간(000810.KS: cc 2.34% vs ATR 4.61%)에서 비교한다
const cc = M.stopFloorPct({ ccVolPct: 2.34 });
const tr = M.stopFloorPct({ atrPct: 4.61 });
(tr > cc) ? ok(`000810.KS 재현 — cc 기준 ${cc.toFixed(1)}% < ATR 기준 ${tr.toFixed(1)}% (장중 범위 반영)`)
          : bad(`ATR 기준이 더 넓지 않다 (cc ${cc} vs atr ${tr})`);

// ①-b 손절을 넓혀도 노이즈를 못 벗어나는 종목은 '위험 틀 밖'이라고 말해야 한다 (조용한 클램프 금지)
const rf = M.riskFitAssessment({ atrPct: 9.42 });
(rf && rf.withinRiskFrame === false && rf.reason)
  ? ok(`082920.KQ — 위험 틀 밖 판정: ${rf.reason.slice(0, 58)}`)
  : bad('필요 손절폭이 상한을 넘는데 조용히 클램프한다');
const rf2 = M.riskFitAssessment({ atrPct: 2.65 });
(rf2 && rf2.withinRiskFrame === true) ? ok('AAPL(ATR 2.65%) — 위험 틀 안') : bad('저변동성인데 틀 밖 판정');

// ② 실제 실패 사례가 통과하지 못해야 한다: 손절 -7.0% 는 ATR 9.42% 종목에서 너무 촘촘
M.shouldWiden({ stopDistPct: 7.0, atrPct: 9.42 })
  ? ok('082920.KQ 손절 -7.0% → 확장 대상으로 판정 (종전에는 통과했음)')
  : bad('여전히 -7.0% 를 허용한다');

// ③ 저변동성 종목은 불필요하게 넓히지 않는다
!M.shouldWiden({ stopDistPct: 5.3, atrPct: 1.54 })
  ? ok('KO(ATR 1.54%) 손절 -5.3% → 확장 불필요')
  : bad('저변동성인데 확장한다');

// ④ 지표 결측 시 조용히 기본값을 만들지 않는다
M.stopFloorPct({}) === null ? ok('변동성 지표 없음 → null') : bad('결측인데 값 반환');
M.shouldWiden({ stopDistPct: 5, atrPct: null }) === null ? ok('ATR 없음 → null (판단 보류)') : bad('ATR 없는데 단정');

// ⑤ 설정에서 온다 (코드 리터럴 아님)
const c = M.loadStopConfig();
(typeof c.atrMultiple === 'number' && typeof c.minPct === 'number' && typeof c.maxPct === 'number')
  ? ok(`설정 로드 — ATR×${c.atrMultiple}, 클램프 [${c.minPct}, ${c.maxPct}]%`)
  : bad('설정 구조 없음');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
