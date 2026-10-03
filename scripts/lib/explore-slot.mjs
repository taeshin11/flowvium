/**
 * explore-slot.mjs — 실험 칸(여섯 편에 한 편은 적게 다룬 주제로). 근거는 explore-slot.test.mjs 머리말.
 */
// 누적 편수를 섞는다(곱셈 해시) — n%6 을 그대로 쓰면 짝홀(제목 실험)과 박자가 겹친다.
const mix = (n) => { let x = (Math.abs(Math.trunc(Number(n) || 0)) + 0x9e3779b9) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
export const exploreFor = (seed) => mix(seed) % 6 === 0;

/** 최근에 적게 다룬 주제부터. unsafe(c) 가 참이면 맨 뒤. 주제 모르는 후보는 주제 있는 것 뒤. 같으면 원래 순서. */
export function exploreOrder(cands, recentCounts, { unsafe = () => false } = {}) {
  // '기타' 는 분류기의 나머지 칸 — 실험할 '주제' 가 아니다(9/30 "연합뉴스(기타)" 가 올라왔다). 모르는 것과 같이 둔다.
  const cnt = (c) => (c.__topic && c.__topic !== '기타' ? (recentCounts.get(c.__topic) ?? 0) : Infinity);
  return (cands ?? []).map((c, i) => ({ c, i }))
    .sort((a, b) => (unsafe(a.c) ? 1 : 0) - (unsafe(b.c) ? 1 : 0) || cnt(a.c) - cnt(b.c) || a.i - b.i)
    .map((x) => x.c);
}

// ── 트렌드 칸(2026-10-02, 사장님 지시) — 여섯 편에 한 편은 스튜디오 트렌드 탭에서 모은 주제어로. 근거는 trend-slot.test.mjs 머리말.
export const trendFor = (seed) => mix(seed) % 6 === 3;   // 실험 칸(=== 0)과 겹치지 않는다

const STOP = new Set(['shorts', '쇼츠', '영상', '오늘', '지금', '이것', '그냥', '정말', '진짜', '이유', '방법']);
/** 인기 제목들 → 두 제목 이상에 나온 낱말(시드어·숫자·불용어 제외), 많이 나온 순. */
export function trendTerms(items) {
  const seeds = new Set((items ?? []).map((x) => String(x.q ?? '').trim()).filter(Boolean));
  const seen = new Map();
  for (const it of items ?? []) {
    const words = new Set(String(it.title ?? '').toLowerCase().split(/[^0-9a-z가-힣]+/).filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !seeds.has(w) && !STOP.has(w)));
    for (const w of words) seen.set(w, (seen.get(w) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([w]) => w);
}

/** 주제어가 많이 겹치는 후보부터, 같으면 원래 순서. */
export function trendOrder(cands, terms) {
  const t = (terms ?? []).filter(Boolean);
  const score = (c) => { const s = [c.keyword, ...(c.headlines ?? [])].join(' ').toLowerCase(); return t.filter((w) => s.includes(w)).length; };
  return (cands ?? []).map((c, i) => ({ c, i, s: t.length ? score(c) : 0 })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
}

/** 칸별 48h 성적 — topic-lift 와 같은 잣대(48h 근처 관측 ÷ 같은 날 중앙값). rows 에 slot 이름. */
export function slotLift(rows) {
  const near = new Map();
  for (const r of rows ?? []) {
    if (!r?.video_id || !r.published_at) continue;
    const p = near.get(r.video_id);
    if (!p || Math.abs(Number(r.age_hours) - 48) < Math.abs(Number(p.age_hours) - 48)) near.set(r.video_id, r);
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const byDay = new Map();
  for (const v of near.values()) { const d = String(v.published_at).slice(0, 10); (byDay.get(d) ?? byDay.set(d, []).get(d)).push(Number(v.views) || 0); }
  const groups = new Map();
  for (const v of near.values()) {
    const m = med(byDay.get(String(v.published_at).slice(0, 10)));
    if (!m) continue;
    (groups.get(v.slot) ?? groups.set(v.slot, []).get(v.slot)).push((Number(v.views) || 0) / m);
  }
  return new Map([...groups].map(([k, a]) => [k, { lift: Number(med(a).toFixed(2)), beat: Number((a.filter((x) => x > 1).length / a.length).toFixed(2)), n: a.length }]));
}

// ── 화면 배분 A/B(2026-10-03) — classic|zoom 반반. 근거는 shorts-layout-ab.test.mjs 머리말.
export const layoutFor = (seed) => (((mix(Number(seed) + 7919) >>> 3) & 1) ? 'zoom' : 'classic');
