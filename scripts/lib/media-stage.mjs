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
    // 2026-09-30: 드라이브의 기존 파일이 온라인 전용(dataless) 자리표시면 그 위에 cp 가 실패했다(9/29 7회 모두 meta.json).
    //   임시 이름으로 쓰고 rename 으로 바꿔 끼운다 — rename 은 옛 파일을 열지 않는다.
    const tmp = join(to, `.${f}.tmp-${process.pid}`);
    let r = spawnSync('cp', [src, tmp], { timeout: timeoutMs, killSignal: 'SIGKILL', encoding: 'utf8' });
    if (!r.error && r.status === 0) r = spawnSync('mv', ['-f', tmp, join(to, f)], { timeout: timeoutMs, killSignal: 'SIGKILL', encoding: 'utf8' });
    if (r.error || r.status !== 0) spawnSync('rm', ['-f', tmp], { timeout: 10_000 });
    if (r.error || r.status !== 0) {
      const why = r.error?.code === 'ETIMEDOUT' || r.signal ? `${timeoutMs / 1000}초 안에 못 끝냄` : String(r.stderr || r.error?.message || `exit ${r.status}`).trim().slice(0, 100);
      return { ok: false, copied, reason: `${f}: ${why}` };
    }
    copied.push(f);
  }
  return { ok: true, copied };
}
