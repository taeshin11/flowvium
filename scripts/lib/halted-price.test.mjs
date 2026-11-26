/**
 * halted-price.test — 가격이 멈춘 종목(거래정지 의심)은 매수 후보에서 뺀다.
 *   2026-11-26 noon 보고서: 054180.KQ 메디콕스가 1년 종가 전부 ₩2,294(52주 2294-2294 · 50MA=200MA=2,294 · RSI 100)인데
 *   정량 50점 KR 최상위로 비중 13% 매수 추천됐다. verify-report 가 '범위 역전' 으로 잡아 푸시가 막혔다 — 검출만 있고 예방이 없었다.
 */
let fail = 0;
const ok = (m) => console.log('  PASS ', m), bad = (m) => { fail++; console.log('  FAIL ', m); };
const M = await import('./halted-price.mjs').catch(() => ({}));
const f = M.haltedDays;
if (typeof f !== 'function') bad('[1] haltedDays 없음');
else {
  const flat = Array(252).fill(2294);
  (f(flat) >= 251) ? ok('[1] 1년 내내 같은 값 → 251일') : bad(`[1] ${f(flat)}`);
  const live = Array.from({ length: 60 }, (_, i) => 1000 + (i % 7) * 5);
  (f(live) === 0) ? ok('[2] 움직이는 종목은 0') : bad(`[2] ${f(live)}`);
  // 저가주는 호가 단위 때문에 하루이틀 같은 값이 나온다 — 그건 거래정지가 아니다
  (f([100, 101, 101, 101]) === 2 && M.isHalted([100, 101, 101, 101]) === false) ? ok('[3] 이틀 같은 값은 정지가 아니다') : bad('[3]');
  // 거래량이 0 이면 짧아도 정지
  (M.isHalted([10, 11, 12, 12, 12, 12, 12, 12], [5, 5, 5, 0, 0, 0, 0, 0]) === true) ? ok('[4] 같은 값 + 거래량 0 이 5일 → 정지') : bad('[4]');
  (M.isHalted(flat) === true) ? ok('[5] 메디콕스 형태는 정지') : bad('[5]');
}
const { readFileSync } = await import('fs');
const g = readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8');
(/isHalted\(/.test(g) && /haltedDays/.test(g)) ? ok('[6] 보고서 후보 단계가 isHalted 로 거른다') : bad('[6] generate-report-local 연결 안 됨');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
