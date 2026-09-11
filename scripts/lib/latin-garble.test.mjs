/**
 * latin-garble.test.mjs — 깨진 라틴 조각과 멀쩡한 영어 단어를 가른다.
 *
 * 왜 (2026-09-12): verify-report 가 "Humped regime에서" 를 라틴garble 로 찍어 push 를 막았다.
 *   regime 은 변동성 곡선 형태를 가리키는 금융 용어다 — 깨진 게 아니라 정상 영문에 조사가 붙은 것이다.
 *   실제 garble 은 "레지gio" · "컨ti(gio" 처럼 **한글 한가운데서** 라틴이 튀어나온 것이다.
 *
 * 가르는 기준은 **라틴 앞에 무엇이 있느냐** 다:
 *   공백/문장 시작 뒤의 라틴 → 독립된 영어 단어(뒤에 조사가 붙을 수 있다) → 정상
 *   한글 바로 뒤의 라틴     → 단어 한가운데가 깨진 것 → garble
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latinGarbleFragments } from './latin-garble.mjs';

test('영어 단어 + 조사는 깨짐이 아니다', () => {
  assert.deepEqual(latinGarbleFragments('VIX 16.10의 Humped regime에서 중기 리스크 집중'), []);
  assert.deepEqual(latinGarbleFragments('ETF flows에서 자금이 빠졌다'), []);
});

test('한글 한가운데 라틴은 깨짐이다', () => {
  assert.ok(latinGarbleFragments('레지gio 로 전환').includes('gio'));
  assert.ok(latinGarbleFragments('컨ti 구조가 유지된다').includes('ti'));
  assert.ok(latinGarbleFragments('스que이즈가 이어졌다').includes('que'));
});

test('알려진 단위·약어는 제외한다', () => {
  assert.deepEqual(latinGarbleFragments('금리 10bp 상승'), []);
  assert.deepEqual(latinGarbleFragments('매출 yoy 증가'), []);
});

test('문장 시작의 영어도 정상', () => {
  assert.deepEqual(latinGarbleFragments('regime이 바뀌었다'), []);
});

test('빈 값에 죽지 않는다', () => {
  assert.deepEqual(latinGarbleFragments(''), []);
  assert.deepEqual(latinGarbleFragments(null), []);
});
