/**
 * best-hit.mjs — 추천 기록에서 광고에 써도 되는 "실제 최고 적중" 하나. 근거는 best-hit.test.mjs 머리말.
 * @param rows recommendation_outcomes ⋈ recommendations (ticker, name, generated_at, evaluated_at, outcome, pnl_pct,
 *             entry_low, entry_high, price_at_gen, high_seen, low_seen)
 * @returns {{best: {ticker,name,pnl,from,to,outcome}|null, evaluated:number}}
 */
export function pickBestHit(rows) {
  const { hits, evaluated } = pickHits(rows, { min: 0 });
  return { evaluated, best: hits[0] ?? null };
}

/** 앞뒤가 맞는 실제 수익 min% 이상, 종목당 하나, 높은 순. (2026-09-30 사장님 "최소 20% 넘는거로 다") */
export function pickHits(rows, { min = 20 } = {}) {
  const done = (rows ?? []).filter((r) => r && r.outcome !== 'not_entered' && r.outcome !== 'unknown' && Number.isFinite(Number(r.pnl_pct)));
  const sane = done.filter((r) => {
    if (!['hit_target', 'sold'].includes(r.outcome)) return false;
    const pnl = Number(r.pnl_pct);
    if (!(pnl > 0) || r.price_at_gen == null) return false;
    const lo = Number(r.entry_low), hi = Number(r.entry_high);
    const entry = Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > 0 ? (lo + hi) / 2 : Number(r.price_at_gen);
    const exit = entry * (1 + pnl / 100);
    const top = Number(r.high_seen), bottom = Number(r.low_seen);
    if (!(top > 0) || exit > top * 1.01) return false;              // 그 기간 최고가보다 비싸게 팔 수는 없다
    if (bottom > 0 && exit < bottom * 0.99) return false;
    return true;
  });
  const byTicker = new Map();
  for (const r of sane) {
    const cur = byTicker.get(r.ticker);
    if (!cur || Number(r.pnl_pct) > Number(cur.pnl_pct)) byTicker.set(r.ticker, r);
  }
  const hits = [...byTicker.values()].filter((r) => Number(r.pnl_pct) >= min)
    .sort((a, b) => Number(b.pnl_pct) - Number(a.pnl_pct))
    .map((r) => ({ ticker: r.ticker, name: r.name, pnl: Number(Number(r.pnl_pct).toFixed(1)),
      from: String(r.generated_at).slice(0, 10), to: String(r.evaluated_at).slice(0, 10), outcome: r.outcome }));
  return { evaluated: done.length, hits };
}
