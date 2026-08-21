#!/usr/bin/env node
/**
 * proc-match.test.mjs — 프로세스 탐지가 자기 자신과 '이름만 스친 것'을 세지 않는다.
 *
 * 배경(2026-08-21 실측): check-stall 이 "report-gen PID 13333 실행 중 (19분 / 세션 불명)" 을 냈다.
 *   13333 은 보고서 생성기가 아니라 *내가 띄운 백그라운드 대기 셸* 이었다 —
 *   명령줄에 'generate-report-local' 문자열이 들어 있었을 뿐이다.
 *   실제 생성기는 PID 10982 하나뿐인데 모니터는 둘로 셌다.
 *
 *   platform-ops.findProcesses 는 command.includes(pattern) 단순 매칭이고,
 *   그 다음 줄의 자기제외 `if (+pid === process.pid && !command.includes(pattern)) continue;` 는
 *   앞 줄이 이미 includes 를 요구하므로 *절대 참이 될 수 없는* 죽은 코드다.
 *
 *   같은 함정을 report-running.mjs 에서는 이미 막았는데(자기·부모 PID 제외) 여기는 남아 있었다.
 *   '한 곳만 고치고 나머지를 안 본' 오늘의 반복 패턴이다.
 *
 * 오탐의 대가: hung 판정과 GPU 양보 판정이 둘 다 이 함수를 본다.
 *   유령 생성기 하나면 "동시 2건" 오경보가 나고, 반대로 진짜 hung 은 묻힌다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { findProcesses } from './platform-ops.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 자기 자신에 걸리지 않는다 — 이 테스트의 argv 에 'proc-match.test' 가 들어 있다
const self = findProcesses('proc-match.test');
self.some(p => p.pid === process.pid)
  ? bad(`자기 프로세스(${process.pid})를 결과에 포함한다 — 죽은 자기제외 코드`)
  : ok('자기 프로세스를 세지 않는다');

// [2] 정규식으로 정확히 지정할 수 있다 (문자열 스침과 실행 파일 구분)
const rx = findProcesses(/node\b[^\n]*generate-report-local\.mjs/);
Array.isArray(rx) ? ok(`정규식 패턴 지원 (매칭 ${rx.length}건)`) : bad('정규식 패턴을 못 받는다');
if (rx.some(p => /zsh|bash|sh\b/.test(p.command) && !/generate-report-local\.mjs/.test(p.command)))
  bad('정규식인데도 셸이 섞여 들어온다');

// [3] 보고서 프로세스 탐지가 한 곳에서 정의된다
let R = null;
try { R = await import('./report-running.mjs'); } catch (e) { bad(`report-running.mjs import 실패: ${e.message}`); }
if (R) {
  typeof R.findReportProcesses === 'function'
    ? ok('findReportProcesses() 제공 — 보고서 프로세스 판정 단일 출처')
    : bad('findReportProcesses() 없음 — 호출부마다 패턴을 다시 적게 된다');
  if (typeof R.findReportProcesses === 'function') {
    const procs = await R.findReportProcesses();
    const shells = procs.filter(p => !/generate-report-local\.mjs/.test(p.command) || /^\/bin\/(z|ba)?sh/.test(p.command));
    shells.length === 0 ? ok(`실제 생성기만 ${procs.length}건 (셸 오탐 0)`) : bad(`셸이 ${shells.length}건 섞였다: ${shells[0].command.slice(0, 50)}`);
  }
}

// [4] 소비처가 그걸 쓴다
const stall = readFileSync(resolve(ROOT, 'scripts/check-stall.mjs'), 'utf8');
/findReportProcesses/.test(stall)
  ? ok('check-stall 이 단일 출처를 쓴다')
  : bad("check-stall 이 findProcesses('generate-report-local') 문자열 매칭을 그대로 쓴다");

console.log(fail === 0 ? '\n✅ proc-match 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
