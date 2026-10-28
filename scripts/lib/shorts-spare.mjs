/**
 * shorts-spare.mjs — 예비 쇼츠. 미리 만들어 두고, 정규 렌더가 실패·지연되면 예비를 올린다. (2026-09-26 신설)
 *
 * 사장님: "시간이 지나서 못올린다는게 말이됨? 예비를 계속 뽑아놔야지"
 * 실측: 9/26 21:45 회차가 Dropbox 락 파일 open 에서 1시간 44분 멈춰 통째로 안 나갔다(그 결함은 flow-omni 에서 고쳤다).
 *   어떤 이유로든 렌더가 막히면 그 시각은 비어 버린다 — 예비가 있으면 그 자리를 메운다.
 * 규칙: 6시간 안에 만든 것만(뉴스는 늦으면 가치가 없다) · 그 이슈가 이미 나갔으면 못 쓴다 · 쓴 예비는 지운다.
 * 예비 폴더: <MEDIA_ROOT>/spares/<시각>/ — 안의 파일 이름은 정규 산출물과 같다(SPARE_FILES).
 */
import { existsSync, readdirSync, readFileSync, copyFileSync, rmSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import { tmpdir } from 'os';

/**
 * 예비 폴더. 2026-09-28: 드라이브(MEDIA_ROOT/spares) → **로컬 임시폴더**. 드라이브 파일은 온라인 전용으로 내려가거나
 *   동기화 중 잠겨 읽기·복사가 실패하거나(9/28 21:45 EDEADLK) 멈춘다 — 예비는 그럴 때 쓰는 것이라 같은 곳에 두면 안 된다.
 *   예비는 6시간짜리 중간물이다(미디어 보관 규칙: 중간물은 임시폴더).
 */
export function spareDir(env = process.env) {
  return env.SHORTS_SPARE_DIR || join(tmpdir(), 'flowvium-spares');
}

// thumbBg(10/28): 썸네일 관문이 같은 사진에 고친 글로 다시 굽는 배경(lib/shorts-thumb).
export const SPARE_FILES = { video: 'shorts-ko.mp4', thumb: 'shorts-ko-thumb.jpg', meta: 'shorts-ko-meta.json', credits: 'shorts-ko-credits.txt', thumbBg: 'shorts-ko-thumb-bg.jpg' };

/** 영상·메타가 다 있는 예비들(새것 먼저). */
export function listSpares(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const d = join(dir, name);
    try {
      if (!statSync(d).isDirectory()) continue;
      if (!existsSync(join(d, SPARE_FILES.video)) || !existsSync(join(d, SPARE_FILES.meta))) continue;
      const meta = JSON.parse(readFileSync(join(d, SPARE_FILES.meta), 'utf8'));
      out.push({ dir: d, meta, createdAt: Date.parse(meta.createdAt ?? '') || statSync(d).mtimeMs });
    } catch { /* 깨진 예비는 건너뛴다 */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** 쓸 수 있는 예비 하나(가장 새것) 또는 null. */
export function pickSpare({ dir, maxAgeH = 6, isPublished = () => false, now = Date.now() }) {
  return listSpares(dir).find((s) => now - s.createdAt <= maxAgeH * 3600e3 && !isPublished(s.meta.keyword)) ?? null;
}

/**
 * 상시 쇼츠 풀(2026-10-28 Mac mini2, 사장님 위임 — "테크이슈와 같은 규칙, 36시간치").
 *   날짜·가격 없는 주식 상식(scripts/video/make-evergreen-short.mjs)이라 기한이 없다. 뉴스 예비가 없을 때만 쓴다.
 *   자리는 저장소 reports/video(로컬·깃 밖) — 임시폴더는 며칠 안 쓰면 macOS 가 비우고, 드라이브는 멈춘다(위 spareDir).
 */
export function evergreenDir(env = process.env) {
  return env.SHORTS_EVERGREEN_DIR || resolve(new URL('../..', import.meta.url).pathname, 'reports/video/evergreen-pool');
}

/** 파일 내용 지문(sha1) — 표지 점검 뒤 썸네일이 바뀌었는지 본다. */
export function fileSha(f) { return createHash('sha1').update(readFileSync(f)).digest('hex'); }

/** 표지가 썸네일 관문(lib/thumb-gate)을 통과했고 그 뒤 썸네일이 안 바뀌었는가 — 메타 cover {passed, sha}.
 *  10/28 저녁 사장님(Mac mini2 경유): 점수를 못 받은 썸네일은 안 올린다. 밤(ChatGPT 대기열 쉼)에는 미리 통과한 편만 나갈 수 있다. */
export function coverPassed(spare) {
  const c = spare?.meta?.cover;
  if (!c?.passed || !c.sha) return false;
  try { return fileSha(join(spare.dir, SPARE_FILES.thumb)) === c.sha; } catch { return false; }
}

/** 풀에서 하나 — 이미 나간 주제 빼고, 먼저 만든 것부터. 만드는 중(<id>.part)은 집지 않는다. ok 로 더 거른다(표지 통과 등). */
export function pickEvergreen({ dir, isPublished = () => false, ok = () => true }) {
  return listSpares(dir).filter((s) => !s.dir.endsWith('.part') && !isPublished(s.meta.keyword) && ok(s))
    .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
}

/** 오래됐거나 이미 나간 예비를 지운다. 지운 개수. */
export function pruneSpares({ dir, maxAgeH = 6, isPublished = () => false, now = Date.now() }) {
  let n = 0;
  for (const s of listSpares(dir)) {
    if (now - s.createdAt > maxAgeH * 3600e3 || isPublished(s.meta.keyword)) { rmSync(s.dir, { recursive: true, force: true }); n++; }
  }
  return n;
}

/** 예비를 정규 산출물 자리(<mediaRoot>/shorts-<locale>.*)로 옮기고 예비 폴더를 지운다. */
export function promoteSpare(spare, mediaRoot, locale = 'ko') {
  if (!spare) return null;
  const to = (f) => join(mediaRoot, f.replace('shorts-ko', `shorts-${locale}`));
  for (const f of Object.values(SPARE_FILES)) {
    const src = join(spare.dir, f);
    if (existsSync(src)) copyFileSync(src, to(f));
    else if ((f === SPARE_FILES.credits || f === SPARE_FILES.thumbBg) && existsSync(to(f))) rmSync(to(f));   // 지난 회차 크레딧·배경이 섞이지 않게
  }
  rmSync(spare.dir, { recursive: true, force: true });
  return { keyword: spare.meta.keyword, from: spare.dir };
}
