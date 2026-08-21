/**
 * stale-jobs.mjs — 할 일을 끝내고도 안 죽은 잡을 찾아낸다.
 *
 * 배경(2026-08-22): 예약 백업 잡이 00:57 에 `총 소요 60.4s / ✅ 완료` 를 찍고
 *   **5시간** 더 살아 있었다. libuv 스레드풀 4칸과 Drive 데몬을 붙든 채로,
 *   같은 기기에서 보고서가 도는 동안. 20분마다 도는 모니터가 그걸 5시간 몰랐다 —
 *   검사 9종 중 [3] 만 프로세스를 보는데 그건 report-gen 전용이었다.
 *
 *   '주기 잡인데 주기보다 오래 살아 있다' 는 잡 종류와 무관한 신호다. 원인이
 *   스레드풀이든 네트워크든 데드락이든, 증상은 같고 조치도 같다.
 *
 * 임계값은 여기 박지 않는다 — data/resource-thresholds.json 의 `jobs` 절에서 읽는다.
 *   코드에 박으면 다음 사람이 못 찾고, 기기가 바뀌면 그대로 틀린 값이 된다.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';
import { ROOT } from './project-root.mjs';

const CFG_PATH = process.env.RESOURCE_THRESHOLDS_PATH ?? resolve(ROOT, 'data/resource-thresholds.json');

export function loadJobPolicy() {
  const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
  const j = cfg.jobs;
  if (!j) throw new Error(`${CFG_PATH} 에 jobs 절이 없다 — 임계값 없이 판정하지 않는다`);
  return j;
}

/** `ps` 로 현재 프로세스 목록을 {pid, elapsedSec, command} 로 읽는다. */
export function listProcesses() {
  const out = execFileSync('/bin/ps', ['-eo', 'pid=,etime=,command='], { maxBuffer: 8 << 20 }).toString();
  const rows = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), elapsedSec: parseEtime(m[2]), command: m[3] });
  }
  return rows;
}

/** ps 의 etime: [[dd-]hh:]mm:ss */
export function parseEtime(s) {
  const m = String(s).match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  const [, d, h, mi, sec] = m;
  return (Number(d || 0) * 86400) + (Number(h || 0) * 3600) + (Number(mi) * 60) + Number(sec);
}

const scriptOf = (command) => {
  const m = String(command).match(/([\w.-]+\.mjs)\b/);
  return m ? m[1] : null;
};

/**
 * @param {{pid:number, elapsedSec:number, command:string}[]} procs
 * @param {object} policy  loadJobPolicy() 결과
 * @returns {{pid:number, script:string, minutes:number, limit:number}[]}
 */
export function findStaleJobs(procs, policy) {
  const allow = policy.residentAllowlist ?? [];
  const byScript = policy.maxMinutesByScript ?? {};
  const out = [];
  for (const p of procs) {
    if (allow.some((a) => p.command.includes(a))) continue;
    const script = scriptOf(p.command);
    // scripts/ 아래의 일회성 잡만 본다. 그 밖의 프로세스는 이 검사의 관할이 아니다.
    if (!script || !/\/scripts\//.test(p.command)) continue;
    const limit = byScript[script] ?? policy.defaultMaxMinutes;
    const minutes = Math.floor(p.elapsedSec / 60);
    if (minutes > limit) out.push({ pid: p.pid, script, minutes, limit });
  }
  return out;
}
