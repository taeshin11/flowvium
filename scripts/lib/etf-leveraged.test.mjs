// etf-leveraged.test.mjs — ETF 전략에 미국 레버리지·인버스(2026-10-28 사장님 "QQQ, QLD, TQQQ, 속셀, 속스, 프로 뭐 이런 거 다 넣어야지")
//   node scripts/lib/etf-leveraged.test.mjs
import assert from 'node:assert/strict';
import { LEVERAGED_META, leveragedPicks } from './etf-leveraged.mjs';

// [1] 상품 — 나스닥·S&P·반도체의 2x/3x 와 인버스. 이름에 배수·방향이 보인다
for (const t of ['QLD', 'TQQQ', 'PSQ', 'SQQQ', 'SSO', 'UPRO', 'SH', 'SPXU', 'USD', 'SOXL', 'SOXS']) {
  assert.ok(LEVERAGED_META[t], `${t} 없음`);
  assert.match(LEVERAGED_META[t].name, /(2x|3x|인버스)/, `${t} 이름에 배수/방향: ${LEVERAGED_META[t].name}`);
}
const tick = (xs) => xs.map((x) => x.ticker);
const semiOw = [{ sector: 'semiconductors', stance: 'overweight' }];
const semiUw = [{ sector: 'Semiconductors', stance: 'underweight' }];

// [2] 강세 — 나스닥 2x 매수, 3x·S&P 3x 는 관망, 반도체 비중확대면 반도체 3x·2x
{
  const p = leveragedPicks({ stance: 'bullish', sectorAllocation: semiOw });
  assert.deepEqual(tick(p), ['QLD', 'TQQQ', 'UPRO', 'SOXL', 'USD']);
  assert.equal(p.find((x) => x.ticker === 'QLD').action, 'buy');
  assert.ok(p.filter((x) => x.ticker !== 'QLD').every((x) => x.action === 'watch'), '3x 는 매수로 내지 않는다');
  assert.ok(!tick(p).some((t) => ['SQQQ', 'SOXS', 'PSQ', 'SH', 'SPXU'].includes(t)), '강세에 인버스 없음');
}
// [3] 약세 — 인버스 1x 는 헤지, 3x 인버스는 관망(단기), 강세 레버리지 없음
{
  const p = leveragedPicks({ stance: 'bearish', sectorAllocation: semiUw });
  assert.deepEqual(tick(p), ['PSQ', 'SH', 'SQQQ', 'SPXU', 'SOXS']);
  assert.equal(p.find((x) => x.ticker === 'PSQ').action, 'hedge');
  assert.equal(p.find((x) => x.ticker === 'SQQQ').action, 'watch');
}
// [4] 중립 — 관망으로만(나스닥 2x·3x, 반도체 신호대로)
{
  assert.deepEqual(tick(leveragedPicks({ stance: 'neutral', sectorAllocation: [] })), ['QLD', 'TQQQ']);
  assert.deepEqual(tick(leveragedPicks({ stance: 'neutral', sectorAllocation: semiOw })), ['QLD', 'TQQQ', 'SOXL']);
  assert.deepEqual(tick(leveragedPicks({ stance: 'neutral', sectorAllocation: semiUw })), ['QLD', 'TQQQ', 'SOXS']);
  assert.ok(leveragedPicks({ stance: 'neutral', sectorAllocation: semiOw }).every((x) => x.action === 'watch'));
}
// [5] 모든 줄에 경고·짧은 비중·손절 — 일일 리밸런싱 가치소멸은 상품 특성이라 늘 붙인다
for (const st of ['bullish', 'neutral', 'bearish']) {
  for (const x of leveragedPicks({ stance: st, sectorAllocation: semiOw })) {
    assert.match(x.rationale, /⚠️/, x.rationale);
    assert.match(x.rationale, /단기/, x.rationale);
    assert.match(x.sizingHint, /%/, x.sizingHint);
    assert.ok(x.invalidation && x.invalidation.length > 5);
    assert.equal(x.tag, 'leveraged');
  }
}
// [6] 보고서의 섹터 이름은 프롬프트 스키마대로 'Technology' 다(10/28 최근 60편에 'Semiconductors' 0번) — 반도체는 기술 섹터 신호로 읽는다
{
  const techOw = [{ sector: 'Technology', stance: 'overweight' }];
  const techUw = [{ sector: 'Information Technology', stance: 'underweight' }];
  assert.deepEqual(tick(leveragedPicks({ stance: 'neutral', sectorAllocation: techOw })), ['QLD', 'TQQQ', 'SOXL']);
  assert.deepEqual(tick(leveragedPicks({ stance: 'bullish', sectorAllocation: techOw })), ['QLD', 'TQQQ', 'UPRO', 'SOXL', 'USD']);
  assert.deepEqual(tick(leveragedPicks({ stance: 'bearish', sectorAllocation: techUw })), ['PSQ', 'SH', 'SQQQ', 'SPXU', 'SOXS']);
  // 반도체 줄이 따로 있으면 그게 우선
  assert.deepEqual(tick(leveragedPicks({ stance: 'neutral', sectorAllocation: [...techOw, { sector: 'Semiconductors', stance: 'underweight' }] })), ['QLD', 'TQQQ', 'SOXS']);
}
console.log('etf-leveraged.test: ✅ 전부 통과');
