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

/** 오늘(한국 날짜)의 적중 한 건 — 쇼츠 카드와 롱폼 광고가 같은 날 같은 건을 쓴다(10/23 한 곳으로). */
export function hitOfDay(hits, evaluated, nowMs = Date.now()) {
  if (!hits?.length) return null;
  const day = Math.floor((nowMs + 9 * 3600e3) / 864e5);
  return { evaluated, best: hits[day % hits.length], rank: (day % hits.length) + 1, of: hits.length };
}

/** DB 에서 실제 수익 min% 이상 적중을 읽어 오늘 것을 고른다(refresh-flowvium-card 와 같은 질의). */
export function todaysHit(db, { min = Number(process.env.FLOWVIUM_HIT_MIN || 20), nowMs = Date.now() } = {}) {
  const { hits, evaluated } = pickHits(db.prepare(`SELECT r.ticker, r.name, r.generated_at, o.evaluated_at, o.outcome, o.pnl_pct,
    r.entry_low, r.entry_high, r.price_at_gen, o.high_seen, o.low_seen
    FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id`).all(), { min });
  return hitOfDay(hits, evaluated, nowMs);
}
