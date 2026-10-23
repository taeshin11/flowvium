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
  return e.visibleToViewers === false || e.pinnedToViewers === false || (e.viewerMissing?.length ?? 0) > 0;
}

/**
 * '이미 고정돼 있다'(주인 화면) 기록. 앞 기록(실패 수·재확인)을 지우지 않는다.
 *   2026-10-20: 칸을 통째로 바꿔 failedTries 가 지워졌다 — 시청자에게 안 보이는 편이 매일 다시 골려 상한이 영영 안 걸렸다.
 */
export function alreadyEntry(prev = {}, at, kind) {
  return { ...prev, at, kind, skipped: 'already' };
}

/**
 * 시청자 화면(로그아웃) 재확인 기록. 다섯 가지(judgeViewer) 중 하나라도 빠지면 실패 1회로 센다(같은 실패를 매일 되풀이하지 않게).
 *   r 은 judgeViewer 결과 {ok, missing, present, pinned} — 옛 형식 {mine, pinned} 도 받는다.
 *   check 'v24'(+24시간 재확인)는 recheck24At, 'audit'(일괄 점검)은 auditAt 에 따로 적는다 — +10분 기록(verifiedAt)을 덮으면
 *   dueChecks 가 제때 할 재확인을 빼먹거나 다시 고른다.
 */
export function verifiedEntry(prev = {}, r, at, check = 'v10') {
  const judged = r && 'ok' in r;
  const visible = judged ? !!r.present : !!r?.mine; const pinned = !!r?.pinned;
  const good = judged ? r.ok === true : visible && pinned;
  return { ...prev, ...({ v24: { recheck24At: at }, audit: { auditAt: at } }[check] ?? { verifiedAt: at }), visibleToViewers: visible, pinnedToViewers: pinned,
    ...(judged ? { viewerMissing: r.missing } : {}),
    ...(good ? {} : { failedTries: (prev.failedTries ?? 0) + 1 }) };
}

/**
 * 시청자 화면 판정 — 2026-10-23 사장님 "댓글다는게 좀 미흡할때가 많네"(Mac mini2 경유)의 다섯 가지.
 *   ①present 우리 광고 줄(aisviagent.com)이 보인다 — 없으면 안 달렸거나 스팸 필터(⑤) ②author 작성자 칸이 정확히 @flowvium
 *   (남이 같은 글·@flowvium 을 옮겨 단 것은 아니다) ③pinned 고정 표시가 보인다 ④fullLine '자세히 보기' 가 안 떠 있다
 *   (접혀 핵심 줄이 잘리지 않는다). 고정 댓글은 맨 위라 순서는 따로 안 본다.
 * @param {{author:string, text:string, pinned:boolean, moreShown:boolean}[]} threads  로그아웃 화면의 댓글 스레드들
 */
export function judgeViewer(threads, { handle = '@flowvium', key = 'aisviagent.com' } = {}) {
  const withKey = (threads ?? []).filter((t) => String(t.text ?? '').includes(key));
  const mine = withKey.find((t) => t.author === handle) ?? null;
  const missing = [];
  if (!withKey.length) missing.push('present');
  else if (!mine) missing.push('author');
  if (!mine?.pinned) missing.push('pinned');
  if (mine?.moreShown) missing.push('fullLine');
  return { ok: missing.length === 0, missing, present: !!mine, pinned: !!mine?.pinned };
}

/**
 * 이 편에 지금 할 재확인 — 'v10'(단 뒤 10분) · 'v24'(단 뒤 24시간, 한 번, 7일 안). 단 적 없는 편(at 없음)은 달기 대상이지 재확인 대상이 아니다.
 *   다시 단 편(at 이 verifiedAt 보다 뒤)은 +10분을 다시 본다.
 */
export function dueChecks(e, nowMs = Date.now()) {
  if (!e?.at) return [];
  const age = nowMs - Date.parse(e.at);
  if (!(age >= 0)) return [];
  if (age >= 10 * 60e3 && !(e.verifiedAt && Date.parse(e.verifiedAt) >= Date.parse(e.at))) return ['v10'];
  if (age >= 24 * 3600e3 && age < 7 * 864e5 && !e.recheck24At) return ['v24'];
  return [];
}

/** 정시 점검용 — 달았고, 마지막 시청자 화면 확인에서 빠진 게 없다. */
export function pinHealthy(e) {
  return !!e?.at && e.visibleToViewers !== false && e.pinnedToViewers !== false && !(e.viewerMissing?.length);
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
