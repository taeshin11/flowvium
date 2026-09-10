/**
 * published-duration.test.mjs — 올린 영상이 만든 영상과 같은가.
 *
 * 왜 (2026-09-10 사용자 "보고서랑 쇼츠 다 잘봐라"):
 *   렌더 로그는 "고정 홍보 클립을 끝에 붙인다" 를 찍지만, **붙었는지는 아무도 확인하지 않는다.**
 *   concat 이 조용히 실패하거나 업로드가 잘린 편이 있어도 로그는 똑같이 성공으로 보인다.
 *   쇼츠는 매일 10편이 나가고 사람이 다 볼 수 없다 — 길이만이라도 기계가 대조해야 한다.
 *
 *   광고 클립이 5.1초다. 그게 빠지면 길이가 그만큼 짧아지므로 2초 허용오차면 잡힌다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIsoDuration, durationVerdict, TOLERANCE_SEC } from './published-duration.mjs';

test('유튜브 ISO 길이를 초로 읽는다', () => {
  assert.equal(parseIsoDuration('PT32S'), 32);
  assert.equal(parseIsoDuration('PT1M5S'), 65);
  assert.equal(parseIsoDuration('PT2M'), 120);
  assert.equal(parseIsoDuration(null), null);
  assert.equal(parseIsoDuration('garbage'), null);
});

test('허용오차 안이면 통과', () => {
  assert.equal(durationVerdict(32.4, 'PT32S').ok, true);
  assert.equal(durationVerdict(32.4, 'PT33S').ok, true);
});

test('광고 클립이 빠진 만큼 짧으면 잡는다', () => {
  const v = durationVerdict(37.4, 'PT32S');   // 5.1초 클립 누락
  assert.equal(v.ok, false);
  assert.match(v.reason, /짧다/);
});

test('예상보다 길어도 잡는다 — 두 번 붙은 경우', () => {
  const v = durationVerdict(32.4, 'PT38S');
  assert.equal(v.ok, false);
  assert.match(v.reason, /길다/);
});

test('기준이 없으면 판정하지 않는다 — 모르는 것을 결함이라 하지 않는다', () => {
  assert.equal(durationVerdict(null, 'PT32S').ok, null);
  assert.equal(durationVerdict(32.4, null).ok, null);
});

test('허용오차는 광고 클립보다 작아야 의미가 있다', () => {
  assert.ok(TOLERANCE_SEC < 5, '5.1초 클립 누락을 못 잡으면 검사가 의미 없다');
});
