/**
 * channel-identity.test.mjs — 인증한 계정이 **그 채널의 주인**인가.
 *
 * 왜 (2026-09-11): yt-analytics 권한을 받으면서 계정을 잘못 골랐다.
 *   동의는 성공했고 토큰도 저장됐고 API 도 200 을 줬다 — 그런데 **다른 채널의 숫자**였다.
 *     인증된 채널 Powder & Ink (구독 5 · 영상 7) · 분석이 09-07 채널 전체 216회라고 답함
 *     실제 채널   Flowvium     (구독 37 · 영상 59) · 그날 8편이 각 ~1,300회
 *   숫자가 너무 안 맞아 알아챘지, 비슷했으면 **엉뚱한 채널을 분석하고 결론을 냈을 것이다.**
 *
 * 성공처럼 보이는 실패다. 인증 직후에 채널 id 를 대조한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelMatches } from './channel-identity.mjs';

test('id 가 같으면 통과', () => {
  assert.equal(channelMatches('UClduABJuRU26JvAG92JddSQ', 'UClduABJuRU26JvAG92JddSQ').ok, true);
});

test('다른 채널이면 이름까지 말해준다 — "실패" 만으로는 뭘 고칠지 모른다', () => {
  const r = channelMatches('UCmGqIzLiFIY4kQ9WOUvGRIw', 'UClduABJuRU26JvAG92JddSQ', { got: 'Powder & Ink' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Powder & Ink/);
  assert.match(r.reason, /UClduABJuRU26JvAG92JddSQ/);
});

test('기대값이 없으면 판정하지 않는다 — 없는 기준으로 막지 않는다', () => {
  assert.equal(channelMatches('UCabc', null).ok, null);
  assert.equal(channelMatches('UCabc', '').ok, null);
});

test('인증 채널을 못 읽으면 실패로 본다 — 모르면 통과시키지 않는다', () => {
  assert.equal(channelMatches(null, 'UClduABJuRU26JvAG92JddSQ').ok, false);
});
