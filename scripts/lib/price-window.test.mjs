// price-window.test.mjs — /api/price-history?days=N 은 '최근 N일(달력)'. node scripts/lib/price-window.test.mjs
// 왜(11/11 눈검증): 삼성전자 '90일 주가 추이 −1.44%' 가 실제로는 7/29~11/11(105일) 구간이었다. 네이버는 (N+15)일 전부터
//   받아 거래일 수로 slice(-N) 했는데, 105일에 거래일이 71개뿐이라 하나도 안 잘렸다. 실제 90일 변동은 −23%(야후 대조).
import assert from 'node:assert/strict';
import { withinDays } from '../../src/lib/price-window.mjs';

const now = Date.parse('2026-11-11T07:00:00Z');
const pts = [['2026-07-29', 208500], ['2026-08-12', 260000], ['2026-08-13', 268000], ['2026-10-02', 276000], ['2026-11-11', 206000]]
  .map(([date, close]) => ({ date, close }));
// [1] 90일 전(8/13)보다 앞선 점은 뺀다
assert.deepEqual(withinDays(pts, 90, now).map((p) => p.date), ['2026-08-13', '2026-10-02', '2026-11-11']);
// [2] 남는 점이 2개 미만이면 마지막 2개는 남긴다(선을 그릴 수 있게)
assert.deepEqual(withinDays(pts, 1, now).map((p) => p.date), ['2026-10-02', '2026-11-11']);
// [3] 날짜를 못 읽는 점은 버리지 않는다(모르면 그대로)
assert.equal(withinDays([{ date: 'x', close: 1 }, ...pts], 90, now).length, 4);
console.log('price-window.test: 3/3 통과');
