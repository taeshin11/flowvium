#!/usr/bin/env node
let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };
const { filterConflicts } = await import('./buy-sell-conflict.mjs');

const sells = new Map([
  ['HWM', { urgency: 'high', at: '2026-08-22T11:50Z', rationale: '50MA 이탈, RSI 36, 손절선 접근' }],
  ['XLP', { urgency: 'medium', at: '2026-09-01T00:00Z', rationale: '목표가 95% 도달, 수익 확정' }],
]);
const items = [{ ticker: 'HWM' }, { ticker: 'XLP' }, { ticker: 'NVDA' }];
const r = filterConflicts(items, sells);

!r.kept.some((x) => x.ticker === 'HWM')
  ? ok('긴급 매도 경고 종목(HWM)은 매수에서 빠진다 — 실제로 있었던 사고')
  : bad('HWM 이 그대로 매수에 남는다');
r.blocked[0]?.ticker === 'HWM' && /손절선/.test(r.blocked[0].rationale)
  ? ok('막은 이유를 근거와 함께 남긴다') : bad('차단 근거가 없다');

// 차익 실현 매도까지 막으면 잘 오른 종목을 영영 못 산다.
r.kept.some((x) => x.ticker === 'XLP')
  ? ok('수익 확정 매도(medium)는 막지 않는다') : bad('차익 실현까지 막는다');
r.kept.find((x) => x.ticker === 'XLP')?.sellWarning?.urgency === 'medium'
  ? ok('대신 경고를 달아 보고서에 드러낸다') : bad('경고 없이 조용히 통과시킨다');

r.kept.some((x) => x.ticker === 'NVDA') && !r.kept.find((x) => x.ticker === 'NVDA').sellWarning
  ? ok('경고 없는 종목은 그대로') : bad('무관한 종목을 건드린다');

// 빈 입력·매도 없음에서 터지지 않아야 한다.
filterConflicts([], new Map()).kept.length === 0 ? ok('빈 입력 안전') : bad('빈 입력에서 이상');
filterConflicts(items, null).kept.length === 3 ? ok('매도 목록이 없으면 전부 통과') : bad('매도 목록 없을 때 오작동');

console.log(fail === 0 ? '\n✅ buy-sell-conflict 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
