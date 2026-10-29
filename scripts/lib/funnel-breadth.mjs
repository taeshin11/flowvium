/**
 * funnel-breadth.mjs — 매수 깔때기 Stage2 거부 집계, 시장 폭(200일선 아래·데드크로스 비율), 보고서 '한국 0종' 이유 한 줄.
 * 규칙·사례는 funnel-breadth.test.mjs 머리말.
 *
 * 2026-10-30: 전향 연구 파일럿 결과 — 추세 hard 거부(tech_200ma_breach·tech_dead_cross)가 시장 전체 약세에서
 *   KR 후보를 거의 다 떨군다(85%). 운영 규칙은 그대로 두고(셋 다 '2주 표본으로 바꾸지 말 것'),
 *   거부된 종목을 장부에 남겨 '추세 거부 없음'(A)·'시장 폭이 넓을 때만 풂'(B)을 8주 전향으로 잰다(protocol v0.3).
 */

const TREND_IDS = /tech_200ma_breach|tech_dead_cross/;

/** _buyVeto 문자열 → 'trend'(추세 하락 hard) | 'other' | null. */
export function vetoKind(v) {
  if (!v) return null;
  return TREND_IDS.test(String(v)) ? 'trend' : 'other';
}

/** Stage2 후보(_buyVeto 붙은 것 포함) → 시장별 {in, trend, other, kept} + 거부 목록(점수 높은 순). */
export function funnelSummary(stage2Cands) {
  const byMarket = {};
  const vetoed = [];
  for (const c of stage2Cands ?? []) {
    const m = c.market === 'kr' ? 'kr' : 'us';
    const b = (byMarket[m] ??= { in: 0, trend: 0, other: 0, kept: 0 });
    b.in++;
    const kind = vetoKind(c._buyVeto);
    if (!kind) { b.kept++; continue; }
    b[kind]++;
    const why = kind === 'trend' ? String(c._buyVeto).match(TREND_IDS)[0] : String(c._buyVeto).slice(0, 60);
    vetoed.push({ ticker: c.ticker, market: m, score: c.stage1Score ?? null, kind, why });
  }
  vetoed.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  return { byMarket, vetoed };
}

/** 종가 배열들(오래된 것→최신) → 시장 폭. 200봉 미만은 분모에서 뺀다. */
export function breadthOf(closesList) {
  let n = 0, below200 = 0, deadCross = 0, either = 0;
  const ma = (c, k) => c.slice(-k).reduce((s, x) => s + x, 0) / k;
  for (const c of closesList ?? []) {
    if (!Array.isArray(c) || c.length < 200) continue;
    n++;
    const m200 = ma(c, 200);
    const b = c.at(-1) < m200, d = ma(c, 50) < m200;
    if (b) below200++;
    if (d) deadCross++;
    if (b || d) either++;
  }
  return { n, below200, deadCross, either, pct: n ? Math.round((either / n) * 1000) / 1000 : null };
}

/** 시장 폭 값은 이만큼까지만 믿는다(매일 두 번 잰다 — 하루 반). */
export const BREADTH_MAX_AGE_MS = 36 * 3600_000;

/** 새 시장 폭이면 그대로, 오래됐거나 시각이 없으면 null. 보고서 JSON 에 넣을 때 거른다 — 장부·H10 국면 판정이 이 값을 그대로 믿으므로(10/30 agy 리뷰). */
export function freshBreadth(b, now = Date.now()) {
  const t = Date.parse(b?.at);
  return b && Number.isFinite(t) && now - t <= BREADTH_MAX_AGE_MS ? b : null;
}

/** 한 시장의 폭을 믿을 만한가 — 그 시장 종목의 절반 이상이 200봉으로 들어왔을 때만(10/30 agy 리뷰: 전체 합산 실패 기준은 KR 전멸을 못 막는다). */
export const breadthUsable = (b, tickersInMarket) => tickersInMarket > 0 && (b?.n ?? 0) * 2 > tickersInMarket;

/**
 * 보고서 KR 판정 이유에 붙일 한 줄. KR 후보의 절반 이상이 추세 거부로 빠졌을 때만. 시장 폭은 새것일 때만 붙인다.
 * 사장님 "불필요한 말·개발자 용어 빼" — 규칙 id 대신 '200일선'·'데드크로스' 로.
 */
export function krFunnelReason(summary, breadth, now = Date.now()) {
  const k = summary?.byMarket?.kr;
  if (!k?.in || k.trend * 2 < k.in) return null;
  const head = `한국 매수 후보 ${k.in}종 중 ${k.trend}종이 200일선 아래·데드크로스(장기 하락 추세)라 빠짐`;
  const b = freshBreadth(breadth, now)?.kr;
  return b?.n ? `${head} — 한국 전체 ${b.n}종 중 ${b.either}종(${Math.round(b.pct * 100)}%)이 같은 상태` : head;
}
