#!/usr/bin/env node
/**
 * report-id-midnight.test.mjs — 자정 회차가 **전날 행을 덮지 않는가.**
 *
 * 2026-09-08 실측: midnight 은 전날 22:30 에 시작해 자정을 넘겨 끝난다.
 *   생성 시각이 23:33(KST)인데 id 를 그날 날짜로 잡아 `2026-09-07:midnight` 이 됐고,
 *   그건 **전날 밤 회차의 id** 라 ON CONFLICT 로 조용히 덮였다.
 *   파일은 `report-2026-09-08-midnight-ko.json` 으로 맞게 저장되고 있었다 —
 *   **파일과 DB 가 다른 규칙을 쓰고 있었다.**
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };

const src = readFileSync(resolve(ROOT, 'scripts/lib/db.mjs'), 'utf8');
/(function inferReportId\([\s\S]*?\n\})/.test(src)
  ? ok('inferReportId 가 있다') : bad('inferReportId 를 못 찾았다');

// 규칙 자체를 그대로 재현해 검증한다 — 내부 함수라 직접 부를 수 없다.
const idDate = (gen, session) => {
  const kstMs = new Date(gen).getTime() + 9 * 3600000;
  const rolled = session === 'midnight' && new Date(kstMs).getUTCHours() >= 22
    ? kstMs + 24 * 3600000 : kstMs;
  return new Date(rolled).toISOString().slice(0, 10);
};
[
  ['2026-09-07T14:33:58Z', 'midnight', '2026-09-08', '23:33 에 끝난 자정 회차는 다음 날 것이다'],
  ['2026-09-07T15:00:08Z', 'midnight', '2026-09-08', '자정 직전도 다음 날 것이다'],
  ['2026-09-07T15:30:00Z', 'midnight', '2026-09-08', '자정을 넘겨 끝나도 같은 날짜여야 한다'],
  ['2026-09-07T02:21:24Z', 'noon', '2026-09-07', '다른 세션은 그대로'],
  ['2026-09-06T21:33:20Z', 'morning', '2026-09-07', '아침 회차는 그대로'],
].forEach(([gen, session, want, why]) => {
  const got = idDate(gen, session);
  got === want ? ok(`${why} (${got})`) : bad(`${why} — 받음 ${got}, 기대 ${want}`);
});

// 코드에 실제로 그 규칙이 들어 있는지도 본다 — 테스트만 통과하고 코드가 없으면 소용없다.
/session === 'midnight'[\s\S]{0,120}>= 22/.test(src)
  ? ok('db.mjs 가 자정 익일 규칙을 실제로 쓴다') : bad('db.mjs 에 익일 규칙이 없다');

console.log(fail === 0 ? '\n✅ report-id-midnight 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
