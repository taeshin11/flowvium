#!/usr/bin/env node
/**
 * generator-proc-match.test.mjs — "보고서 생성기가 돌고 있다" 판정이 명령줄에 이름만
 *   스친 프로세스를 세지 않는가.
 *
 * 사건(2026-08-22): lib 스위트에서 proc-match.test.mjs 가 간헐 실패했다. 단독 실행은 통과.
 *   원인은 매칭 규칙이다:
 *     REPORT_PROC_RE = /node(?:\.exe)?\s[^\n]*generate-report-local\.mjs/
 *   `node` 와 파일명이 **같은 줄 어딘가에** 있기만 하면 매칭된다. 그래서 내가 친
 *     /bin/zsh -c "node scripts/run-lib-tests.mjs … git add … scripts/generate-report-local.mjs …"
 *   같은 셸 한 줄이 '생성기 실행 중'으로 잡혔다.
 *
 * 왜 중요한가: 이 판정은 check-stall 의 hung 판단과 segments-refresh 의 GPU 양보 판단이
 *   **둘 다** 쓴다(report-running.mjs:46 주석). 오탐 하나가 두 판정을 동시에 망가뜨린다.
 *   report-running.mjs 주석에 2026-08-21 에 같은 오탐을 보고 정규식으로 바꾼 기록이 있는데,
 *   정규식으로 바꿔도 "node 가 앞 어딘가에 있으면 통과"라 같은 함정이 남았다.
 *
 * 근본 규칙: 문자열 부분매칭이 아니라 **argv 구조**를 본다 —
 *   argv[0] 의 basename 이 node 이고, 뒤쪽 인자 중 하나가 그 스크립트여야 생성기다.
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const R = await import('./report-running.mjs');
if (typeof R.isGeneratorCommand !== 'function') {
  bad('isGeneratorCommand() 없음 — argv 구조 판정이 단일 출처로 없다');
  console.log('\n❌ 1건 실패'); process.exit(1);
}

// [1] 생성기가 아닌 것들 — 전부 실측에서 나온 형태다
const NOT = [
  `/bin/zsh -c cd /app && node scripts/run-lib-tests.mjs --strict && git add scripts/generate-report-local.mjs`,
  `/bin/sh -c node scripts/check-stall.mjs; grep generate-report-local.mjs scripts/*.mjs`,
  `grep -n generate-report-local.mjs scripts/verify-all.mjs`,
  `tail -f logs/report.log`,
  `node scripts/run-lib-tests.mjs`,
  `/bin/bash -c "pgrep -f generate-report-local"`,
  `vim scripts/generate-report-local.mjs`,
];
for (const c of NOT) {
  R.isGeneratorCommand(c) ? bad(`생성기가 아닌데 잡힌다: ${c.slice(0, 62)}`)
                          : ok(`제외: ${c.slice(0, 52)}`);
}

// [2] 진짜 생성기 — 과잉 차단하면 GPU 충돌·hung 미탐이 난다
const YES = [
  `node scripts/generate-report-local.mjs --locale ko --session morning`,
  `/Users/x/.local/node/bin/node /Users/x/app/scripts/generate-report-local.mjs`,
  `node --max-old-space-size=8192 scripts/generate-report-local.mjs`,
  `node.exe C:\\app\\scripts\\generate-report-local.mjs`,
];
for (const c of YES) {
  R.isGeneratorCommand(c) ? ok(`탐지: ${c.slice(0, 52)}`)
                          : bad(`진짜 생성기를 놓친다: ${c.slice(0, 62)}`);
}

// [3] 실제 판정 경로가 이 규칙을 쓰는가 — 규칙만 만들고 안 쓰면 의미 없다
const procs = R.findReportProcesses();
const wrong = procs.filter(p => !R.isGeneratorCommand(p.command));
wrong.length === 0
  ? ok(`findReportProcesses 결과 ${procs.length}건 전부 구조 규칙 통과`)
  : bad(`판정 경로가 다른 규칙을 쓴다: ${wrong[0].command.slice(0, 60)}`);

// [4] 이 테스트 프로세스 자신의 명령줄이 오탐되지 않는가 (스위트 동시 실행 회귀)
R.isGeneratorCommand(process.argv.join(' '))
  ? bad('테스트 자신이 생성기로 잡힌다')
  : ok('테스트 자신은 제외된다');

// [5] 발간 런처가 옛 pgrep 부분매칭으로 되돌아가지 않았는가.
//   run-report.sh 는 이 판정으로 '이번 세션 건너뜀'을 결정한다 — 오탐 = 발간 누락.
{
  const { readFileSync } = await import('fs');
  const sh = readFileSync(resolve(ROOT, 'scripts/run-report.sh'), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
  /pgrep\s+-f\s+["']?generate-report-local/.test(sh)
    ? bad('run-report.sh 가 다시 pgrep -f 부분매칭을 쓴다 — 셸 한 줄에 이름이 스치면 발간을 건너뛴다')
    : ok('run-report.sh 가 pgrep 부분매칭을 쓰지 않는다');
  /is-report-running\.mjs/.test(sh)
    ? ok('run-report.sh 가 단일 출처 판정을 쓴다')
    : bad('run-report.sh 가 판정 단일 출처를 쓰지 않는다');
}

console.log(fail === 0 ? '\n✅ generator-proc-match 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
