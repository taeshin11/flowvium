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
