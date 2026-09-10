/**
 * channel-budget.test.mjs — 하루 총량 가드.
 *
 * 왜 (2026-09-09 실측): 09-06 에 21편을 올리고 09-07 아침에 11편을 한꺼번에 지웠다.
 *   다음 날부터 발행 8시간 시점 조회수 중앙값이 1,275 → 385 → 210 으로 주저앉았고
 *   그날 발행분이 **한 편도 예외 없이** 떨어졌다(채널 단위 현상).
 *   각 스크립트에는 호출 1회짜리 안전장치가 있었지만 **하루 총량을 세는 곳이 없어서**
 *   슬롯·백필 두 진입점이 각자 정상 동작하면서 합계 21편을 만들었다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kstDay, countSince, budgetCheck, LIMITS } from './channel-budget.mjs';

const at = (kstIso) => new Date(new Date(`${kstIso}+09:00`).toISOString()).toISOString();

test('kstDay: UTC 저장값을 KST 하루로 자른다', () => {
  assert.equal(kstDay(at('2026-09-06T23:30')), '2026-09-06');
  assert.equal(kstDay(at('2026-09-07T00:10')), '2026-09-07');
});

test('countSince: 오늘(KST) 것만 센다', () => {
  const rows = [at('2026-09-06T23:30'), at('2026-09-07T00:10'), at('2026-09-07T21:00')];
  assert.equal(countSince(rows, '2026-09-07'), 2);
  assert.equal(countSince(rows, '2026-09-06'), 1);
});

test('발행: 상한 안이면 통과, 넘으면 막는다', () => {
  assert.equal(budgetCheck('publish', LIMITS.publish - 1).ok, true);
  assert.equal(budgetCheck('publish', LIMITS.publish).ok, false);
});

test('09-06 의 21편은 막혔어야 한다', () => {
  const r = budgetCheck('publish', 20);
  assert.equal(r.ok, false);
  assert.match(r.reason, /하루/);
});

test('09-07 의 11편 일괄 삭제는 막혔어야 한다', () => {
  assert.equal(budgetCheck('purge', 0).allowance < 11, true);
  assert.equal(budgetCheck('purge', LIMITS.purge).ok, false);
});

test('내리기도 하루 총량이 있다', () => {
  assert.equal(budgetCheck('retract', LIMITS.retract).ok, false);
});

test('allowance: 남은 편수를 알려준다 (일괄 작업이 여기서 잘린다)', () => {
  assert.equal(budgetCheck('purge', 1).allowance, LIMITS.purge - 1);
  assert.equal(budgetCheck('purge', 99).allowance, 0);
});

test('조사가 맞는다 — "발행는" 처럼 쓰지 않는다', () => {
  assert.match(budgetCheck('publish', 99).reason, /발행은/);
  assert.match(budgetCheck('retract', 99).reason, /내리기는/);
  assert.match(budgetCheck('purge', 99).reason, /삭제는/);
});

/**
 * 2026-09-10: 상한 검사가 공유 DB 연결을 닫아 발행을 망가뜨렸다.
 *
 * openDb() 는 싱글턴(_dbInstance)이다. 검사 뒤 db.close() 를 부르자 같은 프로세스의
 * 이후 호출이 전부 죽었다 — 09:20 회차는 **업로드는 됐는데 편성 대장 기록이 실패**했고
 * ("The database connection is not open") 원장이 0편으로 남아 상한 계산과 중복 방지가 함께 망가졌다.
 * 검사는 호출부에 연결 관리를 떠넘기지 않는다. 스스로 열고, 닫지 않는다.
 */
test('checkBudget 뒤에도 DB 를 계속 쓸 수 있다', async () => {
  const { checkBudget } = await import('./channel-budget.mjs');
  const { openDb } = await import('./db.mjs');
  const r = checkBudget('publish');
  assert.equal(typeof r.ok, 'boolean');
  // 검사가 연결을 닫았다면 여기서 "The database connection is not open" 으로 죽는다.
  const n = openDb().prepare('SELECT COUNT(*) n FROM shorts_published').get().n;
  assert.equal(typeof n, 'number');
});
