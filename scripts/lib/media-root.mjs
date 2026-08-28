/**
 * media-root.mjs — 영상·사진 등 **미디어 산출물이 놓일 곳** 한 군데.
 *
 * 요구(2026-08-28): "영상 제작과 관련된 자료들과 영상 자료들, 사진 자료들은 전부
 *   구글드라이브로 이전해서 거기에만 저장해라. 컴퓨터 용량 부족하다."
 *
 * 그래서 경로를 코드에 박지 않고 **한 곳에서 정한다**. 개인 계정 경로가 저장소에 남으면
 *   다른 사람 기계에서 그대로 깨지고, 나중에 옮길 때 grep 으로 쫓아다녀야 한다.
 *
 * 정하는 순서:
 *   1) MEDIA_ROOT (환경변수 또는 .env.local) — 사람이 정한 값이 항상 이긴다
 *   2) 마운트된 구글드라이브의 FlowVium-media
 *   3) 프로젝트 안 (로컬 폴백) — **명시적으로 허용했을 때만**
 *
 * 드라이브가 죽어 있는데 조용히 로컬로 떨어지면 "옮겼다" 고 착각한 채 디스크가 다시 찬다.
 *   그래서 폴백은 기본이 아니라 선택이고, 실패는 **무엇을 하라는지**까지 말한다.
 */
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const MEDIA_DIRNAME = 'FlowVium-media';

/** 마운트된 구글드라이브 계정 폴더들. 없으면 빈 배열. */
export function driveAccounts(home = homedir(), ls = readdirSync) {
  const base = join(home, 'Library', 'CloudStorage');
  try { return ls(base).filter((d) => /^GoogleDrive-/.test(d)).map((d) => join(base, d)); }
  catch { return []; }
}

/**
 * 이 경로에 정말로 쓸 수 있는가. existsSync 만으로는 모자란다 —
 * 드라이브가 죽으면 경로는 남아 있는데 읽기부터 EINTR 로 튕긴다(실측 2026-08-28).
 * 그래서 **실제로 파일을 하나 써 본다.**
 */
export function probeWritable(dir, io = {}) {
  const { mkdir = mkdirSync, write = writeFileSync, rm = unlinkSync } = io;
  const probe = join(dir, `.probe-${process.pid}`);
  try {
    mkdir(dir, { recursive: true });
    write(probe, 'ok');
    rm(probe);
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: `${e.code ?? ''} ${e.message}`.trim() };
  }
}

/**
 * 미디어 루트를 정한다. 못 정하면 던진다 — 조용히 로컬로 떨어지지 않는다.
 * @param {object} opts
 * @param {string|null} opts.configured  MEDIA_ROOT 설정값
 * @param {string} opts.localFallback    허용됐을 때 쓸 로컬 경로
 * @param {boolean} opts.allowLocal      로컬 폴백 허용 여부
 */
export function resolveMediaRoot(opts = {}) {
  const {
    configured = null, localFallback = null, allowLocal = false,
    accounts = driveAccounts(), probe = probeWritable,
  } = opts;

  const tried = [];
  const attempt = (dir, label) => {
    if (!dir) return null;
    const r = probe(dir);
    tried.push(`${label}: ${dir}${r.ok ? '' : ` — ${r.reason}`}`);
    return r.ok ? dir : null;
  };

  const fromConfig = attempt(configured, '설정(MEDIA_ROOT)');
  if (fromConfig) return { root: fromConfig, where: 'configured', tried };

  for (const acc of accounts) {
    // 구글드라이브 한국어 UI 는 "내 드라이브", 영어는 "My Drive" 다.
    for (const my of ['내 드라이브', 'My Drive']) {
      const dir = join(acc, my, MEDIA_DIRNAME);
      const got = attempt(dir, '구글드라이브');
      if (got) return { root: got, where: 'drive', tried };
    }
  }

  if (allowLocal) {
    const got = attempt(localFallback, '로컬 폴백');
    if (got) return { root: got, where: 'local', tried };
  }

  throw new Error(
    '미디어를 저장할 곳이 없다.\n  시도한 경로:\n    ' + (tried.join('\n    ') || '(없음)')
    + '\n  구글드라이브가 마운트돼 있어야 한다 — Google Drive 앱을 실행/재시작하고,'
    + `\n    "내 드라이브/${MEDIA_DIRNAME}" 가 열리는지 확인할 것.`
    + '\n  다른 곳에 두려면 .env.local 에 MEDIA_ROOT=<경로> 를 넣거나, --local-media 로 로컬을 허용할 것.',
  );
}

/** 이 경로가 실제로 존재하는가(디렉터리 생성 포함). */
export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
