#!/usr/bin/env node
/**
 * best-hit.test.mjs — 광고 카드에 쓸 "실제 최고 적중" 고르기. 2026-09-30 신설.
 *
 * 사장님 "포토를 수익률 200%~300%씩 찍혀있는 AI투자계좌 이런거여야할듯" → 되물음: 지어낸 수익률은 못 쓴다
 *   (실제 1,667건 평균 +1.21% · 승률 60%). 사장님 선택: **실제 최고 적중 종목**.
 * 기록에 모순이 있다(실측): 'stop_loss' 인데 +16.4%·+149.8% · 매도가가 기간 최고가보다 높음 · 추천가 없음.
 *   → 광고에는 **앞뒤가 맞는 기록만**: 목표 도달·매도로 끝났고, 이익이고, 추천가가 있고,
 *     진입 중간값×(1+수익률) 이 그 기간 최저~최고가 안에 있는 것. 같은 종목은 하나로.
 * 가장 좋은 것만 보여 주면 오해를 산다 — "최근 90일 평가 N건 중 최고" 를 같이 적는다(N 도 여기서 센다).
 */
import { pickBestHit } from './best-hit.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const row = (o) => ({ ticker: 'X', name: 'x', generated_at: '2026-07-01', evaluated_at: '2026-08-01', outcome: 'hit_target', pnl_pct: 10,
  entry_low: 95, entry_high: 105, price_at_gen: 100, high_seen: 120, low_seen: 90, ...o });
const rows = [
  row({ ticker: '082920.KQ', name: '비츠로셀', outcome: 'stop_loss', pnl_pct: 16.4 }),                 // 손절인데 이익 — 모순
  row({ ticker: 'NVDA', outcome: 'stop_loss', pnl_pct: 149.8 }),                                        // 모순
  row({ ticker: 'BAD', outcome: 'sold', pnl_pct: 30, high_seen: 110 }),                                  // 100×1.3=130 > 최고 110 — 불가능
  row({ ticker: 'NOGEN', outcome: 'sold', pnl_pct: 25, price_at_gen: null }),                            // 추천가 없음
  row({ ticker: 'CLX', name: 'The Clorox Company', outcome: 'hit_target', pnl_pct: 18.6, high_seen: 121 }),
  row({ ticker: 'CLX', name: 'The Clorox Company', outcome: 'hit_target', pnl_pct: 18.6, high_seen: 121, generated_at: '2026-06-02' }),
  row({ ticker: 'AAA', outcome: 'sold', pnl_pct: 12 }),
  row({ ticker: 'LOSS', outcome: 'sold', pnl_pct: -5 }),
  row({ ticker: 'NE', outcome: 'not_entered', pnl_pct: null }),
];
const r = pickBestHit(rows);
(r?.best?.ticker === 'CLX' && Math.abs(r.best.pnl - 18.6) < 0.01) ? ok(`[1] 앞뒤 맞는 기록 중 최고: ${r.best.ticker} +${r.best.pnl}%`) : bad(`[1] ${JSON.stringify(r?.best)}`);
(r?.evaluated === 8) ? ok(`[2] 평가 건수(진입 못 한 것 제외) ${r.evaluated}`) : bad(`[2] ${r?.evaluated}`);
(r?.best?.from === '2026-06-02' || r?.best?.from === '2026-07-01') ? ok(`[3] 날짜 ${r.best.from} → ${r.best.to}`) : bad(`[3] ${JSON.stringify(r?.best)}`);
(pickBestHit([row({ outcome: 'stop_loss', pnl_pct: 20 })]).best === null) ? ok('[4] 쓸 만한 게 없으면 null — 지어내지 않는다') : bad('[4]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
