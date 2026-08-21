#!/usr/bin/env node
/**
 * backup-health-timeout.test.mjs — 백업 상태 판독이 느린 원격 FS 에 매달리지 않는다.
 *
 * 배경(2026-08-22, 내가 만든 회귀): cron 로그에 `stall=TIMEOUT(hang)` 이 16회.
 *   08-21 23:03 KST 부터 20분마다, 즉 **모니터가 6시간 넘게 눈이 먼 상태**였다.
 *   대화형 셸에서는 check-stall 이 2초인데 launchd 에서는 안 끝난다.
 *
 *   launchd 컨텍스트 실측(임시 launchd 잡으로 단계별 계측):
 *       resource-pressure  0초
 *       backup-health      10분+ 미완료   ← 여기
 *   원인: backupStatus() 가 Google Drive 경로에 readdirSync 를 *상한 없이* 건다.
 *   launchd 에서 Drive 의 서버 왕복 연산(readdir)이 완료되지 않는다는 걸 어제 직접 측정해
 *   backup-takeover.mjs 에는 상한을 넣었으면서, 정작 *판독기* 에는 안 넣었다.
 *   한 곳만 고치고 나머지를 안 본 — 오늘 반복해 만난 그 패턴이다.
 *
 *   감시를 추가하다 감시를 죽였다. 로컬 백업 판독은 일반 FS 라 안전하므로,
 *   원격이 안 되면 '모른다' 로 답하고 로컬 판정은 계속해야 한다.
 *
 * 2차(같은 날, 이 테스트의 첫 판이 놓친 것): Promise.race 로 상한을 걸자 함수는 5초에
 *   돌아왔는데 launchd 에서 node 프로세스가 3분 넘게 종료되지 않았다. fs 스레드풀 요청은
 *   취소가 안 돼서 미결 핸들이 이벤트 루프를 붙잡는다 — 호출자에겐 여전히 hang 이다.
 *   그래서 '함수가 돌아왔나' 가 아니라 **'프로세스가 종료되나'** 를 검사한다.
 *   상한을 함수 안이 아니라 프로세스 경계(execFile+kill)에 두어야 실제로 취소된다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(resolve(ROOT, 'scripts/lib/backup-health.mjs'), 'utf8');

// 원격(DEST) 경로에 동기 fs 호출이 남아 있으면 안 된다
const remoteSync = [...src.matchAll(/(readdirSync|statSync|existsSync)\(\s*(dest|join\(dest)/g)].map((m) => m[1]);
remoteSync.length
  ? bad(`원격 경로에 동기 fs 호출 ${remoteSync.length}건(${[...new Set(remoteSync)].join(',')}) — launchd 에서 멈춘다`)
  : ok('원격 경로에 상한 없는 동기 fs 호출 없음');

/execFile\(/.test(src) && /REMOTE_TIMEOUT/.test(src)
  ? ok('원격 판독이 죽일 수 있는 자식 프로세스 경계 뒤에 있다')
  : bad('원격 판독이 이 프로세스 안에서 일어난다 — 취소가 불가능해 상한이 무의미하다');
/fs\/promises|fsp\./.test(src)
  ? bad('취소 불가능한 fs 비동기 호출이 남아 있다 — 함수는 돌아와도 프로세스가 안 죽는다')
  : ok('원격 경로에 취소 불가능한 fs 호출 없음');

// 원격이 안 되어도 로컬 판정은 나와야 한다
/remoteUnknown|remoteReadable/.test(src)
  ? ok("원격 미확인 상태를 '모른다' 로 구분해 보고한다")
  : bad('원격 실패를 로컬 결과와 구분하지 않는다 — 원격이 막히면 전체가 무의미해진다');

// 실제 동작: 판독이 빨라야 한다
const t0 = Date.now();
const M = await import('./backup-health.mjs');
const s = await M.backupStatus();
const ms = Date.now() - t0;
ms < 15000 ? ok(`backupStatus() ${ms}ms (상한 내)`) : bad(`backupStatus() ${ms}ms — 너무 느리다`);
s.localNewest ? ok(`로컬 판정 유지: ${s.localNewest}`) : bad('로컬 판정이 안 나온다');

// 핵심: 함수 반환이 아니라 **프로세스 종료**를 본다. 1차 수정이 여기서 걸렸어야 했다.
{
  const { spawn } = await import('child_process');
  const t1 = Date.now();
  const child = spawn(process.execPath,
    ['-e', 'import("./scripts/lib/backup-health.mjs").then(m=>m.backupStatus()).then(s=>console.log(s.localNewest))'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FLOWVIUM_BACKUP_DIR: process.env.FLOWVIUM_BACKUP_DIR } });
  const code = await new Promise((res) => {
    const kill = setTimeout(() => { child.kill('SIGKILL'); res('HANG'); }, 30000);
    child.on('exit', (c) => { clearTimeout(kill); res(c); });
  });
  const el = Date.now() - t1;
  code === 'HANG'
    ? bad(`backupStatus() 후 프로세스가 30초 안에 종료되지 않는다 — 미결 fs 핸들이 루프를 잡고 있다`)
    : ok(`backupStatus() 후 프로세스가 ${el}ms 에 정상 종료(exit ${code})`);
}

// 등급: 원격 미확인 + 로컬 안전 → 🚨 가 아니라 정보. 20분마다 우는 늑대소년을 막는다.
{
  const cs = readFileSync(resolve(ROOT, 'scripts/check-stall.mjs'), 'utf8');
  /remoteUnknown/.test(cs) && /localSafe|remoteOnly/.test(cs)
    ? ok('원격 미확인은 로컬이 복원 가능하면 결함으로 세지 않는다')
    : bad('원격 미확인을 결함으로 센다 — 20분마다 🚨 가 울려 진짜 결함이 묻힌다');
}

console.log(fail === 0 ? '\n✅ backup-health-timeout 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
