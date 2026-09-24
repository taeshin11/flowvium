/**
 * topic-lift.mjs — 주제별 조회수 성적을 **공정하게** 잰다. (2026-09-24 신설)
 *
 * 사장님 "다음 주제를 정할 때는 조회수 분석해서 해라".
 *
 * 기존 topic-score.weakByViews 가 이 일을 하도록 돼 있었는데 **아무것도 못 골랐다**
 *   (지금 데이터로 약한 갈래·강한 갈래 둘 다 빈 값). 원인 셋:
 *   (1) 나이를 안 맞췄다 — 8시간 된 영상과 300시간 된 영상을 원시 조회수로 비교했다.
 *   (2) 날짜를 안 가렸다 — 9/3~7 은 채널 전체가 1,300대, 9/9 는 477. 주제 효과보다 크다.
 *       날짜를 안 가리면 "그 시기에 많이 올린 주제" 가 이긴 것처럼 보인다.
 *       실제로 9/7 측정은 "정치갈등이 꼴찌" 라 했는데, 날짜를 가리니 **국내정치가 1위**였다.
 *   (3) 분류기(정규식 categoryOf)가 헤드라인의 46% 를 '기타' 로 못 나눴다 — 분류는 topic-classify 가 맡는다.
 *
 * 방법: 영상마다 48시간 무렵(24~72h) 조회수 하나를 쓰고, **같은 날 올린 영상들의 중앙값으로 나눈다.**
 *   lift 1.0 = 그날 또래와 같다. beat = 또래 중앙값을 넘은 비율.
 * 표본이 minSamples 미만인 주제는 **판단하지 않는다**(결과에 넣지 않는다) — 6편으로 1.47x 는 우연일 수 있다.
 */

const WINDOW = [24, 72];

/** 한 영상의 관측들 중 target 시간에 가장 가까운 것. 창 밖이면 null. */
export function pickNear(obs, target = 48) {
  let best = null;
  for (const o of obs ?? []) {
    const a = Number(o?.age_hours);
    if (!(a >= WINDOW[0] && a <= WINDOW[1])) continue;
    if (!best || Math.abs(a - target) < Math.abs(Number(best.age_hours) - target)) best = o;
  }
  return best;
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param {Array<{video_id:string, views:number, age_hours:number, published_at:string, topic:string|null}>} rows
 *   shorts_stats 관측 행(영상당 여러 개여도 된다) + 그 영상의 topic
 * @returns {Map<string, {lift:number, beat:number, n:number}>}
 */
export function topicLift(rows, { minSamples = 8 } = {}) {
  // 영상별로 48h 근처 관측 하나
  const byVid = new Map();
  for (const r of rows ?? []) {
    if (!r?.video_id) continue;
    (byVid.get(r.video_id) ?? byVid.set(r.video_id, []).get(r.video_id)).push(r);
  }
  const vids = [];
  for (const obs of byVid.values()) {
    const o = pickNear(obs, 48);
    if (o && o.published_at) vids.push(o);
  }
  // 같은 날(KST 기준이 아니라 저장된 날짜 문자열 앞 10자리) 중앙값 — 주제 없는 영상도 또래로 센다
  const dayViews = new Map();
  for (const v of vids) {
    const d = String(v.published_at).slice(0, 10);
    (dayViews.get(d) ?? dayViews.set(d, []).get(d)).push(Number(v.views) || 0);
  }
  const dayMed = new Map([...dayViews].map(([d, a]) => [d, median(a)]));
  const byTopic = new Map();
  for (const v of vids) {
    if (!v.topic) continue;                 // 분류 전 과거 영상 — '기타' 로 몰지 않는다
    const m = dayMed.get(String(v.published_at).slice(0, 10));
    if (!m) continue;
    (byTopic.get(v.topic) ?? byTopic.set(v.topic, []).get(v.topic)).push((Number(v.views) || 0) / m);
  }
  const out = new Map();
  for (const [t, rel] of byTopic) {
    if (rel.length < minSamples) continue;
    out.set(t, { lift: median(rel), beat: rel.filter((x) => x > 1).length / rel.length, n: rel.length });
  }
  return out;
}

/**
 * 강·약 판정. **손으로 정한 문턱을 쓰지 않는다.**
 * '또래보다 잘 된 비율(beat)' 이 50% 에서 우연으로 보기 어려울 만큼 벗어났을 때만 판정한다
 *   (단측 p < 0.05 → |z| > 1.645, 이항의 정규근사). 나머지는 결과에 없다 = 건드리지 않는다.
 * 실측(2026-09-24): 국내정치 26/38(z=2.27) 강 · 기업·산업 6/21(z=-1.96) 약 ·
 *   증시 12/32(z=-1.41)·국제 20/49(z=-1.29)·사회 6/9(z=1.0) 는 우연 범위.
 * @param {Map<string,{beat:number,n:number}>} liftMap topicLift 결과
 * @returns {Map<string,'strong'|'weak'>}
 */
export function topicTier(liftMap, { z = 1.645 } = {}) {
  const out = new Map();
  for (const [t, v] of liftMap ?? []) {
    const n = Number(v?.n) || 0;
    if (n < 1) continue;
    const zz = (Number(v.beat) * n - n / 2) / Math.sqrt(n / 4);
    if (zz > z) out.set(t, 'strong');
    else if (zz < -z) out.set(t, 'weak');
  }
  return out;
}
