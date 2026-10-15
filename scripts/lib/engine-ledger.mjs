/**
 * engine-ledger.mjs — 엔진 결정 장부의 채점 계산(순수 함수). 근거·규칙은 engine-ledger.test.mjs 머리말,
 * 사전등록 프로토콜은 docs/prospective-study-protocol.md. 기록은 scripts/engine-ledger-record.mjs, 채점은 engine-ledger-score.mjs.
 */

/** 왕복 비용(가정 — 세금·수수료·스프레드 대략값). 프로토콜 v0.1. */
export const COST = Object.freeze({ us: 0.0015, kr: 0.0040 });

const DAY = 86_400_000;
/** 마지막 봉 뒤 이만큼 새 봉이 없으면 거래가 끊긴 것으로 본다(휴장 연휴보다 길게). */
const STALE_MS = 10 * DAY;
/** '새 신호' 판정 창 — 20거래일 ≈ 28일. */
const NEW_SIGNAL_MS = 28 * DAY;

/** 결정 시각 뒤 처음 열리는 봉. Yahoo 일봉 t 는 그 장이 열리는 순간(ms). 없으면 -1. */
export function entryIndex(bars, decidedAt) {
  const t0 = Date.parse(decidedAt);
  return (bars ?? []).findIndex((b) => b.t > t0);
}

/**
 * 진입 봉 i 의 시가 → i+h-1 봉 종가. h 봉이 아직 없으면 null(대기).
 * 거래가 끊겼으면(마지막 봉이 STALE_MS 보다 오래) 마지막 종가로 청산하고 stale 표시 — 빼지 않는다.
 */
export function horizonReturn(bars, i, h, { now = Date.now() } = {}) {
  if (i < 0 || !bars?.[i]?.o) return null;
  const j = i + h - 1;
  if (bars[j]) return { ret: bars[j].c / bars[i].o - 1, entryT: bars[i].t, exitT: bars[j].t, stale: false };
  const last = bars.at(-1);
  if (now - last.t > STALE_MS) return { ret: last.c / bars[i].o - 1, entryT: bars[i].t, exitT: last.t, stale: true };
  return null;
}

/** 한 신호의 h 일 채점: 종목·기준지수를 같은 결정 시각 규칙으로. 날짜가 어긋나면 섞지 않고 이유를 남긴다. */
export function scoreSignal({ bars, bench, decidedAt, market, h, now = Date.now() }) {
  const i = entryIndex(bars, decidedAt);
  const k = entryIndex(bench, decidedAt);
  if (i < 0 || k < 0) return null;
  const r = horizonReturn(bars, i, h, { now });
  if (!r) return null;
  if (r.stale) {
    // 기준지수는 같은 날짜 범위로 — 종목이 끊긴 날까지.
    const kEnd = (bench ?? []).findLastIndex((b) => b.t <= r.exitT);
    if (bench[k]?.t !== r.entryT || kEnd < k) return { status: 'date_mismatch', h };
    const b = bench[kEnd].c / bench[k].o - 1;
    return { status: 'stale', h, ret: r.ret, bench: b, excess: r.ret - b, net: r.ret - b - (COST[market] ?? COST.us) };
  }
  const br = horizonReturn(bench, k, h, { now });
  if (!br) return null;
  if (br.entryT !== r.entryT || br.exitT !== r.exitT) return { status: 'date_mismatch', h };
  const excess = r.ret - br.ret;
  return { status: 'ok', h, ret: r.ret, bench: br.ret, excess, net: excess - (COST[market] ?? COST.us) };
}

/** 직전 28일 안에 같은 종목·같은 역할 기록이 없으면 새 신호. */
export function isNewSignal(history, sig) {
  const t = Date.parse(sig.decidedAt);
  return !(history ?? []).some((h) => h.ticker === sig.ticker && h.role === sig.role
    && Date.parse(h.decidedAt) < t && t - Date.parse(h.decidedAt) < NEW_SIGNAL_MS);
}

/** 역할별 날짜 포트폴리오(그날 신호 동일가중)의 순초과 시계열. rows: {day, role, net} */
export function dailySeries(rows, role, key = 'net') {
  const by = new Map();
  for (const r of rows ?? []) {
    if (r.role !== role || !Number.isFinite(r[key])) continue;
    (by.get(r.day) ?? by.set(r.day, []).get(r.day)).push(r[key]);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, n: v.length, v: v.reduce((s, x) => s + x, 0) / v.length }));
}

/** 평균과 Newey-West 표준오차(Bartlett 가중, lag). 겹치는 h 일 창이면 lag = h-1. */
export function neweyWest(xs, lag) {
  const n = xs.length;
  if (!n) return { n: 0, mean: null, se: null, t: null };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const e = xs.map((x) => x - mean);
  const g = (k) => { let s = 0; for (let i = k; i < n; i++) s += e[i] * e[i - k]; return s / n; };
  let v = g(0);
  for (let k = 1; k <= Math.min(lag, n - 1); k++) v += 2 * (1 - k / (lag + 1)) * g(k);
  const se = Math.sqrt(Math.max(v, 0) / n);
  return { n, mean, se, t: se > 0 ? mean / se : null };
}
