/**
 * run-lock.mjs — 한 번에 하나만 돌아야 하는 작업의 락(pid 파일). 2026-09-25 신설.
 *
 * 왜: 쇼츠 정규 회차(video-publish)와 백필(video-backfill → video-publish)이 같은 작업 폴더
 *   ($TMPDIR/flowvium-shorts — make-shorts 가 시작 때 rmSync)와 같은 산출물(shorts-ko.mp4)을 쓴다.
 *   9/24 11:10 정규 렌더 중에 11:15:04 백필이 또 렌더를 시작했다(video.log) — 정규가 1초 뒤 끝나 넘어갔을 뿐이다.
 * 파일은 'wx'(없을 때만 만들기)로 원자적으로 잡는다. 주인이 죽었으면(pid 없음) 넘겨받는다.
 */
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} file 락 파일 경로
 * @param {{waitMs?:number, pollMs?:number, label?:string}} o  waitMs=0 이면 쥔 사람이 있을 때 바로 물러난다
 * @returns {Promise<{ok:true, release:()=>void} | {ok:false, holder:any}>}
 */
export async function acquireRunLock(file, { waitMs = 0, pollMs = 5000, label = '' } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, label, at: new Date().toISOString() }));
      closeSync(fd);
      let released = false;
      const release = () => {
        if (released) return; released = true;
        try { if (JSON.parse(readFileSync(file, 'utf8')).pid === process.pid) unlinkSync(file); } catch { /* 이미 없음 */ }
      };
      process.once('exit', release);
      return { ok: true, release };
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
    }
    let holder = null;
    try { holder = JSON.parse(readFileSync(file, 'utf8')); } catch { /* 쓰는 중이거나 깨짐 — 아래에서 다시 */ }
    if (holder && !alive(Number(holder.pid))) {
      try { unlinkSync(file); } catch { /* 누가 먼저 지웠다 */ }
      continue;   // 죽은 주인의 락 — 넘겨받는다
    }
    if (Date.now() >= deadline) return { ok: false, holder };
    await sleep(Math.min(pollMs, Math.max(50, deadline - Date.now())));
  }
}
