/**
 * maint-staleness.test.mjs — 놓친 작업이 **얼마 만에** 소급되는가.
 *
 * 왜 (2026-09-12): node-cron 이 실행을 827번 놓쳤다(최근 이틀 68번).
 *   "Possible blocking IO or high CPU user at the same process used by node-cron" —
 *   단일 프로세스라 한 작업이 오래 물면 그동안의 스케줄이 통째로 밀린다.
 *   오늘 shorts-health(조회수 판정)가 08:30 에 정확히 그렇게 날아갔다.
 *
 *   소급 기제는 이미 있다(20분마다 stale 잡 1개). 문제는 **언제 stale 로 보느냐** 다.
 *   하루 한 번 도는 작업에 maxAgeH=30 을 주면, 놓친 뒤 6시간을 더 기다려야 소급된다.
 *   주기보다 조금만 길게 잡아야 놓친 직후에 따라잡는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catchUpLagH, suggestMaxAgeH } from './maint-staleness.mjs';

test('하루 한 번 작업은 24시간보다 살짝 길게', () => {
  const m = suggestMaxAgeH(24);
  assert.ok(m > 24, '24 이하면 정상 실행도 stale 로 본다');
  assert.ok(m <= 27, '너무 길면 놓친 뒤 한참 기다린다');
});

test('자주 도는 작업은 그만큼 짧게', () => {
  assert.ok(suggestMaxAgeH(6) < suggestMaxAgeH(24));
  assert.ok(suggestMaxAgeH(6) > 6);
});

test('놓친 뒤 소급까지 걸리는 시간 = maxAgeH - 주기', () => {
  assert.equal(catchUpLagH(24, 30), 6);
  assert.equal(catchUpLagH(24, 26), 2);
});

test('maxAgeH 가 주기보다 짧으면 정상 실행도 stale — 0 이하로 알린다', () => {
  assert.ok(catchUpLagH(24, 20) < 0);
});

test('주기를 모르면 제안하지 않는다', () => {
  assert.equal(suggestMaxAgeH(null), null);
  assert.equal(suggestMaxAgeH(0), null);
});
