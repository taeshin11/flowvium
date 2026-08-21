#!/usr/bin/env node
/**
 * threadpool-starvation.test.mjs — 느린 원격 FS 연산은 프로세스 안에 들이지 않는다.
 *
 * 배경(2026-08-22 실측). 예약 백업 잡이 5시간째 살아 있었다.
 *   로그는 00:57 에 `총 소요 60.4s / ✅ 인수인계 백업 완료` 를 찍고 *할 일을 다 끝냈는데*
 *   프로세스가 안 죽었다. `sample` 로 스레드를 떠 보니:
 *     libuv-worker ×4 — 전부 open()/unlink() 커널 대기 (Google Drive 경로)
 *     총 11 스레드 중 uv__fs_work 대기 4 = **기본 스레드풀 전부**
 *
 *   backup-takeover.mjs 는 마지막이 이렇다:
 *     await fsp.unlink(localDb)   // 219행 — 로컬 임시본 정리
 *     process.exit(0);            // 220행 — 명시 종료
 *   상한을 넘겨 *버린* Drive 연산이 스레드풀 4칸을 영구 점유하니,
 *   219행의 **로컬** unlink 조차 스케줄될 슬롯이 없어 220행에 영영 도달하지 못한다.
 *
 *   나는 77행 주석에 "race 는 밑에서 도는 연산을 취소하지 못한다 — 스레드풀에 남는다.
 *   그래서 마지막에 process.exit 로 명시 종료한다" 라고 이미 적어 뒀었다. 절반만 이해했다.
 *   그 exit 바로 앞줄이 또 스레드풀을 필요로 한다는 걸 못 봤다.
 *
 *   교훈: 타임아웃은 '기다리기를 그만두는' 것이지 '작업을 취소하는' 게 아니다.
 *   취소 가능한 유일한 경계는 프로세스 경계다(execFile timeout → SIGKILL).
 *
 * 이 테스트는 그 기전을 FIFO(명명 파이프)로 로컬에서 결정적으로 재현한다 —
 *   읽기용 open 은 쓰는 쪽이 붙을 때까지 커널에서 막히므로 Drive 와 같은 상태가 된다.
 */
import { execFileSync, spawn } from 'child_process';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// ── 1. 기전 재현: 스레드풀이 막히면 *로컬* fs 도 멈추고 프로세스가 안 죽는다.
const dir = mkdtempSync(join(tmpdir(), 'tp-starve-'));
try {
  const fifos = [0, 1, 2, 3].map((i) => join(dir, `f${i}`));
  for (const f of fifos) execFileSync('/usr/bin/mkfifo', [f]);

  const probe = (code) => new Promise((res) => {
    const c = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    const t = setTimeout(() => { c.kill('SIGKILL'); res({ exit: 'HANG', out }); }, 8000);
    c.on('exit', (x) => { clearTimeout(t); res({ exit: x, out }); });
  });

  const list = JSON.stringify(fifos);
  // 스레드풀 4칸을 FIFO open 으로 점유한 뒤 로컬 stat 을 건다 — 지금 코드의 상황 그대로.
  const starved = await probe(`
    const fsp = require('fs/promises');
    for (const f of ${list}) fsp.open(f, 'r').catch(()=>{});           // 취소 불가, 스레드풀 점유
    setTimeout(async () => {
      await fsp.stat(process.execPath).catch(()=>{});                  // 로컬인데도 못 돈다
      console.log('LOCAL_FS_OK'); process.exit(0);
    }, 300);
  `);
  starved.exit === 'HANG' && !/LOCAL_FS_OK/.test(starved.out)
    ? ok('기전 재현: 스레드풀 점유 시 로컬 fs 마저 멈추고 프로세스가 안 죽는다')
    : bad(`기전 재현 실패(exit=${starved.exit}, out=${starved.out.trim()}) — 이 테스트의 전제가 틀렸다`);

  // 같은 상황에서 자식 프로세스 경계는 살아 있다 — 그래서 원격을 그쪽으로 옮긴다.
  // 자식 경계는 살아 있고, 탈출은 *자기 SIGKILL* 로만 된다.
  //   실측: 같은 상태에서 process.exit(0) 은 6초+ 미종료(외부 SIGKILL 필요),
  //   process.kill(self,'SIGKILL') 은 0.46초. libuv 가 종료 시 워커를 join 하기 때문이다.
  const viaChild = await probe(`
    const fsp = require('fs/promises');
    const { execFile } = require('child_process');
    for (const f of ${list}) fsp.open(f, 'r').catch(()=>{});
    setTimeout(() => {
      execFile('/bin/echo', ['CHILD_OK'], (e, o) => {
        process.stdout.write(String(o));
        process.kill(process.pid, 'SIGKILL');
      });
    }, 300);
  `);
  /CHILD_OK/.test(viaChild.out) && viaChild.exit !== 'HANG'
    ? ok('자식 프로세스 경계는 스레드풀 기아에도 살아 있다')
    : bad(`자식 프로세스 경계도 막힌다(exit=${viaChild.exit}, out=${viaChild.out.trim()})`);

  const viaExit = await probe(`
    const fsp = require('fs/promises');
    for (const f of ${list}) fsp.open(f, 'r').catch(()=>{});
    setTimeout(() => { console.log('EXIT_TRY'); process.exit(0); }, 300);
  `);
  viaExit.exit === 'HANG'
    ? ok('process.exit(0) 은 스레드풀 기아를 탈출하지 못한다 — 완화책으로 쓸 수 없음이 확인됨')
    : bad(`process.exit(0) 이 탈출했다(exit=${viaExit.exit}) — 이 노드 버전에서는 전제가 다르다, 재확인 필요`);
} finally { rmSync(dir, { recursive: true, force: true }); }

// ── 2. 실제 코드가 그 규율을 지키는가
const src = readFileSync(resolve(ROOT, 'scripts/backup-takeover.mjs'), 'utf8');

/remoteExec|execFile/.test(src)
  ? ok('원격 연산이 죽일 수 있는 자식 프로세스 경계 뒤에 있다')
  : bad('원격 연산이 이 프로세스의 스레드풀에서 돈다 — 상한을 걸어도 취소가 안 된다');

// 종료 직전 정리는 스레드풀을 타면 안 된다(그 슬롯이 이미 없을 수 있다).
// 주석 줄은 제외한다 — 이 파일의 수정 이력 주석에 `await fsp.unlink(localDb)` 가 인용돼 있어
//   그대로 세면 자기 설명글을 결함으로 잡는다(첫 판이 실제로 그랬다).
const tailIdx = src.lastIndexOf('process.exit(0)');
const tail = src.slice(Math.max(0, tailIdx - 600), tailIdx)
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
/await\s+fsp\./.test(tail)
  ? bad('process.exit 직전에 await fsp.* 가 있다 — 스레드풀이 막히면 exit 에 도달 못 한다')
  : ok('process.exit 직전 정리가 스레드풀에 의존하지 않는다');

// DEST(원격)를 fs/promises 로 직접 건드리는 곳이 없어야 한다
const remoteFsp = [...src.matchAll(/await\s+fsp\.(\w+)\(\s*(?:join\()?\s*DEST/g)].map((m) => m[1]);
remoteFsp.length
  ? bad(`원격 경로에 fsp.${remoteFsp.join(',')} 직접 호출 ${remoteFsp.length}건`)
  : ok('원격 경로에 fs/promises 직접 호출 없음');

// 감시자가 스스로 좀비를 남기면 안 된다 — reaper.kill() 은 sh 만 죽이고 sleep 은 고아가 된다.
/process\.kill\(-reaper\.pid/.test(src)
  ? ok('감시자를 프로세스 그룹째 해제한다 — 고아 sleep 을 남기지 않는다')
  : bad('감시자를 sh 만 죽인다 — 자식 sleep 이 PPID 1 고아로 남아 매 주기 쌓인다');

// 백업의 첫 번째 규칙: 있는 백업을 없애지 않는다.
//   rm 먼저 → cp 가 상한에 걸려 죽으면 원격에 아무것도 안 남는다. 그게 실제로 일어났다.
/rm -f -- "\$3"; cp -- "\$2" "\$3" && mv -f/.test(src) && /REMOTE_TMP/.test(src)
  ? ok('원격 교체가 임시 이름에 쓰고 mv 로 갈아끼운다 — 실패해도 옛 백업이 남는다')
  : bad('원격 교체가 대상을 먼저 지운다 — 쓰기가 실패하면 백업이 사라진다');

console.log(fail === 0 ? '\n✅ threadpool-starvation 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
