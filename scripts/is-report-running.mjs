#!/usr/bin/env node
/**
 * is-report-running.mjs — "보고서 생성기가 지금 도는가"를 셸에서 물어보는 얇은 CLI.
 *
 * 왜 필요한가(2026-08-22): run-report.sh 가 `pgrep -f "generate-report-local"` 로 판단했다.
 *   pgrep -f 는 명령줄 부분매칭이라 그 문자열이 스치기만 한 프로세스(내 셸 명령, grep, 에디터,
 *   모니터 명령)에도 걸린다. 그러면 예약된 발간이 [SKIP] 으로 조용히 건너뛴다 — 발간 누락이다.
 *   판정 규칙은 report-running.mjs 에 argv 구조 기반으로 이미 있는데 셸만 옛 규칙을 썼다.
 *   그 모듈 주석이 "run-report.sh 와 같은 패턴을 쓴다 — 두 곳이 어긋나면 재발한다"고 적어 뒀고,
 *   실제로 어긋나 있었다.
 *
 * 종료코드는 pgrep 관례를 따른다: 0 = 돌고 있음, 1 = 없음. (호출부 `if ...; then SKIP` 유지)
 */
import { findReportProcesses } from './lib/report-running.mjs';

const procs = findReportProcesses();
if (process.argv.includes('--verbose')) {
  for (const p of procs) console.log(`${p.pid}\t${p.ageSec}s\t${p.command}`);
}
process.exit(procs.length > 0 ? 0 : 1);
