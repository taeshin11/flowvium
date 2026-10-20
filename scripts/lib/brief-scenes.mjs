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

/**
 * 이 편의 대표 이슈 = **첫 화면 뉴스**. 브리핑이면 화면 첫 장면이 든 BRIEF 이슈, 아니면 issue.
 *   2026-10-19: 브리핑의 키·주제를 처음 고른 issue 에서 적었다 — 성적순 재배치·사진 없는 1순위 빼기 뒤에는
 *   그 이슈가 첫 화면이 아니거나 아예 없다(Kf_DTXTrmds KKR 채권 → '임광현'·국내정치, tILYRdDAKl8 인니 산불 → '김민석'·국내정치).
 */
export function leadStory(scenes, brief, issue) {
  if (!brief) return issue;
  const first = (scenes ?? []).find((s) => !s?.isOutro && Number.isInteger(s?.story));
  return (first && brief[first.story]?.it) ?? issue;
}

/**
 * 썸네일에 찍을 헤드라인 — 배경 사진 장면(사진 남은 첫 장면)의 뉴스. 2026-10-20.
 *   종전 headlines[0](처음 고른 순서)은 1번 뉴스가 사진을 잃어 빠지거나 도표 자리바꿈 뒤에는 **다른 뉴스 사진 위에** 찍혔다.
 *   한 사건 편은 모든 장면이 같은 뉴스라 대표 헤드라인 그대로.
 */
export function thumbHeadline(scenes, headlines, brief) {
  const first = (scenes ?? []).find((s) => !s?.isOutro && s?.media);
  if (brief && Number.isInteger(first?.story)) return headlines?.[first.story] || first?.hook || '';
  return headlines?.[0] || first?.hook || '';
}

/**
 * '절반은 실사진' 하한. 2026-10-20: 브리핑은 사진 없는 장면을 **먼저 지우고** 세서 total = 남은 장면 = 사진 수 →
 *   관문이 절대 안 걸렸다(4건 중 1장만 남아도 한 장면 영상). 지우기 전 **계획한** 장면 수로 센다.
 */
export function footageFloor(total, planned = 0) {
  return Math.max(1, Math.ceil(Math.max(total, planned) / 2));
}
