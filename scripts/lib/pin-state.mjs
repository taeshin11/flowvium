/**
 * pin-state.mjs — 고정 댓글 원장(logs/yt-pinned.json)의 한 편을 다시 달아야 하는가. (2026-10-19)
 *
 * 종전: 'state 에 있으면 끝난 편'. 그런데 10분 뒤 재확인도 같은 칸에 {verifiedAt, visibleToViewers:false} 를 적는다 —
 *   달기가 실패한 편(AvHbcWuXvJQ, 10/16 시간초과)이 재확인 기록 때문에 '끝난 편' 이 되어 다시는 안 골렸다.
 * 규칙: 달기·고정에 성공(또는 이미 있음 확인)하면 at 이 생긴다. at 이 없거나, 시청자 화면에서 안 보였으면 다시 단다.
 *   같은 편이 MAX_PIN_TRIES 번 실패하면 멈춘다 — 매일 같은 실패를 되풀이하지 않고 사람에게 남긴다.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

export const MAX_PIN_TRIES = 3;
export function needsPin(e) {
  if ((e?.failedTries ?? 0) >= MAX_PIN_TRIES) return false;
  if (!e?.at) return true;
  return e.visibleToViewers === false || e.pinnedToViewers === false;
}

/**
 * 원장의 한 편만 고쳐 쓴다 — 쓰기 **직전에 파일을 다시 읽어** 합치고, 임시 파일 → rename 으로 바꾼다.
 *   2026-10-19: 매일 쓸기와 손 실행이 겹쳐 각자 처음 읽은 원장 전체를 덮어썼다(서로의 기록을 지움).
 * @param {(prev: object|undefined) => object} fn  그 편의 지금 기록 → 새 기록
 */
export function writeEntry(file, id, fn) {
  let all = {};
  try { all = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }   // 깨진 원장은 덮지 않는다
  all[id] = fn(all[id]);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 1));
  renameSync(tmp, file);
  return all[id];
}
