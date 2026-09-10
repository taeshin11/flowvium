/**
 * sector-canon.test.mjs — 보고서 섹터 이름과 종목 섹터 이름을 같은 말로 만든다.
 *
 * 왜 (2026-09-10): 직전 회차 섹터 스탠스를 매수 후보에 넘겼는데 **14개 중 1개만 일치**했다.
 *   보고서는 GICS 계열("Financials", "Health Care")을 쓰고, 종목 메타는 야후 계열
 *   ("Financial Services", "Healthcare")에 슬러그·한글까지 섞여 있다(실측 46종).
 *   이름이 안 맞으면 Map 조회가 전부 빗나가, "고쳤다"고 적어놓고 룰은 여전히 안 켜진다.
 *
 * 원칙: **애매한 것은 매핑하지 않는다.** 틀린 섹터 스탠스로 종목을 고르는 것은 스탠스가 없는 것보다 나쁘다.
 *   Battery/ev-battery 는 회사에 따라 산업재·IT·경기소비재로 갈려 남겨 둔다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonSector } from './sector-canon.mjs';

test('보고서 쪽 이름', () => {
  assert.equal(canonSector('Financials'), 'financials');
  assert.equal(canonSector('Health Care'), 'health care');
  assert.equal(canonSector('Technology'), 'information technology');
  assert.equal(canonSector('Materials'), 'materials');
});

test('종목 쪽 이름이 같은 값으로 모인다', () => {
  assert.equal(canonSector('Financial Services'), 'financials');
  assert.equal(canonSector('Banking'), 'financials');
  assert.equal(canonSector('Healthcare'), 'health care');
  assert.equal(canonSector('Basic Materials'), 'materials');
  assert.equal(canonSector('Semiconductors'), 'information technology');
  assert.equal(canonSector('IT Services'), 'information technology');
});

test('슬러그·한글도 받는다 — 실측에 섞여 있다', () => {
  assert.equal(canonSector('consumer-defensive'), 'consumer staples');
  assert.equal(canonSector('it-software'), 'information technology');
  assert.equal(canonSector('전기제품'), 'industrials');
});

test('&amp; 같은 HTML 이스케이프도 푼다 — DB 에 그대로 들어 있다', () => {
  assert.equal(canonSector('Independent Power Producers &amp; Energy Traders'), 'utilities');
});

test('애매하거나 섹터가 아닌 값은 null — 지어내지 않는다', () => {
  for (const x of ['ETF', 'KR', 'Other', 'Unknown', 'Battery', 'ev-battery', '', null, undefined]) {
    assert.equal(canonSector(x), null, `${x} 를 억지로 매핑하면 안 된다`);
  }
});

test('모르는 이름은 조용히 버리지 않고 null 로 돌려준다', () => {
  assert.equal(canonSector('Quantum Widgets'), null);
});
