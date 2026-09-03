#!/usr/bin/env node
/** reap-zombies 의 etime 해석. 잘못 읽으면 유예 판정이 틀려 살아있는 작업을 죽인다. */
let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };
const { etimeToSeconds: t } = await import('../reap-zombies.mjs');

const cases = [
  ['46:37', 46 * 60 + 37, 'MM:SS'],
  ['01:29', 89, 'MM:SS (앞자리 0)'],
  ['17:02:52', 17 * 3600 + 2 * 60 + 52, 'HH:MM:SS'],
  ['03-01:18:28', 3 * 86400 + 3600 + 18 * 60 + 28, 'DD-HH:MM:SS'],
  ['22-17:06:48', 22 * 86400 + 17 * 3600 + 6 * 60 + 48, '22일짜리 시스템 데몬'],
];
for (const [inp, want, label] of cases) {
  const got = t(inp);
  got === want ? ok(`${label}: "${inp}" → ${got}s`) : bad(`${label}: "${inp}" → ${got}s (기대 ${want})`);
}
// 못 읽으면 0 — 0 은 항상 유예 판정에 걸려 **죽이지 않는** 쪽으로 떨어진다. 안전한 기본값이다.
t('') === 0 && t('이상한값') === 0 ? ok('해석 실패는 0 → 유예(안 죽인다)') : bad('해석 실패 처리 이상');

// 5분 유예 경계
t('04:59') < 300 && t('05:01') > 300 ? ok('5분 유예 경계가 맞다') : bad('유예 경계 오류');

console.log(fail === 0 ? '\n✅ reap 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
