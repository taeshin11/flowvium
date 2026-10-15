/**
 * runner-reload.mjs — cron-runner 가 자기 코드가 바뀌었는지 알고, 안전할 때만 내려가게. 근거·규칙은 runner-reload.test.mjs 머리말.
 */
import { createHash } from 'crypto';

/** 소스에서 정적 `from './lib/…'` import 경로. */
export function localImports(src) {
  return [...String(src).matchAll(/^import[^;]*?from\s+['"](\.\/lib\/[^'"]+)['"]/gm)].map((m) => m[1]);
}

/** 파일들의 내용 해시. 하나라도 못 읽으면 null. */
export function codeHash(paths, read) {
  const h = createHash('sha1');
  try { for (const p of paths) h.update(p).update('\0').update(read(p)).update('\0'); } catch { return null; }
  return h.digest('hex');
}

export function shouldReload({ boot, now, children }) {
  return Boolean(boot && now && boot !== now && children === 0);
}
