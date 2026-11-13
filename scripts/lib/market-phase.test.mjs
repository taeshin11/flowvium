// market-phase.test.mjs — 보고서의 '장 상황'은 회차 이름이 아니라 실제 시각으로 정한다. node --test scripts/lib/market-phase.test.mjs
// 왜(11/11): 회차 시각이 앞당겨졌는데(오후 15:50→14:30 등) 장 상황 문구는 회차별 상수로 남아,
//   14:35 KST 보고서가 장중 숫자를 "KR 마감 직후 (당일 종가 확정)"이라고 썼다(agy 검수, 실측 dataAsOf 05:35Z).
//   미국 서머타임이 끝나 05:30 KST(=15:30 ET) 회차도 장중인데 "마감 직후"였다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketPhases } from '../../src/lib/market-phase.mjs';

const at = (iso) => marketPhases(new Date(iso));

test('11/11 오후 회차 14:35 KST — 한국은 장중, 미국은 전일 종가', () => {
  const p = at('2026-11-11T05:35:48Z');
  assert.equal(p.kr.code, 'open');
  assert.equal(p.us.code, 'pre');
});

test('아침 회차 05:30 KST — 겨울(EST)엔 미국 장중, 여름(EDT)엔 마감', () => {
  assert.equal(at('2026-11-10T20:30:00Z').us.code, 'open');   // 11/10 15:30 ET
  assert.equal(at('2026-11-10T20:30:00Z').kr.code, 'pre');
  assert.equal(at('2026-07-15T20:30:00Z').us.code, 'closed'); // 7/15 16:30 EDT
});

test('저녁 20:00·자정 22:30 KST — 미국은 프리마켓, 한국은 마감', () => {
  assert.equal(at('2026-11-11T11:00:00Z').us.code, 'premarket'); // 06:00 ET
  assert.equal(at('2026-11-11T11:00:00Z').kr.code, 'closed');
  assert.equal(at('2026-11-11T13:30:00Z').us.code, 'premarket'); // 08:30 ET
  assert.equal(at('2026-11-11T15:00:00Z').us.code, 'open');      // 10:00 ET
});

test('경계: 한국 15:30 은 마감, 미국 09:30 ET 는 장중', () => {
  assert.equal(at('2026-11-11T06:29:00Z').kr.code, 'open');
  assert.equal(at('2026-11-11T06:30:00Z').kr.code, 'closed');
  assert.equal(at('2026-11-11T14:30:00Z').us.code, 'open');
});

test('주말 — 둘 다 휴장. 토요일 05:30 KST 는 미국 금요일 장중', () => {
  const sat = at('2026-11-14T05:00:00Z');
  assert.equal(sat.kr.code, 'weekend');
  assert.equal(sat.us.code, 'weekend');
  assert.equal(at('2026-11-13T20:30:00Z').us.code, 'open');
});

test('문구에 확정 종가 여부가 드러난다', () => {
  const p = at('2026-11-11T05:35:48Z');
  assert.match(p.kr.label, /장중/);
  assert.doesNotMatch(p.kr.label, /종가 확정/);
  assert.match(at('2026-11-11T07:00:00Z').kr.label, /종가 확정/);
});

// 11/11 눈검증: 보고서 지난 회차 탭이 14:35 회차를 "오후 (아시아장 마감 후)·16:00" 으로 보였다 — 이름표도 만든 시각에서.
import { sessionTabLabel } from '../../src/lib/market-phase.mjs';
test('지난 회차 이름표 — 회차 이름 + 만든 시각의 주력 시장 상황', () => {
  assert.equal(sessionTabLabel('afternoon', '2026-11-11T05:35:48Z'), '오후 (한국장 장중)');
  assert.equal(sessionTabLabel('afternoon', '2026-11-10T09:05:50Z'), '오후 (한국장 마감)');
  assert.equal(sessionTabLabel('morning', '2026-11-10T20:36:00Z'), '오전 (미국장 장중)');
  assert.equal(sessionTabLabel('midnight', '2026-11-10T13:39:36Z'), '밤 (미국장 프리마켓)');
  assert.equal(sessionTabLabel('noon', '2026-11-11T01:37:16Z'), '점심 (한국장 장중)');
  assert.equal(sessionTabLabel('weird', 'bad'), 'weird');
});

// 11/12 실측: 프롬프트에 "장중 (숫자는 확정 종가 아님)" 을 값으로 넣자 모델이 그 괄호를 문장에 그대로 옮겼다
//   ("한국 시장은 장중 (숫자는 확정 종가 아님) KOSPI가…"). 값은 짧은 말, 규칙은 따로.
import { phaseWord, phaseNote } from '../../src/lib/market-phase.mjs';
test('프롬프트 값은 괄호 없는 짧은 말', () => {
  const p = at('2026-11-12T05:35:45Z');
  assert.equal(phaseWord(p.kr), '장중');
  assert.equal(phaseWord(p.us), '개장 전');
  assert.doesNotMatch(phaseWord(p.kr), /[()]/);
});
test('규칙 문장: 장중이면 마감·종가라 쓰지 말라고, 괄호를 옮기지 말라고', () => {
  const n = phaseNote(at('2026-11-12T05:35:45Z'));
  assert.match(n, /한국 숫자는 장중 값/);
  assert.match(n, /'마감'·'종가'/);
  assert.match(n, /미국 숫자는 전일 종가/);
  const closed = phaseNote(at('2026-11-12T11:09:18Z'));
  assert.match(closed, /한국 숫자는 당일 확정 종가/);
  assert.doesNotMatch(closed, /쓰지 말 것.*한국|한국.*쓰지 말 것/);
});
