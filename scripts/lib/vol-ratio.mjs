/**
 * vol-ratio.mjs — 마지막 끝난 장의 거래량 vs 그 전 period 일 평균(%). 진행 중인 장의 봉은 뺀다. 근거는 vol-ratio.test.mjs.
 */
/** Yahoo chart 의 timestamp[] 와 meta.currentTradingPeriod.regular 로 마지막 봉이 아직 진행 중인 장인지. */
export function lastBarInProgress({ timestamps, regular, now = Math.floor(Date.now() / 1000) }) {
  if (!regular?.start || !regular?.end || !timestamps?.length) return false;
  const last = timestamps[timestamps.length - 1];
  return last >= regular.start && now >= regular.start && now < regular.end;
}

export function computeVolRatio(volumes, period = 20, { partialLast = false } = {}) {
  const v = partialLast ? volumes.slice(0, -1) : volumes;
  if (v.length < period + 2) return null;
  const avg = v.slice(-period - 1, -1).reduce((a, b) => a + (b ?? 0), 0) / period;
  const last = v[v.length - 1];
  if (!avg) return null;
  return Math.round(((last / avg) - 1) * 100);
}
