/**
 * endscreen-due.mjs — 최종 화면을 달 롱폼 고르기(11/02 사장님, Mac mini2 경유). 규칙은 endscreen-due.test.mjs 머리말.
 */
export const ENDSCREEN_FROM = '2026-11-02';
export const MAX_TRIES = 3;
const WAIT_MS = 30 * 60_000;

/** @param {Array<{id?:string, privacy?:string, at?:string, publishAt?:string|null}>} history logs/market-brief.json
 *  @param {{done?:Record<string,any>, tries?:Record<string,number>}} state logs/endscreen.json */
export function dueForEndscreen(history, state = {}, now = Date.now()) {
  const done = state.done ?? {}, tries = state.tries ?? {};
  return (history ?? []).filter((x) => {
    if (!x?.id || x.privacy !== 'public' || done[x.id] || (tries[x.id] ?? 0) >= MAX_TRIES) return false;
    const live = Date.parse(x.publishAt ?? x.at);
    return String(x.at ?? '').slice(0, 10) >= ENDSCREEN_FROM && Number.isFinite(live) && now - live >= WAIT_MS;
  }).map((x) => x.id);
}
