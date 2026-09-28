/**
 * media-stage.mjs — 올린 쇼츠를 드라이브(MEDIA_ROOT)에 보관한다. 자식 프로세스 + 시간 한도. (2026-09-28)
 *   왜 로컬에서 만들고 로컬에서 올리는지는 media-stage.test.mjs 머리말(9/28 21:45 EDEADLK).
 *   보관은 발행이 끝난 뒤의 일이라 실패해도 발행은 성공이다 — 사유만 돌려준다.
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export function archiveToMedia({ from, to, files, timeoutMs = 60_000 }) {
  const copied = [];
  for (const f of files) {
    const src = join(from, f);
    if (!existsSync(src)) continue;
    const r = spawnSync('cp', [src, join(to, f)], { timeout: timeoutMs, killSignal: 'SIGKILL', encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      const why = r.error?.code === 'ETIMEDOUT' || r.signal ? `${timeoutMs / 1000}초 안에 못 끝냄` : String(r.stderr || r.error?.message || `exit ${r.status}`).trim().slice(0, 100);
      return { ok: false, copied, reason: `${f}: ${why}` };
    }
    copied.push(f);
  }
  return { ok: true, copied };
}
