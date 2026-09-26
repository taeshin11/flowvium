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
import { join } from 'path';

export const SPARE_FILES = { video: 'shorts-ko.mp4', thumb: 'shorts-ko-thumb.jpg', meta: 'shorts-ko-meta.json', credits: 'shorts-ko-credits.txt' };

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
    else if (f === SPARE_FILES.credits && existsSync(to(f))) rmSync(to(f));   // 지난 회차 크레딧이 섞이지 않게
  }
  rmSync(spare.dir, { recursive: true, force: true });
  return { keyword: spare.meta.keyword, from: spare.dir };
}
