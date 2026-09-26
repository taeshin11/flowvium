#!/usr/bin/env node
/**
 * shadow-eval.test.mjs — 전향 연구(shadow 룰) 승격 판정이 부풀지 않게. 2026-09-27 신설.
 *
 * 모니터가 "승격 후보 shadow_buy_trend_pullback(n=202, 초과 1.5%p, 승률 53%)" 를 올렸다. 다시 재 보니:
 *   · 발화 240건이 (종목,날) **107건**(43종목) — 보고서가 하루 5번 같은 발화를 적어 n 이 부풀었다.
 *   · 한국 종목도 **SPY** 와 비교했다 — 시장이 다르다(KOSPI/KOSDAQ 이 맞다).
 *   · 제대로 재면 5일 +1.2%p · t 2.06 · 승률 49% / 10일 +0.26%p · t 0.31 — 소수의 큰 수익이 평균을 끌고,
 *     10일이면 사라진다. 이 룰은 전에도 n=30 +0.9%p → n=73 -0.28%p 로 뒤집혔다.
 * → 승격 기준: (종목,날) n≥30 · 5일 초과 ≥ +0.5%p · **t ≥ 2** · **10일 초과 > 0**(지속) · 승률 ≥ 50%.
 */
import { dedupeHits, benchmarkFor, summarizeExcess, isPromotable } from './shadow-eval.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const hits = [
  { rule_id: 'r', ticker: 'AAPL', hit_date: '2026-09-01' }, { rule_id: 'r', ticker: 'AAPL', hit_date: '2026-09-01' },
  { rule_id: 'r', ticker: 'AAPL', hit_date: '2026-09-02' }, { rule_id: 's', ticker: 'AAPL', hit_date: '2026-09-01' },
];
dedupeHits(hits).length === 3 ? ok('[1] (룰,종목,날) 하나로 — 4 → 3') : bad(`[1] ${dedupeHits(hits).length}`);
(benchmarkFor('005930.KS') === '^KS11' && benchmarkFor('214450.KQ') === '^KQ11' && benchmarkFor('BRK.B') === 'SPY')
  ? ok('[2] 벤치마크: 코스피·코스닥·SPY') : bad('[2]');
{
  const s = summarizeExcess([1, 2, 3, -1, 0, 2], [0.5, 1, -0.5]);
  (s.evaluated === 6 && Math.abs(s.avgExcess5 - 1.17) < 0.01 && s.t5 > 1 && s.avgExcess10 !== null && s.winRate5 === 67)
    ? ok(`[3] 요약: 평균 ${s.avgExcess5} · t ${s.t5} · 승률 ${s.winRate5}%`) : bad(`[3] ${JSON.stringify(s)}`);
}
// [4] 오늘 모니터가 올린 것(재측정값)은 승격 아님 — 10일 지속·승률 미달
(!isPromotable({ evaluated: 93, avgExcess5: 1.2, t5: 2.06, winRate5: 49, avgExcess10: 0.26, t10: 0.31 })) ? ok('[4] trend_pullback 재측정값 → 승격 아님(승률 49%)') : bad('[4]');
(isPromotable({ evaluated: 60, avgExcess5: 0.9, t5: 2.4, winRate5: 56, avgExcess10: 0.7, t10: 1.1 })) ? ok('[5] 유의·지속·승률 모두 → 승격 후보') : bad('[5]');
(!isPromotable({ evaluated: 60, avgExcess5: 0.9, t5: 1.2, winRate5: 60, avgExcess10: 0.7 })) ? ok('[6] t<2 면 우연 범위 — 승격 아님') : bad('[6]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
