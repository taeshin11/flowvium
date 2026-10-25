/**
 * scorecard.mjs — 공개 성적표 집계 + 시장별 매수 축소 판정. 근거·기준은 scorecard.test.mjs 머리말.
 *   행 하나 = 매수 추천 하나를 14일 따라간 결과(scripts/scorecard.mjs 가 lib/judge-outcome 으로 만든다):
 *   {market:'us'|'kr', ticker, name, gen, done, res:'stop_loss'|'hit_target'|'time_exit'|'not_entered'|'still_holding'|'unknown',
 *    pnl:number|null, bench:number|null, shadow?:boolean}
 *   shadow = 축소로 화면에서 빠진 추천을 몰래 따라간 것 — 공개 성적에는 안 섞고 '풀림' 판정에만 쓴다.
 */
export const HORIZON_DAYS = 14;
export const GATE = { windowDays: 90, minN: 30, maxStopShare: 35, recoverN: 30 };
const DAY = 86400e3;

const med = (x) => { const s = [...x].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const mean = (x) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const pct = (k, n) => (n ? Math.round((100 * k) / n) : null);
const finished = (r) => r.done && Number.isFinite(r.pnl);

/** 같은 종목을 앞 추천의 14일 추적이 끝나기 전에 다시 낸 건은 한 번으로(첫 추천만). 입력 순서와 무관하게 추천 시각순. */
export function episodes(rows) {
  const last = new Map(); const out = [];
  for (const r of [...rows].sort((a, b) => Date.parse(a.gen) - Date.parse(b.gen))) {
    const t = Date.parse(r.gen), k = `${r.market}:${r.ticker}`;
    if (last.has(k) && t < last.get(k) + HORIZON_DAYS * DAY) continue;
    last.set(k, t); out.push(r);
  }
  return out;
}

// 가장 나빴던(좋았던) 추천 — 어떤 종목·언제인지까지(10/25 문구 검토: Claude·agy)
const pick = (rows, better) => { const r = rows.reduce((b, x) => (b == null || better(x, b) ? x : b), null);
  return r ? { pct: r1(r.pnl), ticker: r.ticker, name: r.name ?? null, date: r.gen.slice(0, 10) } : null; };

function stats(rows) {
  const P = rows.map((r) => r.pnl), X = rows.filter((r) => Number.isFinite(r.bench)).map((r) => r.pnl - r.bench);
  const c = (k) => rows.filter((r) => r.res === k).length;
  return {
    n: rows.length, profitShare: pct(P.filter((p) => p > 0).length, P.length), medianPct: r1(med(P)), meanPct: r1(mean(P)),
    vsIndexMedian: r1(med(X)), vsIndexMean: r1(mean(X)),
    stopShare: pct(c('stop_loss'), rows.length), targetShare: pct(c('hit_target'), rows.length), timeShare: pct(c('time_exit'), rows.length),
    worstPct: P.length ? r1(Math.min(...P)) : null, bestPct: P.length ? r1(Math.max(...P)) : null,
    worst: pick(rows, (x, y) => x.pnl < y.pnl), best: pick(rows, (x, y) => x.pnl > y.pnl),
  };
}

/** 시장별 공개 성적. 합친 숫자는 만들지 않는다(미국이 한국을 가린다). */
export function summarize(rows, { now = Date.now(), recentN = 30 } = {}) {
  const out = {};
  for (const m of ['us', 'kr']) {
    const R = episodes(rows.filter((r) => r.market === m && !r.shadow));
    const F = R.filter(finished);
    const byMonth = new Map();
    for (const r of F) { const k = r.gen.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(r); }
    const s = stats(F);
    out[m] = {
      recommended: R.length,
      notEntered: R.filter((r) => r.done && r.res === 'not_entered').length,
      tracking: R.filter((r) => !r.done).length,
      finished: F.length,
      ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'n')),
      monthly: [...byMonth.keys()].sort().map((k) => { const v = stats(byMonth.get(k)); return { month: k, n: v.n, profitShare: v.profitShare, medianPct: v.medianPct, vsIndexMedian: v.vsIndexMedian }; }),
      recent: [...F].sort((a, b) => Date.parse(b.gen) - Date.parse(a.gen)).slice(0, recentN)
        .map((r) => ({ date: r.gen.slice(0, 10), ticker: r.ticker, name: r.name, result: r.res, pnlPct: r1(r.pnl), vsIndex: Number.isFinite(r.bench) ? r1(r.pnl - r.bench) : null })),
      asOf: new Date(now).toISOString(),
    };
  }
  return out;
}

/**
 * 시장 매수 축소 판정(미리 고정한 기준 — 데이터에 맞춰 바꾸지 않는다).
 * @returns {{reduce:boolean, n:number, vsIndexMedian:number|null, stopShare:number|null, reason:string}}
 */
export function gateFor(market, rows, { now = Date.now(), wasReduced = false } = {}) {
  const mine = rows.filter((r) => r.market === market);
  const W = episodes(mine.filter((r) => !r.shadow)).filter((r) => finished(r) && Number.isFinite(r.bench) && Date.parse(r.gen) >= now - GATE.windowDays * DAY);
  const s = stats(W);
  const bad = s.n >= GATE.minN && s.vsIndexMedian < 0 && s.stopShare > GATE.maxStopShare;
  const base = { n: s.n, vsIndexMedian: s.vsIndexMedian, stopShare: s.stopShare };
  if (bad) return { reduce: true, ...base, reason: `최근 ${GATE.windowDays}일 끝난 ${s.n}건: 지수 대비 중앙 ${s.vsIndexMedian}%p · 손절 ${s.stopShare}%` };
  if (!wasReduced) return { reduce: false, ...base, reason: s.n < GATE.minN ? `표본 ${s.n}건 < ${GATE.minN}` : '기준 안' };
  // 이미 줄인 상태 — 최근 끝난 30건(그림자 포함)이 회복해야 푼다
  const L = episodes(mine).filter((r) => finished(r) && Number.isFinite(r.bench)).sort((a, b) => Date.parse(b.gen) - Date.parse(a.gen)).slice(0, GATE.recoverN);
  const l = stats(L);
  const recovered = l.n >= GATE.recoverN && l.vsIndexMedian >= 0 && l.stopShare <= GATE.maxStopShare;
  return recovered
    ? { reduce: false, ...base, reason: `회복: 최근 ${l.n}건 지수 대비 중앙 ${l.vsIndexMedian}%p · 손절 ${l.stopShare}%` }
    : { reduce: true, ...base, reason: `아직 회복 전: 최근 ${l.n}건 지수 대비 중앙 ${l.vsIndexMedian}%p · 손절 ${l.stopShare}%` };
}

// ── 보고서 적용 ─────────────────────────────────────────────────────────────
// 가격 문자열 → 숫자. db.mjs saveRecommendations 의 parsePrice/parseZone 과 같은 규칙(그림자도 같은 값으로 채점되게).
function parsePrice(s) { if (s == null) return null; const m = String(s).replace(/[$₩€,\s]/g, '').match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; }
function parseZone(s) {
  if (!s) return [null, null];
  const m = String(s).match(/([₩$€]?[\d,]+\.?\d*)\s*[-~]\s*([₩$€]?[\d,]+\.?\d*)/);
  if (!m) { const p = parsePrice(s); return [p, p]; }
  return [parsePrice(m[1]), parsePrice(m[2])];
}
const isKR = (t) => /\.(KS|KQ)$/i.test(String(t ?? ''));

/**
 * 성적표의 시장 축소 판정을 보고서 포트폴리오에 건다. 줄이는 시장의 매수만 절반(올림)으로 — 앞(확신순)을 남긴다.
 * 빠진 추천은 그림자 행(dropped)으로 돌려준다 — 부르는 쪽이 data/scorecard-shadow.jsonl 에 남겨 계속 채점한다(풀림 판정용).
 * 성적표가 없거나 48시간보다 오래됐으면 건드리지 않는다(어제 판정으로 오늘을 막지 않는다).
 */
export function applyMarketGate(portfolio, sc, { generatedAt = new Date().toISOString(), now = Date.now(), maxAgeH = 48 } = {}) {
  const same = { portfolio, dropped: [], marketGate: null };
  if (!sc?.gate || !(Date.parse(sc.generatedAt) > now - maxAgeH * 3600e3)) return same;
  const marketGate = Object.fromEntries(['us', 'kr'].map((m) => [m, { reduce: !!sc.gate[m]?.reduce, reason: sc.gate[m]?.reason ?? null }]));
  const drop = new Set();
  for (const m of ['us', 'kr']) {
    if (!marketGate[m].reduce) continue;
    const buys = portfolio.filter((p) => p?.action === 'buy' && isKR(p.ticker) === (m === 'kr'));
    for (const p of buys.slice(Math.ceil(buys.length / 2))) drop.add(p);
  }
  const dropped = [...drop].map((p) => {
    const [lo, hi] = parseZone(p.entryZone);
    return { ticker: p.ticker, name: p.name ?? null, market: isKR(p.ticker) ? 'kr' : 'us', generated_at: generatedAt,
      entry_low: lo, entry_high: hi, stop_loss: parsePrice(p.stopLoss), target: parsePrice(p.target) };
  });
  return { portfolio: portfolio.filter((p) => !drop.has(p)), dropped, marketGate };
}

/** 줄인 날(안내 문구 '○일부터'): 이어서 줄이면 처음 줄인 날, 새로 줄이면 오늘, 안 줄이면 null. */
export function gateSince(now, prev, today) {
  if (!now?.reduce) return null;
  return prev?.reduce && prev.since ? prev.since : today;
}
