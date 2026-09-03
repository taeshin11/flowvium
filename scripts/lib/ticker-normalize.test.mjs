#!/usr/bin/env node
let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };
const { toYahooTicker } = await import('./ticker-normalize.mjs');
const cases = [
  ['BRK.B', 'BRK-B', '미국 종류주 — 실측 24건이 여기서 막혔다'],
  ['BF.B', 'BF-B', '다른 종류주'],
  ['005930.KS', '005930.KS', '한국 종목은 그대로'],
  ['247540.KQ', '247540.KQ', '코스닥도 그대로'],
  ['NVDA', 'NVDA', '보통주는 그대로'],
  ['TSM', 'TSM', '3글자 그대로'],
  ['', '', '빈 값 안전'],
  ['BRK.XY', 'BRK.XY', '두 글자 뒤는 종류주가 아니다 — 모르면 안 건드린다'],
];
for (const [inp, want, label] of cases) {
  const got = toYahooTicker(inp);
  got === want ? ok(`${label}: "${inp}" → "${got}"`) : bad(`${label}: "${inp}" → "${got}" (기대 "${want}")`);
}
console.log(fail === 0 ? '\n✅ ticker-normalize 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
