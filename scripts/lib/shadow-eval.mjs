/**
 * shadow-eval.mjs — 전향 연구(shadow 룰) 평가의 셈과 승격 판정(순수). 2026-09-27. 근거는 shadow-eval.test.mjs 머리말.
 */
export function dedupeHits(hits) {
  const seen = new Set();
  return (hits ?? []).filter((h) => { const k = `${h.rule_id}|${h.ticker}|${h.hit_date}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function benchmarkFor(ticker) {
  const t = String(ticker ?? '');
  return t.endsWith('.KS') ? '^KS11' : t.endsWith('.KQ') ? '^KQ11' : 'SPY';
}

const stat = (a) => {
  const n = a.length;
  if (!n) return { n: 0, mean: null, t: null };
  const m = a.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : 0;
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : null };
};

/** @param {number[]} ex5 5거래일 초과수익(%p) @param {number[]} ex10 10거래일 */
export function summarizeExcess(ex5, ex10) {
  const a = stat(ex5 ?? []), b = stat(ex10 ?? []);
  return {
    evaluated: a.n,
    avgExcess5: a.mean == null ? null : +a.mean.toFixed(2),
    t5: a.t == null ? null : +a.t.toFixed(2),
    winRate5: a.n ? Math.round((ex5.filter((x) => x > 0).length / a.n) * 100) : null,
    evaluated10: b.n,
    avgExcess10: b.mean == null ? null : +b.mean.toFixed(2),
    t10: b.t == null ? null : +b.t.toFixed(2),
  };
}

export function isPromotable(r) {
  return !!r && r.evaluated >= 30 && r.avgExcess5 >= 0.5 && (r.t5 ?? 0) >= 2 && (r.avgExcess10 ?? -1) > 0 && (r.winRate5 ?? 0) >= 50;
}
