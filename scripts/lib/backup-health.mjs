/**
 * backup-health.mjs — 인수인계 백업이 살아 있는지 판정한다.
 *
 * 왜: HANDOFF.md 는 "머신 사망 시" 복구 runbook 이고 그 전제가 Google Drive 일일 백업이다.
 *   그런데 2026-08-21 실측에서 최신 백업이 07-29(23일 전)였다 — Windows 기기 해체와 같은 날
 *   멈췄고 맥에는 대체 스케줄이 없었다. 그 사이 DB 는 133MB → 159MB 로 자랐다.
 *   백업은 '있다고 믿는 것' 이 가장 위험하다. 신선도와 스케줄 등록을 함께 본다.
 *
 * 경로는 backup-takeover.mjs 와 같은 환경변수(FLOWVIUM_BACKUP_DIR)에서 읽는다 —
 *   판정과 실행이 다른 경로를 보면 '백업 정상' 이라 답하면서 다른 데를 보고 있게 된다.
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { execFile } from 'child_process';
import { ROOT } from './project-root.mjs';
import { loadEnvLocal } from './llm-config.mjs';

const CFG_PATH = process.env.RESOURCE_THRESHOLDS_PATH ?? resolve(ROOT, 'data/resource-thresholds.json');
const DB_RE = /^flowvium-\d{4}-\d{2}-\d{2}\.db$/;

const run = (cmd, args) => new Promise((res) => {
  execFile(cmd, args, { timeout: 8000, maxBuffer: 4 << 20 }, (err, stdout) => res(err ? '' : String(stdout)));
});

/** launchd 잡 또는 cron-runner 의 잡 목록에 백업이 등록돼 있는가. */
async function findSchedule() {
  const list = await run('launchctl', ['list']);
  const line = String(list).split('\n').find((l) => /backup/i.test(l) && /spinai|flowvium/i.test(l));
  if (line) return `launchd:${line.trim().split(/\s+/).pop()}`;
  try {
    const cron = readFileSync(resolve(ROOT, 'scripts/cron-runner.mjs'), 'utf8');
    if (/backup-takeover/.test(cron)) return 'cron-runner';
  } catch { /* 읽기 실패 — 등록 안 된 것으로 본다 */ }
  return null;
}

/** @returns {{dest:string|null, destExists:boolean, newest:string|null, ageDays:number|null, maxAgeDays:number, scheduled:boolean, scheduledBy:string|null, issues:string[]}} */
export async function backupStatus() {
  loadEnvLocal();
  const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
  const maxAgeDays = cfg.backup.maxAgeDays;
  const dest = process.env.FLOWVIUM_BACKUP_DIR || null;
  const issues = [];

  if (!dest) issues.push('FLOWVIUM_BACKUP_DIR 미설정 — backup-takeover.mjs 는 이 값이 없으면 exit(1) 한다');
  const destExists = !!dest && existsSync(dest);
  if (dest && !destExists) issues.push(`백업 대상 경로 없음: ${dest}`);

  let newest = null, ageDays = null;
  if (destExists) {
    const files = readdirSync(dest).filter((f) => DB_RE.test(f)).sort();
    newest = files.length ? files[files.length - 1] : null;
    if (!newest) issues.push('DB 백업 파일이 하나도 없다');
    else {
      ageDays = Math.floor((Date.now() - statSync(join(dest, newest)).mtimeMs) / 86400000);
      if (ageDays > maxAgeDays) issues.push(`최신 백업이 ${ageDays}일 전(${newest}) — 임계 ${maxAgeDays}일. 그 사이 로컬 상태(학습이력·추천·outcome)는 무방비다`);
    }
  }

  const scheduledBy = await findSchedule();
  if (!scheduledBy) issues.push('백업이 어디에도 스케줄되어 있지 않다 — 한 번 돌고 끝나는 백업은 백업이 아니다');

  return { dest, destExists, newest, ageDays, maxAgeDays, scheduled: !!scheduledBy, scheduledBy, issues };
}
