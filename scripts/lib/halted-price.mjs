/**
 * halted-price.mjs — 가격이 멈춘 종목(거래정지 의심). 근거는 halted-price.test.mjs 머리말(11/26 메디콕스 1년 ₩2,294 고정).
 *   저가주는 호가 단위 탓에 하루이틀 같은 종가가 흔하다 — 그래서 **10거래일 연속 같은 값**이거나,
 *   거래량이 있으면 **같은 값 + 거래량 0 이 5일 연속**일 때만 멈췄다고 본다.
 */
/** 마지막 종가와 같은 값이 끝에서부터 며칠 이어졌나(첫 날 제외). */
export function haltedDays(closes) {
  const c = (closes ?? []).filter((x) => Number.isFinite(x));
  let n = 0;
  for (let i = c.length - 1; i > 0 && c[i] === c[i - 1]; i--) n++;
  return n;
}

export function isHalted(closes, volumes) {
  const n = haltedDays(closes);
  if (n >= 10) return true;
  if (n >= 5 && Array.isArray(volumes) && volumes.length) {
    const tail = volumes.slice(-n);
    return tail.length === n && tail.every((v) => v === 0);
  }
  return false;
}
