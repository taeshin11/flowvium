/**
 * shorts-health.mjs — 쇼츠 조회수 추세를 나이 맞춰 판정한다.
 *
 * 왜 (2026-09-09): 조회수가 09-08 부터 1/3 로 떨어졌는데 사흘이 지나 사용자가 물어본 뒤에야 알았다.
 *   자동으로 재는 것(shorts_stats)은 있었지만 **판정하는 것이 없었다** — 숫자만 쌓였다.
 *
 * 핵심은 나이를 맞추는 것이다. 최종 조회수를 그대로 비교하면 오늘 올린 편은 아직 자라는 중이라
 *   항상 지고, 매일 "하락" 이 나와 경보가 무의미해진다. 발행 후 같은 시간(기본 6~12시간)의
 *   값만 골라 하루 중앙값을 낸다. 평균이 아니라 중앙값인 이유는 한 편이 터지면(또는 한 편이
 *   1회에서 멈추면 — 2026-09-07 A1Y_r46CMoQ) 평균이 통째로 흔들리기 때문이다.
 */

/** 창(min~max 시간) 안의 표본만, 영상당 가장 늦은 것 하나로 접어 중앙값. 표본 없으면 null. */
export function medianAtAge(rows, minAge = 6, maxAge = 12) {
  const perVideo = new Map();
  for (const r of rows) {
    if (!(r.age_hours >= minAge && r.age_hours <= maxAge)) continue;
    const prev = perVideo.get(r.video_id);
    if (!prev || r.age_hours > prev.age_hours) perVideo.set(r.video_id, r);
  }
  const v = [...perVideo.values()].map((r) => r.views).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

/** 날짜별 { day, median, n }. 표본이 없는 날은 빼지 않고 median: null 로 남긴다. */
export function dailyTrend(rows, minAge = 6, maxAge = 12) {
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, rs]) => {
      const ids = new Set(rs.filter((r) => r.age_hours >= minAge && r.age_hours <= maxAge).map((r) => r.video_id));
      return { day, median: medianAtAge(rs, minAge, maxAge), n: ids.size };
    });
}

/** 최근 하루를 그 앞 기준선과 견준다. 표본이 얇으면 판정을 미룬다 — 틀린 경보가 무판정보다 나쁘다. */
export function verdict(trend, { minSamples = 3, downRatio = 0.6, upRatio = 1.5 } = {}) {
  const usable = trend.filter((d) => d.median != null && d.n >= minSamples);
  if (usable.length < 2) return { state: 'unknown', line: '표본이 모자라 판정하지 않는다' };
  const last = usable[usable.length - 1];
  const base = usable.slice(0, -1);
  const ref = base.map((d) => d.median).sort((a, b) => a - b)[Math.floor(base.length / 2)];
  const ratio = last.median / ref;
  if (ratio <= downRatio) {
    return { state: 'down', ratio, ref, last, line: `발행 8시간 조회수가 ${ref} → ${last.median} 로 떨어졌다` };
  }
  if (ratio >= upRatio) {
    return { state: 'up', ratio, ref, last, line: `발행 8시간 조회수가 ${ref} → ${last.median} 로 회복 중이다` };
  }
  return { state: 'flat', ratio, ref, last, line: `발행 8시간 조회수 ${last.median} (기준 ${ref}) — 큰 변화 없다` };
}
