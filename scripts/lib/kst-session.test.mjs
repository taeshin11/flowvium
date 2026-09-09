/**
 * kst-session.test.mjs — "지금 라이브에 떠 있어야 할 보고서" 를 API 와 같은 규칙으로 고른다.
 *
 * 왜 (2026-09-09): check-report-page 가 "로컬 최신 = 라이브" 를 가정해 매일 밤 거짓 경보를 냈다.
 *   자정 회차는 22:30 에 시작해 23:41 에 끝나지만 midnight 세션은 00:00 에 열린다.
 *   즉 23:41~24:00 사이엔 **로컬 최신이 아직 라이브가 아닌 것이 정상**이다.
 *   경계를 route.ts 에 한 번, 여기에 또 적으면 갈라지므로 아래 테스트가 route.ts 를 읽어 대조한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kstSession, expectedReportId, BOUNDARIES } from './kst-session.mjs';

const at = (h, m = 0) => new Date(Date.UTC(2026, 8, 9, h - 9, m));   // KST h:m → UTC

test('세션 경계가 API 와 같다', () => {
  assert.equal(kstSession(at(0, 5)), 'midnight');
  assert.equal(kstSession(at(6, 59)), 'midnight');
  assert.equal(kstSession(at(7, 0)), 'morning');
  assert.equal(kstSession(at(11, 59)), 'morning');
  assert.equal(kstSession(at(12, 0)), 'noon');
  assert.equal(kstSession(at(15, 59)), 'noon');
  assert.equal(kstSession(at(16, 0)), 'afternoon');
  assert.equal(kstSession(at(21, 29)), 'afternoon');
  assert.equal(kstSession(at(21, 30)), 'evening');
  assert.equal(kstSession(at(23, 59)), 'evening');
});

test('23:41 에 라이브여야 할 것은 자정회차가 아니라 저녁회차다', () => {
  assert.equal(expectedReportId(at(23, 41), 'ko'), '2026-09-09:evening:ko');
});

test('00:05 이 되면 그때 자정회차가 라이브다 (날짜도 넘어간다)', () => {
  const t = new Date(Date.UTC(2026, 8, 9, 15, 5));    // KST 2026-09-10 00:05
  assert.equal(expectedReportId(t, 'ko'), '2026-09-10:midnight:ko');
});

test('경계값이 route.ts 와 갈라지지 않는다 — 소스를 직접 읽어 대조', () => {
  const src = readFileSync('src/app/api/investment-strategy/route.ts', 'utf8');
  const seg = src.slice(src.indexOf('function getKstSession'), src.indexOf('function cacheKey'));
  for (const [name, mins] of Object.entries(BOUNDARIES)) {
    const h = Math.floor(mins / 60); const m = mins % 60;
    const pat = m === 0 ? new RegExp(`hm < ${h} \\* 60\\b(?!\\s*\\+)`) : new RegExp(`hm < ${h} \\* 60 \\+ ${m}`);
    assert.ok(pat.test(seg), `route.ts 에 ${name} 경계(${h}:${String(m).padStart(2, '0')})가 없다 — 규칙이 갈라졌다`);
  }
});
