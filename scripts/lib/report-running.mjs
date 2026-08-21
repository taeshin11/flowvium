/**
 * report-running.mjs — "지금 보고서 파이프라인이 도는가"의 단일 판단.
 *
 * 왜 한 곳으로 모으나: 단일 GPU 라 보고서 Wave1 이 도는 동안 다른 LLM 작업이 끼어들면
 *   서로 굶는다(기록: 2026-06-11 Wave1 전멸). 그런데 판단이 세 곳에 흩어져 서로 달랐다.
 *     run-report.sh          pgrep -f generate-report-local   ← 프로세스를 본다
 *     cron-runner.mjs        logs/report-pipeline.lock 만     ← 락만 본다
 *     build-segments-dynamic logs/report-pipeline.lock 만     ← 락만 본다
 *   락은 래퍼(run-report.sh)만 만든다. run-report.sh 는 주석에 "수동으로
 *   generate-report-local.mjs 를 직접 돌리는 경우가 실제로 있다" 고 적고 pgrep 까지 하는데,
 *   정작 GPU 에 끼어드는 쪽 둘은 락만 봐서 그 실행을 못 본다.
 *   래퍼가 이미 옳게 판단한 규칙을, 나머지가 안 쓰고 있었던 것이다.
 *
 * 판단 = 신선한 락  OR  살아 있는 생성 프로세스.
 *   락은 90분 상한이 있다(죽은 락 회수). 프로세스는 살아 있으면 그 자체가 근거다.
 */
import { statSync } from 'fs';
import { resolve } from 'path';
import { execFile } from 'child_process';
import { findProcesses } from './platform-ops.mjs';

export const LOCK_REL = 'logs/report-pipeline.lock';
export const LOCK_MAX_AGE_MS = 90 * 60 * 1000;
/** run-report.sh 와 같은 패턴을 쓴다 — 두 곳이 어긋나면 이 결함이 그대로 재발한다. */
export const REPORT_PROC_PATTERN = 'generate-report-local';

/**
 * pgrep -f. 미매칭은 exit 1 이라 예외로 오지 않게 false 로 접는다.
 *
 * 자기 자신(과 부모)은 제외한다. -f 는 명령줄 전체를 보므로, 이 패턴을 인자에 달고 도는
 * 프로세스는 무엇이든 매칭된다 — 이번 세션에 내가 확인용으로 친 명령이 스스로에 걸려
 * "생성기 3개 실행 중" 으로 잘못 읽혔다. 판정 함수가 같은 함정에 빠지면
 * segments-refresh 가 영원히 GPU 를 양보하게 된다.
 */
export function isProcessAlive(pattern = REPORT_PROC_PATTERN) {
  return new Promise((res) => {
    execFile('pgrep', ['-f', pattern], (err, stdout) => {
      if (err) return res(false);              // exit 1 = 미매칭
      const self = new Set([String(process.pid), String(process.ppid)]);
      const pids = String(stdout).trim().split('\n').map(s => s.trim()).filter(s => s && !self.has(s));
      res(pids.length > 0);
    });
  });
}

/**
 * 생성기가 살아 있는가. pgrep 문자열 매칭이 아니라 findReportProcesses 를 쓴다 —
 *   'node ... generate-report-local.mjs' 형태만 생성기로 센다(명령줄에 이름만 스친 것 제외).
 */
export const isReportProcessAlive = async () => findReportProcesses().length > 0;

/** 래퍼가 남긴 락이 신선한가 (90분 미만). */
export function isLockFresh(root = process.cwd()) {
  try {
    const st = statSync(resolve(root, LOCK_REL));
    return (Date.now() - st.ctimeMs) < LOCK_MAX_AGE_MS;
  } catch { return false; }
}

/** 최종 판단. 둘 중 하나라도 참이면 GPU 를 양보해야 한다. */
export async function isReportPipelineRunning(root = process.cwd()) {
  if (isLockFresh(root)) return true;
  return isReportProcessAlive();
}


/**
 * 실제로 도는 보고서 생성기 목록. 명령줄에 이름이 스친 것(셸·모니터 명령)은 제외한다 —
 *   'node ... generate-report-local.mjs' 형태만 생성기다.
 *   실측 2026-08-21: 내 백그라운드 대기 셸의 argv 에 이름이 들어 있어 모니터가 '동시 2건'을 냈다.
 *   hung 판정과 GPU 양보 판정이 둘 다 이 목록을 보므로, 오탐 하나가 두 판정을 동시에 망친다.
 * @returns {Array<{pid:number, ageSec:number, command:string}>}
 */
export const REPORT_PROC_RE = /node(?:\.exe)?\s[^\n]*generate-report-local\.mjs/;
export function findReportProcesses() {
  return findProcesses(REPORT_PROC_RE);
}
