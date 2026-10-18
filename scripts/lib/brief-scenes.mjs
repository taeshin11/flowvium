/**
 * brief-scenes.mjs — 브리핑 장면이 자기 뉴스 번호(story)를 들고 다니게 한다. (2026-10-18)
 *
 * 종전: 장면 i = BRIEF[i] 로 **장면 번호**에 기댔다. 파싱·중복 거르기·사진 잃은 장면 빼기·차트 맞바꾸기로
 *   장면 순서가 바뀌면 사진 찾기·CLIP 대조·메타(headlines/bodies)가 남의 뉴스를 가리켰다.
 *   10/18 21:45 WYtOA2WgZTI: 화면은 추미애 → LG전자 2장면인데 메타는 4건 그대로 → 제목은 LG전자, 설명란엔 화면에 없는 뉴스까지.
 * 규칙: 모델 출력을 거르기 **전에** 번호를 붙인다. 이후 모든 조회는 scene.story 로.
 */

/** 모델이 낸 장면 배열(순서 = 뉴스 순서)에 뉴스 번호를 붙인다. 거르기 전에 부른다. */
export function tagBriefScenes(arr) {
  return (arr ?? []).map((x, k) => (x && typeof x === 'object' ? { ...x, story: k } : x));
}

/** 화면에 남은 장면 순서대로 그 뉴스의 헤드라인·본문. 마무리 장면·번호 없는 장면은 뺀다. */
export function briefMeta(scenes, headlines, bodies) {
  const ks = [];
  for (const s of scenes ?? []) if (!s?.isOutro && Number.isInteger(s?.story) && !ks.includes(s.story)) ks.push(s.story);
  return { headlines: ks.map((k) => headlines?.[k]).filter(Boolean), bodies: ks.map((k) => bodies?.[k] ?? '') };
}
