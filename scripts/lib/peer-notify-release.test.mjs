#!/usr/bin/env node
/**
 * peer-notify-release.test.mjs — 회차가 죽어도 부하 키가 지워지는가.
 *
 * 배경(2026-09-12): 옆 세션이 물었다 — "멈춰서 키가 안 지워지는 경우가 있습니까?"
 *   있었다. run-report.sh 의 `report-end` 알림이 **정상 종료 경로에만** 있었다.
 *   trap 에는 락 해제만 걸려 있었다. 그래서 회차가 죽거나 OOM 으로 끊기면
 *   — 하필 옆 세션이 두 번 강제 종료되던 바로 그 상황이다 —
 *   키가 영원히 남고 상대가 2시간(3분×60회)을 기다린다.
 *
 * 손으로 "고쳤다" 고 하지 않고 **실제로 죽여 보고** 키가 사라지는지 본다.
 */
import { mkdtempSync, readFileSync, existsSync, writeFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { ROOT } from './project-root.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const dir = mkdtempSync(join(tmpdir(), 'peer-notify-'));
const now = join(dir, 'machine-load-now.json');
const NODE = process.execPath;

// run-report.sh 와 같은 모양의 최소 스크립트 — trap 안에서 해제한다.
const script = join(dir, 'fake-report.sh');
writeFileSync(script, `#!/bin/bash
set -u
NODE_BIN="${NODE}"
APP_DIR="${ROOT}"
cleanup() {
  if [ -n "\${PEER_NOTIFIED:-}" ]; then
    "$NODE_BIN" "$APP_DIR/scripts/notify-peer.mjs" --event report-end >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM
"$NODE_BIN" "$APP_DIR/scripts/notify-peer.mjs" --event report-start --detail "시험" >/dev/null 2>&1
PEER_NOTIFIED=1
sleep 60
`);
chmodSync(script, 0o755);

const env = { ...process.env, FLOWVIUM_RUNTIME_DIR: dir };
const child = spawn('bash', [script], { env, stdio: 'ignore' });

const read = () => { try { return JSON.parse(readFileSync(now, 'utf8')); } catch { return null; } };
const waitFor = (fn, ms = 5000) => new Promise((res, rej) => {
  const t0 = Date.now();
  const tick = () => fn() ? res(true) : (Date.now() - t0 > ms ? rej(new Error('시간 초과')) : setTimeout(tick, 50));
  tick();
});

const { currentLoad } = await import('./peer-load.mjs');

try {
  await waitFor(() => read()?.report != null);
  ok('회차 시작 → report 키가 생긴다');

  read().report.pid > 0
    ? ok(`키에 임자 PID 가 적힌다 (${read().report.pid})`)
    : bad('키에 PID 가 없다 — 죽은 키를 알아볼 방법이 없다');

  // 살아 있는 동안은 '지금 도는 작업' 으로 보여야 한다
  {
    const { live, stale } = currentLoad({ file: now });
    live.length === 1 && stale.length === 0
      ? ok('도는 동안 live 로 읽힌다')
      : bad(`live ${live.length} / stale ${stale.length} — 산 작업을 죽었다고 읽으면 같이 돌다 터진다`);
  }

  // **SIGKILL** — trap 이 절대 못 도는 신호다. macOS 가 메모리 부족으로 끊을 때 쓰는 그것.
  child.kill('SIGKILL');
  await waitFor(() => { try { process.kill(child.pid, 0); return false; } catch { return true; } }, 5000);

  const { live, stale } = currentLoad({ file: now });
  stale.length === 1 && live.length === 0
    ? ok('SIGKILL 로 죽여 키가 남아도 stale 로 읽힌다 (상대가 헛기다리지 않는다)')
    : bad(`죽었는데 live ${live.length} / stale ${stale.length} — 상대가 있지도 않은 작업을 기다린다`);
} catch (e) {
  bad(`판정 불가 (${e.message}) — 상태: ${JSON.stringify(read())}`);
  try { child.kill('SIGKILL'); } catch { /* 이미 죽음 */ }
}

// 진짜 공유 파일은 건드리지 않았는가 — 시험이 옆 세션을 속이면 안 된다.
existsSync(now) && !readFileSync(now, 'utf8').includes('midnight')
  ? ok('시험은 자기 폴더에서만 썼다 (실제 공유 파일 무사)')
  : bad('시험이 실제 공유 파일을 건드렸을 수 있다');

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
