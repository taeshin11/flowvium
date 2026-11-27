#!/usr/bin/env node
// series-ab.test — 11/27 mini2: 11/24 변경(㉠ 시리즈 표지 + ㉡ 첫 훅을 시청자 돈 영향으로)을 11/30 까지 번갈아 잰다.
//   A9편이 거의 11/24 하루치라 날 효과와 못 갈랐다. 홀수 편 A, 짝수 편 B(옛 모습), 3일 조회 중앙값 먼저·구독/1천 다음.
import { readFileSync } from 'fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const T = (c, m) => (c ? ok(m) : bad(m));
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
try {
  const { seriesArm, armEnv, AB_UNTIL } = await import('./series-ab.mjs');
  const before = Date.parse('2026-11-28T00:00:00Z'), after = Date.parse(AB_UNTIL) + 1;
  T(seriesArm({ lastArm: null, now: before }) === 'A', '[1] 첫 편은 A');
  T(seriesArm({ lastArm: 'A', now: before }) === 'B', '[2] A 다음은 B');
  T(seriesArm({ lastArm: 'B', now: before }) === 'A', '[3] B 다음은 A');
  T(seriesArm({ lastArm: 'B', now: after }) === 'A', '[4] 기간이 끝나면 지금 모습(A) — 결정 전까지 그대로');
  T(AB_UNTIL === '2026-11-30T15:00:00Z', '[5] 11/30 KST 끝까지');
  const b = armEnv('B'), a = armEnv('A');
  T(b.SHORTS_SERIES === '0' && b.SHORTS_STAKE === '0' && b.SHORTS_ARM === 'B', '[6] B 는 표지·돈 훅 둘 다 끈다');
  T(a.SHORTS_SERIES === '1' && a.SHORTS_STAKE === '1' && a.SHORTS_ARM === 'A', '[7] A 는 둘 다 켠다');
} catch (e) { bad(`lib 없음: ${e.message.slice(0, 80)}`); }
const ms = src('video/make-shorts.mjs'), vp = src('video-publish.mjs'), db = src('lib/db.mjs');
T(/const STAKE_RULE = process\.env\.SHORTS_STAKE === '0' \? '' : STAKE_HOOK_RULE/.test(ms), '[8] make-shorts 돈 훅 규칙이 SHORTS_STAKE 를 따른다');
T(/arm: process\.env\.SHORTS_ARM \?\? null/.test(ms), '[9] 편 메타에 갈래를 적는다');
T(/seriesArm\(\{ lastArm: db\.lastShortsArm\(\)/.test(vp) && /\.\.\.ARM_ENV/.test(vp), '[10] video-publish 가 갈래를 골라 넘긴다');
T(/arm: last\.arm \?\? null/.test(vp) && /ADD COLUMN arm TEXT/.test(db) && /export function lastShortsArm/.test(db), '[11] 발행 기록에 갈래 칸');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
