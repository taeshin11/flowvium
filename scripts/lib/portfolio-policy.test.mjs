#!/usr/bin/env node
/**
 * portfolio-policy.test.mjs — 포트폴리오 구성 정책이 설정에서 오고, 수급에 반응하는지 검증.
 *
 * 배경(2026-08-20 실측, 38일 out-of-sample n=85):
 *   · KR 20건 중 19건 손절, 승률 20%, SPY 대비 -6.37%p. 사실상 5개 종목의 반복 추천이었다.
 *   · 같은 기간 거시: KOSPI 6/3 이후 33% 폭락, 외국인 6개월 연속 순매도(상반기 116.36조),
 *     원화 17년 최저. 시스템은 이 순매도를 로그에 찍으면서도 KR 롱을 계속 추천했다.
 *   · 코드 원인 둘:
 *       (1) sliceWithKrQuota(stage3Cands, topN, Math.round(topN*0.3)) — KR 30% '하한'을 하드코딩.
 *           후보 품질과 무관하게 30%를 채운다. 폭락장에서도 채웠다.
 *       (2) krFlowIntensity(buy-sell-engine.mjs:227)는 순매수 연속일에 '가점'만 준다.
 *           대칭되는 순매도 veto 가 없다. hasHardBuyVeto 는 수급을 아예 안 본다.
 *   · Kovner(RAG): "스톱은 정상적 시장 노이즈로 도달하기 어려운 위치에" — KR 손절폭 -6.5%는
 *     노이즈 안이었다(저점 -3.3~-7.4%에 19/20 손절).
 */
const P = await import('./portfolio-policy.mjs').catch(() => null);
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
if (!P) { bad('portfolio-policy.mjs 미구현 — 정책이 코드에 하드코딩돼 있다'); console.log('\n결과: 실패 1건'); process.exit(1); }

// ① 정책값이 설정에서 온다 (코드 리터럴 아님)
const c = P.loadPolicy();
(c && typeof c.maxPositions === 'number' && typeof c.marketQuota === 'object')
  ? ok(`정책 로드 — maxPositions=${c.maxPositions}, quota=${JSON.stringify(c.marketQuota)}`)
  : bad('정책 구조 없음');

// ② KR 할당이 '하한'이 아니라 '상한'이어야 한다 — 후보가 나쁘면 안 채운다
let q = P.resolveMarketSlots({ total: 10, market: 'kr', flow: { foreignNetStreak: 0, netPct: 0 } });
(q.cap <= Math.ceil(10 * c.marketQuota.kr.cap) && q.floor === 0)
  ? ok(`KR 슬롯 = 상한 ${q.cap} / 하한 ${q.floor} (강제 배분 없음)`)
  : bad(`KR 슬롯이 하한을 강제한다: cap=${q.cap} floor=${q.floor}`);

// ③ 외국인 순매도가 지속되면 KR 신규 롱이 차단돼야 한다 (대칭 veto)
let v = P.krFlowVeto({ foreignNetStreak: -6, netPct: -2.5 });
v ? ok(`순매도 지속 → veto: ${v.slice(0, 60)}`) : bad('6일 연속 순매도인데 veto 없음');
v = P.krFlowVeto({ foreignNetStreak: 4, netPct: 1.8 });
!v ? ok('순매수 지속 → veto 없음 (대칭)') : bad(`순매수인데 veto 발동: ${v}`);
v = P.krFlowVeto({ foreignNetStreak: null, netPct: null });
v === null ? ok('수급 데이터 없음 → null (없는 데이터로 단정하지 않음)') : bad(`데이터 결측인데 판단함: ${v}`);

// ④ 손절폭이 변동성에 비례해야 한다 (고정 % 금지)
const lowVol  = P.stopDistancePct({ atrPct: 1.2 });
const highVol = P.stopDistancePct({ atrPct: 3.5 });
(highVol > lowVol) ? ok(`변동성 비례 손절: ATR 1.2%→${lowVol.toFixed(1)}% · 3.5%→${highVol.toFixed(1)}%`)
                   : bad(`손절폭이 변동성에 반응 안 함 (${lowVol} vs ${highVol})`);
P.stopDistancePct({ atrPct: null }) === null
  ? ok('ATR 결측 → null (고정값으로 때우지 않음)') : bad('ATR 없는데 임의 값 반환');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
