/**
 * snapshot-timeout.test.mjs — LLM 을 부르는 엔드포인트는 12초로 못 잡는다.
 *
 * 왜 (2026-09-10): /api/flow-analysis 가 스냅샷 적재에서 **50번 연속 실패**했다.
 *   원인은 이 엔드포인트가 callAI 로 생성을 돌린다는 것 — 실측 150초다.
 *   스냅샷 fetch 타임아웃은 12초라 캐시가 식어 있으면 매번 진다.
 *   "가끔 실패" 가 아니라 구조적으로 절대 성공할 수 없는 조합이었다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeoutFor, SLOW_ENDPOINTS, DEFAULT_TIMEOUT_MS } from './snapshot-endpoints.mjs';

test('LLM 엔드포인트는 넉넉히 기다린다', () => {
  assert.ok(timeoutFor('/api/flow-analysis') >= 150000, '150초 실측보다 길어야 한다');
});

test('나머지는 기본값 그대로 — 느린 하나 때문에 전체가 늘어지지 않는다', () => {
  assert.equal(timeoutFor('/api/capital-flows'), DEFAULT_TIMEOUT_MS);
  assert.equal(timeoutFor('/api/fear-greed'), DEFAULT_TIMEOUT_MS);
});

test('느린 목록은 근거와 함께 적는다 — 말없이 늘리지 않는다', () => {
  for (const [ep, v] of Object.entries(SLOW_ENDPOINTS)) {
    assert.ok(v.ms > DEFAULT_TIMEOUT_MS, `${ep}: 기본보다 길어야 목록에 있을 이유가 있다`);
    assert.ok(String(v.why ?? '').length >= 10, `${ep}: 왜 느린지 적어야 한다`);
  }
});
