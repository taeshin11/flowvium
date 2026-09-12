/**
 * spy-benchmark.mjs — 추천 한 건의 *자기* 보유구간 SPY 수익률. (2026-09-12 신설)
 *
 * 왜 분리했나: 같은 컬럼(recommendation_outcomes.spy_return)에 두 경로가 서로 다른 의미를
 *   쓰고 있었다.
 *     backfill-spy-return.mjs  건별 (generated_at → evaluated_at)   ← 맞는 계산
 *     evaluate-recommendations 배치 1회 (가장 오래된 추천 → 지금)    ← 전 행에 같은 값 스탬프
 *   후자 때문에 4.4일 보유한 추천이 126일치 SPY 와 비교됐다(2026-09-08 배치 실측).
 *   alpha = pnl - spy 의 오른쪽이 구간 길이에 따라 제멋대로면 그 뺄셈은 알파가 아니다.
 *
 * 그래서 계산을 한 군데로 모은다. 쓰는 쪽은 시계열을 한 번 받아 건별로 낙착만 한다.
 */

/** 거래일 1d 종가 시계열 — 진입일 직전 거래일을 잡으려 앞뒤로 여유를 둔다. */
export async function fetchSpySeries(fromMs, toMs, { symbol = 'SPY', timeoutMs = 15000 } = {}) {
  const p1 = Math.floor(fromMs / 1000) - 14 * 86400;
  const p2 = Math.floor(toMs / 1000) + 2 * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${p1}&period2=${p2}&interval=1d`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'Mozilla/5.0' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${res.status}`);
  const d = await res.json();
  const result = d?.chart?.result?.[0];
  const ts = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  // timestamp ↔ close index 동기를 지킨다 (결측 close 만 버림).
  const series = [];
  for (let i = 0; i < ts.length; i++) {
    if (typeof closes[i] === 'number' && closes[i] > 0) series.push({ tMs: ts[i] * 1000, close: closes[i] });
  }
  series.sort((a, b) => a.tMs - b.tMs);
  return series;
}

/**
 * 해당 시각 *이하* 의 마지막 거래일 종가. 주말·휴장은 직전 거래일로 낙착.
 *
 * 시계열 시작보다 이른 시각이면 null 이다 — 종전 구현은 series[0] 으로 떨어져서
 * "못 재는 구간"을 "시계열 첫날부터 잰 값"으로 조용히 바꿔 놓았다. 잴 수 없으면 없다고 한다.
 */
export function closeOnOrBefore(series, dateMs) {
  let pick = null;
  for (const s of series) { if (s.tMs <= dateMs) pick = s; else break; }
  return pick;
}

/**
 * 진입~청산 구간 SPY 수익률(%).
 * 잴 수 없으면 null 을 준다 — 0(움직임 없음)과 모름을 섞지 않는다.
 */
export function spyReturnBetween(series, entryMs, closeMs) {
  if (!Array.isArray(series) || series.length === 0) return null;
  if (!Number.isFinite(entryMs) || !Number.isFinite(closeMs)) return null;
  const a = closeOnOrBefore(series, entryMs);
  const b = closeOnOrBefore(series, closeMs);
  if (!a || !b || !(a.close > 0)) return null;
  return parseFloat(((b.close - a.close) / a.close * 100).toFixed(2));
}

/** 행 묶음이 걸쳐 있는 전체 시각 범위 — 시계열을 몇 번 받을지 정하는 데 쓴다. */
export function spanOf(rows, ...fields) {
  let minMs = Infinity, maxMs = -Infinity;
  for (const r of rows) {
    for (const f of fields) {
      const ms = Date.parse(r[f]);
      if (Number.isFinite(ms)) { minMs = Math.min(minMs, ms); maxMs = Math.max(maxMs, ms); }
    }
  }
  return Number.isFinite(minMs) ? { minMs, maxMs } : null;
}
