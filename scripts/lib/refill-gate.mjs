/**
 * refill-gate.mjs — 재충원(보충) 편입을 시장별 실적으로 열고 닫는다. 근거는 refill-gate.test.mjs 머리말.
 */
const isRefill = (r) => String(r?.rationale ?? '').includes('재충원');
const mktOf = (t) => (/\.(KS|KQ)$/.test(String(t ?? '')) ? 'kr' : 'us');

/** 종결된 보충 편입의 시장별 {n, mean, se, t}. 종목·날짜당 1건. */
export function refillStats(rows) {
  const seen = new Set(), by = { kr: [], us: [] };
  for (const r of rows ?? []) {
    if (!isRefill(r) || r.pnl_pct == null || !Number.isFinite(Number(r.pnl_pct))) continue;
    const k = `${r.ticker}|${r.day ?? String(r.generated_at ?? '').slice(0, 10)}`;
    if (seen.has(k)) continue; seen.add(k);
    by[mktOf(r.ticker)].push(Number(r.pnl_pct));
  }
  const st = (a) => { const n = a.length; if (n < 2) return { n, mean: n ? a[0] : null, se: null, t: null };
    const m = a.reduce((s, x) => s + x, 0) / n, v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1), se = Math.sqrt(v / n);
    return { n, mean: m, se, t: se > 0 ? m / se : null }; };
  return { kr: st(by.kr), us: st(by.us) };
}

/** 보충해도 되나. 30건 이상이고 평균이 0 보다 유의하게 낮으면(t<−2) 막는다. 모르면 허용. */
export function refillAllowed(market, stats, { minN = 30, tCut = -2 } = {}) {
  const s = stats?.[market];
  if (!s || s.n < minN || s.t == null) return { ok: true };
  if (s.mean < 0 && s.t < tCut) return { ok: false, reason: `${market.toUpperCase()} 보충 편입 실적 ${s.n}건 평균 ${s.mean.toFixed(2)}%(t=${s.t.toFixed(1)}) — 차순위로 채우지 않고 비워 둔다` };
  return { ok: true };
}
