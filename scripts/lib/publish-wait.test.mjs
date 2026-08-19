#!/usr/bin/env node
/**
 * publish-wait.test.mjs — 정시 발간 대기 판정 검증.
 *
 * 배경: generate-report-local.mjs:994 가 "waitMs > 25분이면 수동 실행으로 보고 sleep 생략" 이었다.
 *   25분은 리드타임 20분 시절의 상수다. 리드타임을 90분으로 올리자 예약 실행이 43분 일찍 끝나면
 *   '수동'으로 오판해 즉시 발간했다(2026-08-20 06:17 실측 — target 07:00 인데 06:17 발간).
 *   판정 근거를 시간 임계값이 아니라 '세션이 명시됐는가(=스케줄러가 부른 것인가)'로 바꾼다.
 */
const M = await import('./report-sessions.mjs');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

if (typeof M.isExplicitSession !== 'function') bad('isExplicitSession 미구현');
if (typeof M.publishWaitDecision !== 'function') bad('publishWaitDecision 미구현');
if (fail) { console.log(`\n결과: 실패 ${fail}건`); process.exit(1); }

const MIN = 60_000;

// ① 예약 실행(--session 명시)이 43분 일찍 끝나면 기다려야 한다 — 실측 재현
let d = M.publishWaitDecision({ session: 'morning', waitMs: 43 * MIN, explicit: true });
d.wait ? ok(`예약 실행 43분 일찍 → 대기 (${d.reason})`) : bad(`예약 실행 43분 일찍인데 생략됨 (${d.reason})`);

// ② 리드타임(90분)을 넘는 대기는 예약 실행이라도 비정상 → 생략
d = M.publishWaitDecision({ session: 'morning', waitMs: 200 * MIN, explicit: true });
!d.wait ? ok(`예약 실행이라도 리드타임 초과(200분) → 생략 (${d.reason})`) : bad('리드타임 초과인데 대기함');

// ③ 수동 실행은 종전 상한(설정값) 유지 — 회귀 없음
d = M.publishWaitDecision({ session: 'morning', waitMs: 43 * MIN, explicit: false });
!d.wait ? ok(`수동 실행 43분 → 생략 (종전 동작 유지, ${d.reason})`) : bad('수동 실행인데 43분 대기함');
d = M.publishWaitDecision({ session: 'morning', waitMs: 10 * MIN, explicit: false });
d.wait ? ok('수동 실행 10분 → 대기 (종전 동작 유지)') : bad('수동 실행 10분인데 생략됨');

// ④ 이미 지난 target 은 즉시
d = M.publishWaitDecision({ session: 'morning', waitMs: -5 * MIN, explicit: true });
!d.wait ? ok(`target 경과 → 즉시 발간 (${d.reason})`) : bad('target 지났는데 대기함');

// ⑤ --session 인식
M.isExplicitSession(['--session=morning']) ? ok('--session 인식') : bad('--session 미인식');
!M.isExplicitSession(['--locale=ko'])      ? ok('--session 없으면 수동으로 판정') : bad('오탐');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
