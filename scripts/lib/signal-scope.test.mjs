#!/usr/bin/env node
/**
 * signal-scope.test.mjs — 시장 단위 신호와 종목 단위 신호의 분리.
 *
 * 배경(2026-08-20 실측, 사용자 "한국 종목이 하나도 안떴는데 의도된거니?"):
 *   정오 보고서 KR 편입 0. 추적하니 KR 후보 9개 전부에 micro_region_bearish(7점)가 붙었고
 *   VETO_SCORE 가 정확히 7(=HIGH=7-macroTighten)이라 지역 스탠스 단독으로 거부가 성립했다.
 *   결정적 증거: 140860.KQ 는 데드크로스·200MA이탈·과매수가 전혀 없고
 *   micro_region_bearish(7) 하나만으로 탈락했다. 오전 실행에선 이 신호가 0건이라 KR 2석이었다.
 *
 *   문제는 KR 만이 아니다. 규칙표상 시장 단위 규칙이 단독으로 임계값을 넘는다:
 *     macro_high_risk 8            → 전 우주 매수 금지
 *     macro_vix_spike 6 + macro_fg_extreme_fear 5 = 11 → 전 우주
 *     micro_region_bearish 7 + micro_kr_flow_exodus 4 = 11 → 해당 지역 전부
 *   공석을 메우라고 만든 재충원 장치도 같은 페널티를 받아 구조적으로 실패한다.
 *
 * 선행 사례(레짐 필터 문헌)의 일관된 원칙: 레짐 신호는 '무엇을 고를지'가 아니라
 *   '얼마나 실을지'를 정한다 — 종목 선택은 종목 단위 신호로, 총노출은 레짐으로.
 *   (financial-hacker.com 레짐 필터: 점수대별 노출 절반/0 · arXiv 2511.12490 drift regime:
 *    레짐이 gross exposure 를 줄이고 종목 조건이 선택을 정함 · MIT Sloan 레짐 모호성은 포트폴리오 층)
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let S;
try { S = await import('./signal-scope.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

// [1] 범위는 규칙 id 목록이 아니라 condition.type 에서 유도돼야 한다 — 새 규칙이 자동 분류되도록
S.scopeOfCondition('regionStance') === 'market' ? ok('regionStance → market') : bad('regionStance 분류 실패');
S.scopeOfCondition('macroRisk')    === 'market' ? ok('macroRisk → market')    : bad('macroRisk 분류 실패');
S.scopeOfCondition('vixSpike')     === 'market' ? ok('vixSpike → market')     : bad('vixSpike 분류 실패');
S.scopeOfCondition('krFlowExodus') === 'market' ? ok('krFlowExodus → market') : bad('krFlowExodus 분류 실패');
S.scopeOfCondition('sectorStance') === 'market' ? ok('sectorStance → market (섹터 전체 공통)') : bad('sectorStance 분류 실패');
S.scopeOfCondition('deadCross')    === 'security' ? ok('deadCross → security') : bad('deadCross 분류 실패');
S.scopeOfCondition('opMarginDecline') === 'security' ? ok('opMarginDecline → security') : bad('opMarginDecline 분류 실패');
S.scopeOfCondition('insiderSell') === 'security' ? ok('insiderSell → security') : bad('insiderSell 분류 실패');

// [2] 규칙표 전수가 분류돼야 한다 — 미분류가 남으면 새 규칙이 조용히 잘못 편입된다
const un = S.unclassifiedConditions();
un.length === 0 ? ok('규칙표 전 condition.type 분류 완료') : bad(`미분류 ${un.length}건: ${un.join(', ')}`);

// [3] 핵심 — 시장 신호 단독으로는 거부가 성립하면 안 된다
const VETO = 7;
const krNoIssue = [{ id: 'micro_region_bearish', condition: 'regionStance', score: 7 }];
const p1 = S.partition(krNoIssue);
p1.securityScore === 0 ? ok(`140860.KQ 재현: 종목 점수 0 (시장 ${p1.marketScore})`) : bad(`종목 점수 ${p1.securityScore}`);
!S.shouldVeto(p1, VETO) ? ok('시장 신호 7점 단독 → 거부 안 됨 (수정 전에는 탈락)') : bad('여전히 단독 거부됨');

// 전 우주 금지 사례도 막혀야 한다
const macroOnly = [{ id: 'macro_high_risk', condition: 'macroRisk', score: 8 },
                   { id: 'macro_vix_spike', condition: 'vixSpike', score: 6 }];
!S.shouldVeto(S.partition(macroOnly), VETO) ? ok('거시 14점 단독 → 전 우주 금지 방지') : bad('거시만으로 전 우주 금지됨');

// [4] 종목 신호는 종전대로 거부해야 한다 — 위험 통제를 약화시키면 안 된다
const bad1 = [{ id: 'tech_dead_cross', condition: 'deadCross', score: 9 }];
S.shouldVeto(S.partition(bad1), VETO) ? ok('데드크로스 9점 → 정상 거부') : bad('종목 신호가 거부를 못 함 — 위험통제 약화');
const mix = [{ id: 'tech_dead_cross', condition: 'deadCross', score: 9 },
             { id: 'micro_region_bearish', condition: 'regionStance', score: 7 }];
const pm = S.partition(mix);
pm.securityScore === 9 && pm.marketScore === 7 ? ok('혼합: 종목 9 / 시장 7 분리') : bad(`분리 실패 ${JSON.stringify(pm)}`);
S.shouldVeto(pm, VETO) ? ok('326030.KS 재현: 종목 신호로 정상 거부') : bad('혼합인데 거부 안 됨');

// [5] 레짐은 노출도로 — 문헌의 단계적 축소
S.exposureFactor(0) === 1 ? ok('레짐 0점 → 노출 100%') : bad(`레짐 0에서 ${S.exposureFactor(0)}`);
const f7 = S.exposureFactor(7), f14 = S.exposureFactor(14);
(f7 < 1 && f7 > 0) ? ok(`레짐 7점 → 노출 ${Math.round(f7*100)}% (축소)`) : bad(`레짐 7에서 ${f7}`);
(f14 < f7) ? ok(`레짐 14점 → 노출 ${Math.round(f14*100)}% (더 축소, 단조)`) : bad('단조 감소 아님');
(S.exposureFactor(100) >= 0) ? ok('극단값에서도 음수 아님') : bad('음수 노출');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
