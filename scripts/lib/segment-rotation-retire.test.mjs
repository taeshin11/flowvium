/**
 * segment-rotation-retire.test.mjs — SEC 에 없는 티커를 애초에 시도하지 않는다.
 *
 * 왜 (2026-09-10): segments-refresh 가 크론에 260줄의 "실패" 를 남기고 있었다.
 *   실제로는 DB 에 373행을 적재하며 돌고 있었다(부분 성공을 전체 실패로 보고).
 *   실패의 대부분은 SEC 에 없는 티커였다 — 실측 183건 중 178건이 ETF(XLF·YINN)나
 *   상장폐지(GPS→GAP 개명, GTLS 피인수)다. 몇 번을 다시 해도 no-cik 이고,
 *   지수 백오프는 간격만 늘릴 뿐 재시도를 멈추지 않는다. 그 소음이 진짜 실패
 *   (no-total-row 같은 파싱 문제)를 덮었다.
 *
 * 처음엔 "저장된 실패 이력이 no-cik 이고 2회 이상이면 은퇴" 로 만들려 했다. **틀린 설계였다** —
 *   그 조건에 SPY·QQQ·DIA·MDY 가 걸렸는데 지금 SEC 목록에는 멀쩡히 있다(과거 조회 이상의 흔적).
 *   과거 기록으로 추측할 일이 아니라 **매번 최신 목록으로 확인**할 일이다.
 *   또 BRK.B 는 SEC 가 BRK-B 로 적는다 — 형식 차이였지 죽은 티커가 아니었다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secTicker, resolvableTickers, cikMapSane, MIN_CIK_ENTRIES } from './segment-rotation.mjs';

test('SEC 표기로 정규화한다 — 클래스주는 점이 아니라 하이픈이다', () => {
  assert.equal(secTicker('brk.b'), 'BRK-B');
  assert.equal(secTicker('BF.B'), 'BF-B');
  assert.equal(secTicker('AAPL'), 'AAPL');
});

// 실제 SEC 목록은 1만 건이다. 안전장치(빈약하면 안 거른다)가 걸리지 않게 현실적 크기로 채운다.
const bigMap = (extra) => Object.assign(
  Object.fromEntries(Array.from({ length: MIN_CIK_ENTRIES }, (_, i) => [`FILLER${i}`, '1'])), extra);

test('SEC 목록에 있는 것만 남긴다', () => {
  const map = bigMap({ AAPL: '1', 'BRK-B': '2' });
  assert.deepEqual(resolvableTickers(['AAPL', 'BRK.B', 'XLF', 'GPS'], map), ['AAPL', 'BRK.B']);
});

test('원래 표기를 유지한다 — 호출부가 그 이름으로 저장한다', () => {
  assert.deepEqual(resolvableTickers(['brk.b'], bigMap({ 'BRK-B': '2' })), ['brk.b']);
});

test('목록이 빈약하면 아무것도 거르지 않는다 — 조회 이상에 멀쩡한 티커를 버리지 않는다', () => {
  const all = ['AAPL', 'MSFT'];
  assert.deepEqual(resolvableTickers(all, {}), all);
});

test('SEC 목록이 빈약하면 시도 자체를 막는다', () => {
  assert.equal(cikMapSane({}), false);
  assert.equal(cikMapSane(Object.fromEntries(Array.from({ length: MIN_CIK_ENTRIES }, (_, i) => [`T${i}`, '1']))), true);
});
