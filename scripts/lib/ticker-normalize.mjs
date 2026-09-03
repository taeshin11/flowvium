/**
 * ticker-normalize.mjs — 우리 표기와 Yahoo 표기를 맞춘다.
 *
 * 2026-09-04 실측: 손익이 안 채워진 55건 중 24건이 BRK.B 였다.
 *   BRK.B  → Yahoo HTTP 404 "symbol may be delisted"
 *   BRK-B  → HTTP 200
 *   상장폐지가 아니라 **표기가 다를 뿐**이다. Yahoo 는 미국 종류주(class share)를 하이픈으로 쓴다.
 *   우리 티커 풀에는 BRK.B 와 BRK-B 가 둘 다 들어 있어 풀 검사로는 안 걸린다.
 *   가져올 때 바꿔 주는 수밖에 없다.
 *
 * 한국 종목(.KS/.KQ)은 Yahoo 가 그대로 받으므로 건드리지 않는다.
 */

/** Yahoo 가 받는 형태로. 못 알아보는 것은 그대로 돌려준다(모르면 건드리지 않는다). */
export function toYahooTicker(ticker) {
  const t = String(ticker ?? '').trim().toUpperCase();
  if (!t) return t;
  if (/\.(KS|KQ)$/.test(t)) return t;                 // 한국 종목은 그대로
  // 미국 종류주: BRK.B → BRK-B, BF.B → BF-B. 뒤가 한 글자일 때만 바꾼다.
  const m = t.match(/^([A-Z]{1,5})\.([A-Z])$/);
  return m ? `${m[1]}-${m[2]}` : t;
}
