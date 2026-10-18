/**
 * group-compare.mjs — 바꾸기 전·후 쇼츠 묶음을 비교한다. (2026-10-18)
 *   편당 구독은 대부분 0~1 이라 중앙값이 크게 흔들린다 → 합/합 비율로 재고, 무작위 재배치로 우연인지 본다.
 */

/** Σnum / Σden × scale. 분모가 0 이면 null. */
export function pooledRate(rows, num, den, scale = 1) {
  const d = rows.reduce((s, r) => s + (Number(r[den]) || 0), 0);
  return d > 0 ? (rows.reduce((s, r) => s + (Number(r[num]) || 0), 0) / d) * scale : null;
}

export function median(xs) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** 양쪽 p: 두 묶음을 섞어 다시 나눴을 때 차이가 지금만큼 이상 벌어지는 비율. */
export function permutationP(before, after, metric, { iters = 2000, rnd = Math.random } = {}) {
  const obs = Math.abs((metric(after) ?? 0) - (metric(before) ?? 0));
  const all = [...before, ...after];
  let hit = 0;
  for (let t = 0; t < iters; t++) {
    const a = all.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const d = Math.abs((metric(a.slice(before.length)) ?? 0) - (metric(a.slice(0, before.length)) ?? 0));
    if (d >= obs - 1e-12) hit++;
  }
  return hit / iters;
}

/** verdict: better | worse | same | unknown. n 이 minN 보다 작으면 판정하지 않는다. */
export function compareGroups(before, after, { metric, minN = 20, alpha = 0.05, iters = 2000, rnd } = {}) {
  if (before.length < minN || after.length < minN) return { verdict: 'unknown', why: `n=${before.length}/${after.length} — ${minN}편 미만` };
  const b = metric(before), a = metric(after);
  const p = permutationP(before, after, metric, { iters, rnd });
  const verdict = p >= alpha || a == null || b == null ? 'same' : a > b ? 'better' : 'worse';
  return { verdict, before: b, after: a, p, why: `p=${p.toFixed(3)}` };
}
