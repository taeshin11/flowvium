/**
 * narrative-edit-kind.test.mjs — 교정을 '배울 것' 과 '그냥 다듬은 것' 으로 가른다.
 *
 * 왜 (2026-09-10): 모니터가 "교정기 상시발동 — narrative_garble_sanitized 23/32보고서" 를 띄웠다.
 *   실물을 보니 대부분 오류가 아니었다.
 *     컨탱고 → 콘탱고          표기 통일. 둘 다 맞는 음역이고 우리가 하나를 고른 것뿐이다
 *     KOSPI 6,900 → 6,918     모델이 반올림했고 실측으로 맞춘 것(2026-08-23 대조 로직이 정상 동작)
 *   이걸 "이 garble 반복 금지" 로 적어 **다음 프롬프트에 주입**하고 있었다.
 *   모델에게 고칠 것 없는 걸 가르치고, 프롬프트 자리를 잡아먹고, 진짜 결함을 그 잡음에 묻는다.
 *
 * 반대로 이것들은 계속 배워야 한다 — 모델이 실제로 틀린 것이다.
 *     짧은 매수 스퀴즈 → 공매도 스퀴즈   오역
 *     2.3% 급등 → 2.3% 상승             과장
 *     0.5% 하락했으나 → 하락했으나        근거 없는 수치 제거
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNarrativeEdit } from './narrative-edit-kind.mjs';

test('표기 통일은 배울 것이 아니다', () => {
  assert.equal(classifyNarrativeEdit('VIX 16.2는 컨탱고 상태로', 'VIX 16.2는 콘탱고 상태로'), 'style');
  assert.equal(classifyNarrativeEdit('4.7% 상승하며 컨탱고 구조', '4.7% 상승하며 콘탱고 구조'), 'style');
});

test('숫자만 실측으로 바뀐 것도 배울 것이 아니다', () => {
  assert.equal(classifyNarrativeEdit('KOSPI 6,900 지지 여부 및 외국인', 'KOSPI 6,918 지지 여부 및 외국인'), 'reconcile');
  assert.equal(classifyNarrativeEdit('S&P500 7,674로', 'S&P500 7,676로'), 'reconcile');
});

test('오역은 배운다', () => {
  assert.equal(classifyNarrativeEdit('짧은 매수 스퀴즈가 이어졌다', '공매도 스퀴즈가 이어졌다'), 'defect');
});

test('과장 완화는 배운다 — 모델이 틀린 표현을 쓴 것이다', () => {
  assert.equal(classifyNarrativeEdit('KOSDAQ의 2.3% 급등은', 'KOSDAQ의 2.3% 상승은'), 'defect');
});

test('근거 없는 수치 제거는 배운다', () => {
  assert.equal(classifyNarrativeEdit('7,636으로 0.5% 하락했으나', '7,636으로 하락했으나'), 'defect');
});

test('변화가 없으면 none', () => {
  assert.equal(classifyNarrativeEdit('같은 문장', '같은 문장'), 'none');
  assert.equal(classifyNarrativeEdit('', ''), 'none');
});
