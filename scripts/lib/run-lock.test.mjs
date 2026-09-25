#!/usr/bin/env node
/**
 * run-lock.test.mjs — 쇼츠 렌더는 한 번에 하나. 2026-09-25 신설.
 *
 * 실측(video.log): 9/24 11:10 정규 회차가 렌더하는 동안 11:15:04 백필이 또 렌더를 시작했다.
 *   둘은 같은 작업 폴더($TMPDIR/flowvium-shorts — 시작 때 rmSync)와 같은 산출물(shorts-ko.mp4)을 쓴다.
 *   정규 회차가 1초 뒤(11:15:05) 끝나서 넘어갔을 뿐, 몇 초만 달랐으면 서로를 지웠다.
 *   (테크이슈 세션 공지 6항 — 같은 맥 두 파이프라인 충돌 — 을 보고 우리 쪽을 재 보다 찾았다.)
 */
import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { acquireRunLock } from './run-lock.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const dir = mkdtempSync(join(tmpdir(), 'run-lock-test-'));
const lockf = join(dir, 'video.lock');

// [1] 빈 자리면 잡는다 — 내 pid 가 적힌다, 풀면 파일이 없어진다
{
  const l = await acquireRunLock(lockf, { waitMs: 0, label: 'test' });
  (l.ok && JSON.parse(readFileSync(lockf, 'utf8')).pid === process.pid) ? ok('[1] 빈 자리 → 잡는다') : bad(`[1] ${JSON.stringify(l)}`);
  l.release(); !existsSync(lockf) ? ok('[1b] 풀면 지운다') : bad('[1b] 락 파일이 남았다');
}
// [2] 살아 있는 다른 프로세스가 쥐고 있으면: 기다리지 않는 쪽(백필)은 바로 물러난다
const holder = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)']);
writeFileSync(lockf, JSON.stringify({ pid: holder.pid, label: 'regular', at: new Date().toISOString() }));
{
  const t0 = Date.now();
  const l = await acquireRunLock(lockf, { waitMs: 0, label: 'backfill' });
  (!l.ok && l.holder?.label === 'regular' && Date.now() - t0 < 1000) ? ok('[2] 쥔 사람 있음 → 백필은 바로 물러난다(누가 쥐었는지 안다)') : bad(`[2] ${JSON.stringify(l)}`);
}
// [3] 기다리는 쪽(정규)은 풀릴 때까지 기다렸다 잡는다
{
  setTimeout(() => holder.kill(), 600);
  const t0 = Date.now();
  const l = await acquireRunLock(lockf, { waitMs: 5000, pollMs: 100, label: 'regular2' });
  (l.ok && Date.now() - t0 >= 500) ? ok(`[3] 기다렸다 잡는다(${Date.now() - t0}ms)`) : bad(`[3] ${JSON.stringify(l)} ${Date.now() - t0}ms`);
  l.release?.();
}
// [4] 죽은 프로세스의 락은 넘겨받는다(남은 락이 영원히 막지 않게)
{
  writeFileSync(lockf, JSON.stringify({ pid: 999999, label: 'dead', at: new Date().toISOString() }));
  const l = await acquireRunLock(lockf, { waitMs: 0, label: 'test' });
  l.ok ? ok('[4] 죽은 pid 의 락 → 넘겨받는다') : bad(`[4] ${JSON.stringify(l)}`);
  l.release?.();
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
