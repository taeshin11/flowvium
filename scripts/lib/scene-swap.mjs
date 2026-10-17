/**
 * scene-swap.mjs — 두 장면의 자리를 바꾼다(첫 화면이 도표일 때 등). scene-swap.test.mjs 머리말.
 *   브리핑(장면마다 다른 뉴스): 장면 객체를 통째로 바꾼다 — 훅·대본·이미 만든 소리(audio·alignment·dur)·사진이 한 짝이다.
 *   한 이슈: 그림(media·pick·credit)만 바꾼다 — 대본 순서가 이야기 순서다.
 */
export function swapScenePair(scenes, a, b, { brief = false } = {}) {
  if (a === b) return scenes;
  if (brief) { [scenes[a], scenes[b]] = [scenes[b], scenes[a]]; return scenes; }
  for (const f of ['media', 'pick', 'credit']) { const t = scenes[a][f]; scenes[a][f] = scenes[b][f]; scenes[b][f] = t; }
  return scenes;
}
