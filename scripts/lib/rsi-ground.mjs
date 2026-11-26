/**
 * rsi-ground.mjs — 보고서 문장의 RSI·과매도/과매수 말을 검증된 RSI(realRsi)로 맞춘다. 근거는 rsi-ground.test.mjs 머리말.
 *   realRsi 가 있으면 "RSI 과매도" 처럼 숫자 없는 말에도 숫자를 붙이고, 숫자와 어긋나는 말은 바꾼다.
 *   없으면 RSI 숫자와 과매도/과매수 말을 지운다(틀린 값보다 공백). 한글 뒤는 `\b` 가 안 걸리므로 (?![가-힣]) 로 끊는다.
 */
export function groundRsiText(text, realRsi) {
  let v = String(text ?? '');
  if (realRsi != null) {
    v = v.replace(/RSI\s*\d+(?:\.\d+)?%?/gi, `RSI ${realRsi}`);
    v = v.replace(/RSI\s*(과매도|과매수)/g, `RSI ${realRsi} $1`);
    if (realRsi >= 35) v = v.replace(/과매도/g, realRsi >= 65 ? '과매수' : '중립');
    if (realRsi <= 65) v = v.replace(/과매수/g, realRsi <= 35 ? '과매도' : '중립');
    return v;
  }
  return v.replace(/[,·]?\s*RSI\s*\d+(?:\.\d+)?%?/gi, '')
    .replace(/[,·]?\s*RSI\s*(?:과매도|과매수)/g, '')
    .replace(/[,·]?\s*(?:과매도|과매수)(?![가-힣])/g, '');
}
