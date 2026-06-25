#!/usr/bin/env node
// 검증체계 — 매수 규율(veto) 배선 회귀 가드 (2026-06-23 신설).
//
// 발생 경위: 구루/리스크 규율이 *가점(score)* 으로만 인코딩되고 *hard veto* 가 아니어서, 하락추세 칼받기
//   (POSCO -27%/현대로템 -28%)를 떨어지는 내내 매수 추천했음. 매도쪽만 veto, 매수쪽 무방비(비대칭).
//   audit 이 "규율이 veto 인가 score 인가"를 본 적이 없어 이 사각지대를 사전 포착 못 했음.
//
// 이 스크립트 = 그 best-practice(매수 veto)가 *유지되는지* 매 검증마다 확인. 누가 배선을 되돌리면 ❌.
//   "모니터가 본다"가 아니라 *코드 불변식*을 강제 — 회귀 시 verify-all 이 fail.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { hasHardBuyVeto } from '../src/lib/buy-sell-engine.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8'); } catch { return ''; } };

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, pass: !!cond, detail });

// ── [1] 공유 엔진에 hasHardBuyVeto 존재 + adjudicate 배선 ──
const engine = read('src/lib/buy-sell-engine.mjs');
ok('[1] hasHardBuyVeto export', /export function hasHardBuyVeto/.test(engine), 'buy-sell-engine.mjs');
ok('[1b] adjudicate buyVeto 배선', /buyVeto\b/.test(engine) && /buyVetoed/.test(engine), 'adjudicate 가 buyVeto 처리');
ok('[1c] 앵커 면제(분할매수 보존)', /oversold|nearLow|capitulation/.test(engine), '과매도/52주저점/극공포 앵커 면제 로직');

// ── [2] 보고서 매수 funnel + 최종 경합심사 + 보유 모두 veto 호출 ──
const gen = read('scripts/generate-report-local.mjs');
const genVetoCalls = (gen.match(/hasHardBuyVeto\(/g) || []).length;
ok('[2] 보고서 hasHardBuyVeto import', /import .*hasHardBuyVeto.* from .*buy-sell-engine/.test(gen), '');
ok('[2b] 보고서 veto 호출 ≥3 (funnel·보유·최종경합)', genVetoCalls >= 3, `호출 ${genVetoCalls}회`);

// ── [3] 챗(judge-engine) 도 동일 veto 적용 (엔진/보고서/챗 일관) ──
const chat = read('src/lib/judge-engine.ts');
ok('[3] 챗 hasHardBuyVeto import', /hasHardBuyVeto/.test(chat), 'judge-engine.ts');
ok('[3b] 챗 adjudicate 에 buyVeto 전달', /buyVeto:\s*buyVetoFor/.test(chat), '');

// ── [4] H1 closed loop: sanitize/narrative 조용교정도 학습루프 적재 ──
ok('[4] narrative-fix → hallucination_history (H1)',
  /narrativeDefectsForLearning/.test(gen) && /narrative_garble_sanitized/.test(gen),
  'sanitizer 가림이 학습루프로 환류');

// ── [4b] 시황 원칙 적용: regime risk-off 가 매수 veto 를 강화(top-down→bottom-up) + stance 캡 ──
ok('[4b] regime-aware 매수 veto (엔진)', /postureLevel|opts\.riskOff/.test(engine), 'hasHardBuyVeto graded posture 임계');
ok('[4c] regime → stance 캡', /regime-cap|regimeRiskOff/.test(gen), '시황 risk-off → stance bullish→neutral 게이트');

// ── [6] 동적 fixture 회귀테스트 (2026-06-25 ChatGPT 리뷰 — 호출수만 세는 false-green 종식) ──
//   실제 ctx 로 veto 동작을 검증. 회귀 시(임계/앵커/수익성 로직 깨지면) 여기서 ❌.
const FIXTURES = [
  ['POSCO형(하락추세·앵커없음)', { price: 60, sma50: 75, high52w: 100, rsi: 45 }, true],
  ['현대로템형(무너진 주도주)', { price: 67, sma50: 78, high52w: 100, rsi: 47 }, true],
  ['과매도 분할매수(RSI≤35 앵커)', { price: 55, sma50: 70, high52w: 100, rsi: 32 }, false],
  ['극공포+실제흑자(면제)', { price: 55, sma50: 70, high52w: 100, fgScore: 20, netIncomeTTM: 100 }, false],
  ['극공포지만 적자(★수익성 버그수정)', { price: 55, sma50: 70, high52w: 100, fgScore: 20, netIncomeTTM: -100, ocfTTM: -50 }, true],
  ['기아형 50MA 위(무차별차단 금지)', { price: 105, sma50: 100, high52w: 130 }, false],
];
let fxPass = 0;
for (const [nm, ctx, want] of FIXTURES) {
  const got = !!hasHardBuyVeto(ctx);
  if (got === want) fxPass++;
  else checks.push({ name: `[6] fixture: ${nm}`, pass: false, detail: `veto=${got} 기대=${want}` });
}
ok('[6] 동적 fixture 6/6 (POSCO·현대로템 차단 / 과매도·극공포흑자·기아 허용 / 극공포적자 차단)', fxPass === FIXTURES.length, `${fxPass}/${FIXTURES.length}`);
// graded posture: 약세종목(-16%)이 low 허용 → elevated/severe 차단(정상조정 과차단 방지)
const _weak = { price: 84, sma50: 90, high52w: 100 };
ok('[6b] graded posture (약세 -16%: low 허용→severe 차단)',
  !hasHardBuyVeto(_weak, { postureLevel: 'low' }) && !!hasHardBuyVeto(_weak, { postureLevel: 'severe' }),
  'elevated/severe 임계 차등');

// ── [5] (메타) 매수룰 veto-vs-score 분포 surface — 비대칭 가시화 ──
let buyVetoFalse = 0, buyTotal = 0;
try {
  const rules = JSON.parse(read('data/buy-rules-tuned.json'));
  const arr = Array.isArray(rules) ? rules : (rules.rules || rules.buyRules || []);
  buyTotal = arr.length;
  buyVetoFalse = arr.filter(r => r.veto === false || r.veto == null).length;
} catch { /* ignore */ }
// 정보성(룰 자체는 score 라도 hasHardBuyVeto 가 코드레벨 veto 를 제공하므로 fail 아님 — surface 만).
ok('[5] 매수룰 score-only 분포 surface', true, `buy-rules ${buyTotal}개 중 score-only ${buyVetoFalse}개 → hasHardBuyVeto 가 코드레벨 veto 보강`);

// ── 결과 ──
const failed = checks.filter(c => !c.pass);
console.log('\n[audit-buy-discipline] 매수 규율(veto) 배선 회귀 가드');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
if (failed.length) {
  console.error(`\n❌ ${failed.length}건 회귀 — 매수 veto 배선이 누락/되돌려짐. 칼받기 차단 무력화 위험.`);
  process.exit(1);
}
console.log(`\n✅ 매수 veto 4경로(엔진·보고서funnel·보유·챗) + H1 학습루프 전부 배선 유지.`);
