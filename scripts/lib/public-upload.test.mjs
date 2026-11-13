// public-upload.test.mjs — 로그아웃 공개 화면 기준 '마지막 실제 공개'. node --test scripts/lib/public-upload.test.mjs
// 왜(11/13 사장님 지시): 예비 시간(창고에 쌓인 편수)만 보면 올라가지 않아도 모른다. 첫 줄은 시청자가 보는 마지막 공개 시각,
//   48시간 넘으면 비상. 채널 RSS(youtube.com/feeds/videos.xml)는 로그인 없이 공개 영상만 싣는다(비공개·예약 전은 안 나옴).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, lastPublic, firstLine } from './public-upload.mjs';

const xml = `<feed><entry><yt:videoId>AJcSKzy8w3U</yt:videoId><title>美연준 &quot;축소&quot;</title><published>2026-11-13T07:26:56+00:00</published></entry>
<entry><yt:videoId>ObTCsIfmbtY</yt:videoId><title>속보</title><published>2026-11-13T06:18:57+00:00</published></entry></feed>`;

test('RSS 에서 영상·제목·공개 시각', () => {
  const e = parseFeed(xml);
  assert.equal(e.length, 2);
  assert.equal(e[0].videoId, 'AJcSKzy8w3U');
  assert.equal(e[0].title, '美연준 "축소"');
});

test('가장 늦은 공개 시각(순서가 섞여 있어도)', () => {
  assert.equal(lastPublic([...parseFeed(xml)].reverse()).videoId, 'AJcSKzy8w3U');
  assert.equal(lastPublic([]), null);
});

test('첫 줄: KST 로, 48시간 넘으면 비상', () => {
  const now = Date.parse('2026-11-13T13:00:00Z');
  assert.equal(firstLine({ last: '2026-11-13T07:26:56+00:00', hours: 46, now }), '마지막 실제 공개 11/13 16:26 · 예비 46시간');
  assert.equal(firstLine({ last: '2026-11-11T12:00:00Z', hours: 46, now }), '🚨 비상 — 마지막 실제 공개 11/11 21:00 (49시간 전) · 예비 46시간');
  assert.equal(firstLine({ last: null, hours: 46, now }), '🚨 비상 — 공개 화면에서 영상을 못 읽음 · 예비 46시간');
});
