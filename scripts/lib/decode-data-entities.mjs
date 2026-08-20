/**
 * decode-data-entities.mjs — 데이터 객체 안의 HTML 엔티티를 재귀적으로 디코딩한다.
 *
 * 배경(2026-08-20): data/candidate-tickers.json · dart-corp-codes.json · sp500-tickers.json 에
 * "M&amp;T Bank", "삼성E&amp;A", "PG&amp;E Corporation" 같은 값이 저장돼 화면까지 그대로 갔다.
 * 외부 소스(HTML/RSS/API)에서 이름을 수집할 때 디코딩하지 않은 것이 원인이다.
 * 엔티티 표는 손으로 만들지 않는다 — entities 패키지(HTML5 권위 표)를 쓴다.
 *
 * 생성기는 파일을 쓰기 직전에 이 함수를 통과시킨다. 읽는 쪽에서 매번 고치는 게 아니라
 * 저장되는 값 자체를 바로잡는다.
 */
import { decodeHTML } from 'entities';

const dec = (s) => {
  if (typeof s !== 'string' || !s.includes('&')) return s;
  let out = decodeHTML(s);
  if (out.includes('&')) { const again = decodeHTML(out); if (again !== out) out = again; }
  return out;
};

export function decodeDataEntities(node) {
  if (typeof node === 'string') return dec(node);
  if (Array.isArray(node)) return node.map(decodeDataEntities);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[dec(k)] = decodeDataEntities(v);
    return out;
  }
  return node;
}
