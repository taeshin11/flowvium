#!/usr/bin/env node
/**
 * realized-pnl.test.mjs — 성과 측정이 결과 라벨과 일치하는지 검증.
 *
 * 배경(2026-08-20 실측): evaluate-recommendations.mjs:159-161 이 outcome 라벨과 무관하게
 *   pnl = (마지막종가 - 진입가)/진입가 로만 계산한다. 손절이 발동한 뒤 가격이 회복하면
 *   'stop_loss' 인데 수익이 양수로 기록된다.
 *     TRGP  진입 273.81 · 손절선 254.64 · 손절 발동 · 평가시점 297.09 → 기록 +10.72%
 *     실제로 손절을 지켰다면 약 -7%.
 *   38일 out-of-sample 83건 중 stop_loss 41건의 17건(41%)이 이렇게 부풀려져 있었다.
 *   → 전략 성적이 실제보다 낙관적으로 보인다. 라벨과 측정을 일치시킨다.
 */
const M = await import('./realized-pnl.mjs').catch(() => null);
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
if (!M || typeof M.realizedPnlPct !== 'function') {
  bad('realizedPnlPct 미구현 — 라벨과 무관하게 현재가로만 측정되고 있다');
  console.log('\n결과: 실패 1건'); process.exit(1);
}

const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;

// ① 손절 발동 후 회복 — 실제 TRGP 수치. 손절가 기준이어야 한다
let r = M.realizedPnlPct({ outcome: 'stop_loss', entry: 273.81, stop: 254.64, target: 300, lastClose: 297.09 });
(r != null && r < 0 && near(r, (254.64 - 273.81) / 273.81 * 100))
  ? ok(`손절 발동 → 손절가 기준 ${r.toFixed(2)}% (현재가 기준 +10.72% 아님)`)
  : bad(`손절인데 ${r}% — 손절가 기준이 아니다`);

// ② 목표 도달 후 하락 — 목표가 기준이어야 한다
r = M.realizedPnlPct({ outcome: 'hit_target', entry: 100, stop: 90, target: 120, lastClose: 95 });
(r != null && near(r, 20)) ? ok(`목표 도달 → 목표가 기준 ${r.toFixed(2)}%`) : bad(`목표 도달인데 ${r}%`);

// ③ 보유 중 — 현재가 기준(평가손익)
r = M.realizedPnlPct({ outcome: 'still_holding', entry: 100, stop: 90, target: 120, lastClose: 108 });
near(r, 8) ? ok('보유 중 → 현재가 기준 8.00%') : bad(`보유 중인데 ${r}%`);

// ④ 미진입 — 손익 없음(null). 0% 로 잡으면 평균이 희석된다
r = M.realizedPnlPct({ outcome: 'not_entered', entry: 100, stop: 90, target: 120, lastClose: 130 });
r === null ? ok('미진입 → null (0% 로 희석하지 않음)') : bad(`미진입인데 ${r}`);

// ⑤ 값이 없으면 조용히 0 을 만들지 않는다
r = M.realizedPnlPct({ outcome: 'stop_loss', entry: null, stop: 90, target: 120, lastClose: 95 });
r === null ? ok('진입가 결측 → null (조용한 0 금지)') : bad(`결측인데 ${r}`);

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
