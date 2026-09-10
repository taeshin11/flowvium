/**
 * config-drift.test.mjs — 설정을 고쳤는데 프로세스가 옛것을 돌고 있는 상태를 잡는다.
 *
 * 왜 (2026-09-10): cron-runner 는 09-08 16:00 부터 떠 있었고, 나는 09-09·09-10 에 작업 셋을
 *   추가했다. 그 프로세스는 **시작할 때 한 번만** 설정을 읽는다 —
 *   shorts-health · shorts-reconcile · shorts-verify 가 **한 번도 돌지 않았다.**
 *   로그에는 아무 흔적도 없다. 등록하지 않은 것과 구별되지 않는다.
 *
 * 빌드 드리프트(src 를 고쳤는데 next build 안 함)와 같은 얼굴이다 —
 *   "고쳤다" 와 "돌고 있다" 사이의 틈은 아무 소리도 내지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStale, GRACE_MS } from './config-drift.mjs';

test('설정이 프로세스보다 새로우면 낡은 것이다', () => {
  const started = Date.now() - 3600_000;
  assert.equal(isStale({ startedAt: started, configMtime: started + 600_000 }), true);
});

test('프로세스가 더 새로우면 정상', () => {
  const cfg = Date.now() - 3600_000;
  assert.equal(isStale({ startedAt: cfg + 600_000, configMtime: cfg }), false);
});

test('재기동 직후 몇 초 차이는 봐준다 — 기동 중 파일을 만질 수 있다', () => {
  const t = Date.now();
  assert.equal(isStale({ startedAt: t, configMtime: t + GRACE_MS - 1000 }), false);
  assert.equal(isStale({ startedAt: t, configMtime: t + GRACE_MS + 1000 }), true);
});

test('알 수 없으면 판정하지 않는다 — 모르는 것을 결함이라 하지 않는다', () => {
  assert.equal(isStale({ startedAt: null, configMtime: Date.now() }), null);
  assert.equal(isStale({ startedAt: Date.now(), configMtime: null }), null);
  assert.equal(isStale(null), null);
});
