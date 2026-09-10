/**
 * flow-model-label.test.mjs — 드롭다운 표시에 붙는 **설정 토큰**과 모델 이름을 가른다.
 *
 * 왜 (2026-09-10): 이미지 생성이 `option_missing (표시="Nano Banana 2 crop_16_9 x2")` 로 죽었다.
 *   이미 올바른 모델이 선택돼 있었는데, 표시 문자열에 crop·장수 설정이 붙어 "이미 선택됨" 판정이
 *   빗나갔고, 그래서 드롭다운을 열어 정확히 "Nano Banana 2" 인 항목을 찾다가 실패했다.
 *
 *   접두사 비교로 풀면 안 된다 — "Nano Banana 2" 는 "Nano Banana 2 Lite" 의 접두사다.
 *   설정 토큰만 걷어내고 이름끼리 비교한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelName } from './flow.mjs';

test('설정 토큰을 걷어낸다', () => {
  assert.equal(modelName('Nano Banana 2 crop_16_9 x2'), 'Nano Banana 2');
  assert.equal(modelName('🍌 Nano Banana 2 crop_9_16 x4'), 'Nano Banana 2');
  assert.equal(modelName('Nano Banana Pro  crop_1_1  x1'), 'Nano Banana Pro');
});

test('Lite 는 여전히 다른 모델이다 — 접두사로 뭉개지 않는다', () => {
  assert.notEqual(modelName('Nano Banana 2 Lite crop_16_9 x2'), 'Nano Banana 2');
  assert.equal(modelName('Nano Banana 2 Lite crop_16_9 x2'), 'Nano Banana 2 Lite');
});

test('설정이 없으면 그대로', () => {
  assert.equal(modelName('Nano Banana 2'), 'Nano Banana 2');
  assert.equal(modelName('  Veo 3.1 - Lite [Lower Priority] '), 'Veo 3.1 - Lite [Lower Priority]');
});

test('빈 값에 안 죽는다', () => {
  assert.equal(modelName(null), '');
  assert.equal(modelName(undefined), '');
});
