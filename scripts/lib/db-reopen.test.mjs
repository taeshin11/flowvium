/**
 * db-reopen.test.mjs — 누가 닫아도 다음 호출이 살아난다.
 *
 * 왜 (2026-09-10): openDb() 는 싱글턴이다. 어느 한 곳이 db.close() 를 부르면
 *   같은 프로세스의 이후 호출이 전부 "The database connection is not open" 으로 죽는다.
 *   09:20 쇼츠 회차가 그렇게 됐다 — **업로드는 성공했는데 편성 대장 기록이 실패**해
 *   원장이 0편으로 남았고, 상한 계산과 중복 방지가 함께 망가졌다.
 *
 *   호출부 20여 곳의 close() 를 하나씩 고치는 것은 다음에 새로 추가되는 곳을 못 막는다.
 *   싱글턴을 쥔 쪽이 닫힌 상태를 감지해 다시 열면 어느 경로가 닫아도 안전하다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.mjs';

test('닫힌 뒤에도 openDb() 가 쓸 수 있는 연결을 준다', () => {
  const a = openDb();
  assert.equal(a.open, true);
  a.close();
  const b = openDb();
  assert.equal(b.open, true, '닫힌 인스턴스를 그대로 돌려주면 안 된다');
  const n = b.prepare('SELECT COUNT(*) n FROM shorts_published').get().n;
  assert.equal(typeof n, 'number');
});

test('닫지 않았으면 같은 인스턴스를 재사용한다 (매번 새로 열지 않는다)', () => {
  const a = openDb();
  assert.equal(openDb(), a);
});
