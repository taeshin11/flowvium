#!/usr/bin/env node
/** publish-health.test.mjs — 발행이 조용히 멈춘 것을 잡는가. 2026-09-19 신설. */
import { recentFailures, missedSlots } from './publish-health.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const NOW = new Date('2026-09-19T03:00:00Z');   // KST 12:00

// [1] 오늘 실제로 난 실패를 잡는다
const log = [
  '2026-09-19 10:17:07 [publish] [눈검증] ⚠ ...',
  '❌ invalid_grant',
  '2026-09-19 11:12:38 [publish] 제목: ...',
  'Error: 업로드 실패 (exit 1) — 위 출력을 볼 것',
].join('\n');
{
  const r = recentFailures(log, { hours: 6, now: NOW });
  r.auth === 1 && r.upload === 1 ? ok(`[1] 인증실패 ${r.auth} · 업로드실패 ${r.upload}`) : bad(`[1] ${JSON.stringify(r)}`);
}
// [2] 오래된 실패는 세지 않는다
recentFailures('2026-09-18 03:00:00 [publish] x\n❌ invalid_grant', { hours: 6, now: NOW }).auth === 0
  ? ok('[2] 창 밖의 실패는 안 센다') : bad('[2] 오래된 실패를 셌다');
// [3] 성공 로그는 조용하다
recentFailures('2026-09-19 11:43:38 [publish] 끝 · 3.8분\n✅ https://youtu.be/AI4NxdWUJUg', { now: NOW }).auth === 0
  ? ok('[3] 정상 로그엔 반응 없음') : bad('[3] 정상인데 잡았다');

// [4] 놓친 회차 수 — 오늘 실제 상황(10:15·11:10 실패, 마지막 발행 어제 21:45)
const SLOTS = [{h:10,m:15},{h:11,m:10},{h:12,m:10},{h:15,m:10},{h:16,m:20},{h:18,m:20},{h:21,m:45}];
{
  const r = missedSlots({ slots: SLOTS, lastPublishedAt: new Date('2026-09-18T12:45:00Z'), now: NOW });
  r.missed === 2 ? ok(`[4] 놓친 회차 ${r.missed} (10:15·11:10)`) : bad(`[4] ${JSON.stringify(r)}`);
}
// [5] 방금 올렸으면 0
missedSlots({ slots: SLOTS, lastPublishedAt: new Date('2026-09-19T02:43:00Z'), now: NOW }).missed === 0
  ? ok('[5] 방금 올렸으면 놓친 회차 없음') : bad('[5] 멀쩡한데 잡았다');
// [6] 한 번도 안 올렸으면 지난 회차 전부
missedSlots({ slots: SLOTS, lastPublishedAt: null, now: NOW }).missed === 2
  ? ok('[6] 기록이 없으면 지난 회차 전부로 센다') : bad('[6] null 처리');
// [7] 아직 안 온 회차는 안 센다(유예 포함)
missedSlots({ slots: SLOTS, lastPublishedAt: null, now: new Date('2026-09-18T23:00:00Z') }).expected === 0
  ? ok('[7] 첫 회차 전에는 셀 것이 없다') : bad('[7] 미래 회차를 셌다');

console.log(fail ? `\n❌ ${fail} 실패` : '\n✅ publish-health 통과');
process.exit(fail ? 1 : 0);
