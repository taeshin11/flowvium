#!/usr/bin/env node
/**
 * ohlc-simulate.test.mjs — 목표에 닿으면 팔지 않고 추격 손절로 넘기는 규칙("이긴 거래를 달리게").
 * 2026-09-25 신설. 사장님 "너무 빨리 팔지는 않았는지도" → go.
 *
 * 근거: 목표에 닿아 판 213건 중 59% 가 그 뒤 20거래일에 목표보다 5% 넘게 더 갔다(analyze-exit-quality ③).
 *   그런데 목표를 넓히면 기대값이 나빠졌다(1.5:1 → -2.21%, 지금 -1.21%) — 목표 전에 돌아서는 게 늘어서다.
 *   그래서 목표는 그대로 두고, **닿은 뒤에** 파는 방식만 바꾼다.
 *
 * 부풀리지 않기: 목표에 닿은 **다음 날부터** 추격한다(같은 날 고점·저점 순서를 모른다).
 */
import { simulate } from './ohlc.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const bar = (h, l, c) => ({ t: 0, h, l, c: c ?? (h + l) / 2 });

// 진입 100, 손절 -8%, 목표 +10%
const base = { entryHigh: 100, stopPct: 0.08, targetPct: 0.10 };
// 목표(110) 닿고 더 올라 130 → 고점 대비 6% 밀림
const run = [bar(101, 99), bar(111, 104), bar(120, 112), bar(130, 121), bar(125, 121), bar(123, 118)];

// [1] 지금 규칙: 목표에서 판다 → +10%
{
  const r = simulate({ bars: run, ...base });
  (r.kind === 'target' && r.pnlPct === 10) ? ok('[1] 종전: 목표 +10% 에 판다') : bad(`[1] ${JSON.stringify(r)}`);
}
// [2] 목표 뒤 추격 5%: 고점 130 에서 5% = 123.5 에 판다 → +23.5%
{
  const r = simulate({ bars: run, ...base, trailAfterTarget: 0.05 });
  (r.kind === 'trail' && Math.abs(r.pnlPct - 23.5) < 1e-9) ? ok(`[2] 목표 뒤 추격 5% → +${r.pnlPct.toFixed(1)}%`) : bad(`[2] ${JSON.stringify(r)}`);
}
// [3] 목표 닿은 **그날** 크게 밀려도 그날은 추격하지 않는다(순서를 모름). 다음 날부터 — 바닥은 목표 이익의 절반(105)
{
  // 추격 10% 면 고점 112 기준 100.8 — 바닥(목표 이익의 절반, 105)이 더 높아 105 에 판다
  const bars = [bar(101, 99), bar(112, 103), bar(108, 106), bar(107, 100)];
  const r = simulate({ bars, ...base, trailAfterTarget: 0.10 });
  (r.kind === 'trail' && Math.abs(r.pnlPct - 5) < 1e-9 && r.idx === 3)
    ? ok('[3] 닿은 날은 그대로, 다음 날부터 — 목표 이익의 절반(+5%)은 지킨다') : bad(`[3] ${JSON.stringify(r)}`);
}
// [4] 절반은 목표에서, 절반은 추격 — 평균
{
  const r = simulate({ bars: run, ...base, trailAfterTarget: 0.05, halfAtTarget: true });
  (r.kind === 'trail' && Math.abs(r.pnlPct - (10 + 23.5) / 2) < 1e-9) ? ok(`[4] 절반 목표 + 절반 추격 → +${r.pnlPct.toFixed(2)}%`) : bad(`[4] ${JSON.stringify(r)}`);
}
// [5] 목표 전 손절은 그대로
{
  const r = simulate({ bars: [bar(101, 99), bar(100, 91)], ...base, trailAfterTarget: 0.05 });
  (r.kind === 'stop' && Math.abs(r.pnlPct + 8) < 1e-9) ? ok('[5] 목표 전 손절은 종전과 같다') : bad(`[5] ${JSON.stringify(r)}`);
}
// [6] 목표 뒤 끝까지 안 밀리면 보유 — 마지막 종가로 평가
{
  const bars = [bar(101, 99), bar(111, 104), bar(118, 112, 117)];
  const r = simulate({ bars, ...base, trailAfterTarget: 0.05 });
  (r.kind === 'open' && Math.abs(r.pnlPct - 17) < 1e-9) ? ok('[6] 안 밀리면 들고 있다(마지막 종가 +17%)') : bad(`[6] ${JSON.stringify(r)}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
