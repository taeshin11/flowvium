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
import Database from 'better-sqlite3';
import { resolve, join } from 'path';
import { execFile } from 'child_process';
import { ROOT } from './project-root.mjs';
import { loadEnvLocal } from './llm-config.mjs';

const CFG_PATH = process.env.RESOURCE_THRESHOLDS_PATH ?? resolve(ROOT, 'data/resource-thresholds.json');
// backup-takeover.mjs 와 같은 기본값을 쓴다 — 판정과 실행이 다른 데를 보면 안 된다.
const LOCAL_DEST = () => process.env.FLOWVIUM_BACKUP_LOCAL_DIR || resolve(process.env.HOME ?? '.', 'flowvium_backups');
const DB_RE = /^flowvium-\d{4}-\d{2}-\d{2}\.db$/;

// 2026-08-22: 원격(Drive) 판독은 *자식 프로세스* 로만 한다.
//   1차 회귀: 상한 없는 readdirSync 하나가 check-stall 을 170s cron 상한까지 끌고 가
//     `stall=TIMEOUT(hang)` 을 16회 — 모니터가 6시간 넘게 눈이 멀었다(내가 만든 회귀).
//   2차: Promise.race 로 상한을 걸었더니 *함수는* 5초에 돌아오는데 **프로세스가 안 죽었다**.
//     launchd 실측 — backupStatus() 는 값을 찍고도 3분 넘게 node 가 종료되지 않았다.
//     node 의 fs 스레드풀 요청은 취소가 불가능하다. Drive readdir 이 미결로 남으면
//     libuv 가 그 핸들을 붙잡아 이벤트 루프가 안 비고, 결국 똑같이 hang 이다.
//     타임아웃은 '기다리기를 그만두는' 것이지 '작업을 취소하는' 게 아니다.
//   그래서 취소 가능한 경계 = 프로세스 경계로 옮긴다. execFile 의 timeout 은 자식을 죽이고,
//   부모의 루프는 깨끗하게 빈다. 느린 원격 FS 를 이 프로세스 안으로 들이지 않는다.
const REMOTE_TIMEOUT_MS = Number(process.env.BACKUP_HEALTH_REMOTE_TIMEOUT_MS) || 8000;

const run = (cmd, args, timeout = 8000) => new Promise((res) => {
  const child = execFile(cmd, args, { timeout, killSignal: 'SIGKILL', maxBuffer: 4 << 20 },
    (err, stdout) => res(err ? null : String(stdout)));
  // execFile 의 timeout 이 안 먹는 경우(자식이 커널 대기)에도 부모는 풀려나야 한다.
  const hard = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* 이미 종료 */ } res(null); }, timeout + 2000);
  child.on('close', () => clearTimeout(hard));
  hard.unref();
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
  let destExists = false, newest = null, ageDays = null, remoteUnknown = false;
  if (dest) {
    // 이름과 mtime(epoch)을 한 번에. run() 이 null 이면 '못 읽었다' — '없다' 와 구분한다.
    const listed = await run('/bin/sh', ['-c',
      `cd ${JSON.stringify(dest)} 2>/dev/null && /usr/bin/stat -f '%m %N' *.db 2>/dev/null`], REMOTE_TIMEOUT_MS);
    if (listed === null) {
      remoteUnknown = true;
      issues.push('원격 백업 상태 확인 불가(응답 없음) — 로컬 백업만 보장된다. Drive 접근 권한 부여 전까지 정상');
    } else {
      destExists = true;
      const rows = listed.split('\n').map((l) => l.match(/^(\d+)\s+(.+)$/)).filter(Boolean)
        .map((m) => ({ mtime: Number(m[1]) * 1000, name: m[2] })).filter((r) => DB_RE.test(r.name))
        .sort((a, b) => a.mtime - b.mtime);
      newest = rows.length ? rows[rows.length - 1].name : null;
      if (!newest) issues.push('DB 백업 파일이 하나도 없다');
      else {
        ageDays = Math.floor((Date.now() - rows[rows.length - 1].mtime) / 86400000);
        if (ageDays > maxAgeDays) issues.push(`최신 백업이 ${ageDays}일 전(${newest}) — 임계 ${maxAgeDays}일. 그 사이 로컬 상태(학습이력·추천·outcome)는 무방비다`);
      }
    }
  }

  const scheduledBy = await findSchedule();
  if (!scheduledBy) issues.push('백업이 어디에도 스케줄되어 있지 않다 — 한 번 돌고 끝나는 백업은 백업이 아니다');

  // 로컬 2차 백업 — launchd 컨텍스트에서 Drive 가 막혀도 이건 반드시 남아야 한다.
  //   원격이 오래됐어도 로컬이 신선하면 '기기 사망 외 위험' 은 막힌 상태다. 둘을 구분해 보고한다.
  const localDir = LOCAL_DEST();
  let localNewest = null, localAgeDays = null;
  if (existsSync(localDir)) {
    const lf = readdirSync(localDir).filter((f) => DB_RE.test(f)).sort();
    localNewest = lf.length ? lf[lf.length - 1] : null;
    if (localNewest) localAgeDays = Math.floor((Date.now() - statSync(join(localDir, localNewest)).mtimeMs) / 86400000);
  }
  if (!localNewest) issues.push(`로컬 2차 백업 없음(${localDir}) — 원격이 막히면 남는 게 없다`);
  else if (localAgeDays > maxAgeDays) issues.push(`로컬 2차 백업이 ${localAgeDays}일 전(${localNewest}) — 임계 ${maxAgeDays}일`);

  // 존재 ≠ 복원 가능. 손상된 백업은 없는 백업보다 나쁘다 — 있다고 믿게 만들기 때문이다.
  //   readonly 로 열어 핵심 테이블 행수를 센다. 0행이면 백업 절차가 깨진 것이다.
  let restorable = null, reportRows = null;
  if (localNewest) {
    try {
      const db = new Database(join(localDir, localNewest), { readonly: true });
      reportRows = db.prepare('SELECT COUNT(*) c FROM reports').get().c;
      db.close();
      restorable = reportRows > 0;
      if (!restorable) issues.push(`로컬 백업(${localNewest})이 열리지만 reports 0행 — 복원해도 빈 DB 다`);
    } catch (e) {
      restorable = false;
      issues.push(`로컬 백업(${localNewest}) 열기 실패: ${String(e.message).slice(0, 50)} — 복원 불가`);
    }
  }

  return { dest, destExists, newest, ageDays, maxAgeDays, scheduled: !!scheduledBy, scheduledBy,
           remoteUnknown, localDir, localNewest, localAgeDays, restorable, reportRows, issues };
}
