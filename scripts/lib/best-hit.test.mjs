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
import { pickBestHit, pickHits } from './best-hit.mjs';
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
// [5] 사장님 9/30 "최소 20% 넘는거로 다 해놔" — **실제로 낸** 수익 20% 이상을 전부, 종목당 하나, 높은 순.
//   날마다 하나씩 돌려 쓴다(카드는 하루 한 번 새로 굽는다). 20% 넘는 게 없으면 빈 목록 — 낮은 걸 끌어올리지 않는다.
{
  const rs = [row({ ticker: 'A', pnl_pct: 26.8, high_seen: 140 }), row({ ticker: 'B', pnl_pct: 21, high_seen: 130 }), row({ ticker: 'B', pnl_pct: 20.5, high_seen: 130 }),
    row({ ticker: 'C', pnl_pct: 17.3, high_seen: 130 }), row({ ticker: 'D', outcome: 'stop_loss', pnl_pct: 44 })];
  const h = pickHits(rs, { min: 20 });
  (h.hits.map((x) => x.ticker).join() === 'A,B' && h.evaluated === 5) ? ok(`[5] 20% 이상 실제 수익만(${h.hits.map((x) => `${x.ticker} +${x.pnl}%`).join(', ')})`) : bad(`[5] ${JSON.stringify(h)}`);
  (pickHits([row({ pnl_pct: 12 })], { min: 20 }).hits.length === 0) ? ok('[5b] 없으면 빈 목록') : bad('[5b]');
}
// [6] 오늘의 적중 — 쇼츠 카드(refresh-flowvium-card)와 롱폼 광고(make-brief-ads)가 **같은 날 같은 건**을 쓴다(10/23 한 곳으로 모음).
{
  const { hitOfDay } = await import('./best-hit.mjs');
  const hits = [{ ticker: 'A' }, { ticker: 'B' }, { ticker: 'C' }];
  const d0 = Date.parse('2026-10-23T00:00:00+09:00');
  const a = hitOfDay(hits, 7, d0); const b = hitOfDay(hits, 7, d0 + 3600e3 * 23); const c = hitOfDay(hits, 7, d0 + 864e5);
  (a.best.ticker === b.best.ticker && a.best.ticker !== c.best.ticker && a.of === 3 && a.evaluated === 7) ? ok('[6] 한국 날짜 하루 동안 같은 건, 다음 날 다음 건') : bad(`[6] ${JSON.stringify([a, b, c])}`);
  (hitOfDay([], 7, d0) === null) ? ok('[6b] 없으면 null') : bad('[6b]');
}
// [7] 2026-10-26: 광고 숫자는 고친 채점(data/scorecard.json)에서. recommendation_outcomes 는 ±2% 관용·매도 추천 청산이 섞여
//   HPSP 6/13 을 'sold +26.8%' 로 적었지만 추천대로(목표가 81,403) 따랐다면 +15.0% 였다(lib/judge-outcome 재채점). 광고가 부풀린 수익을 말하면 안 된다.
{
  const M = await import('./best-hit.mjs');
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./best-hit.mjs', import.meta.url), 'utf8');
  (typeof M.hitsFromScorecard === 'function' && !/recommendation_outcomes/.test(src.split('export function todaysHit')[1] ?? 'recommendation_outcomes'))
    ? ok('[7] todaysHit 은 recommendation_outcomes 를 읽지 않는다') : bad('[7] todaysHit 이 아직 옛 채점(recommendation_outcomes)을 읽는다');
  const now = Date.parse('2026-10-26T00:00:00Z');
  const sc = { generatedAt: '2026-10-25T10:25:00Z', markets: { us: { finished: 300 }, kr: { finished: 88 } },
    hits: [{ ticker: 'MU', name: 'Micron', pnl: 25, from: '2026-06-20', to: '2026-06-25', outcome: 'hit_target' },
      { ticker: '035420.KS', name: 'NAVER', pnl: 21.5, from: '2026-06-05', to: '2026-06-12', outcome: 'hit_target' },
      { ticker: '403870.KQ', name: 'HPSP', pnl: 15, from: '2026-06-13', to: '2026-06-15', outcome: 'hit_target' }] };
  const h = M.hitsFromScorecard?.(sc, { min: 20, now });
  (h && h.hits.map((x) => x.ticker).join() === 'MU,035420.KS' && h.evaluated === 388) ? ok('[7b] 성적표의 20% 이상만, 분모 = 끝난 추천 수') : bad(`[7b] ${JSON.stringify(h)}`);
  const old = M.hitsFromScorecard?.({ ...sc, generatedAt: '2026-10-20T00:00:00Z' }, { min: 20, now });
  (old && old.hits.length === 0) ? ok('[7c] 48시간 넘은 성적표면 적중 없음(브랜드 광고만) — 옛 채점으로 돌아가지 않는다') : bad(`[7c] ${JSON.stringify(old)}`);
}
{ // [8] 성적표가 광고용 적중 목록(hits)을 싣는다 — 종목당 최고 1건, 끝난 것만, 그림자 제외, 끝난 날짜(to)
  const { readFileSync } = await import('node:fs');
  const cli = readFileSync(new URL('../scorecard.mjs', import.meta.url), 'utf8');
  const { scoreOne } = await import('../scorecard.mjs');
  const d = (s) => Date.parse(s) / 1000;
  const bars = [{ t: d('2026-06-15T00:30:00Z'), o: 100, h: 101, l: 99, c: 100 }, { t: d('2026-06-16T00:30:00Z'), o: 101, h: 116, l: 100, c: 115 }];
  const r = scoreOne({ market: 'kr', ticker: 'X.KS', name: 'x', generated_at: '2026-06-14T10:00:00Z', entry_low: 99, entry_high: 100, stop_loss: 90, target: 115 }, bars, bars, d('2026-07-30T00:00:00Z'));
  (r.res === 'hit_target' && r.exitDate === '2026-06-16' && /hits:\s*bestHits\(/.test(cli)) ? ok('[8] scoreOne 이 끝난 날짜를 주고 성적표가 hits 를 싣는다') : bad(`[8] ${r.res} ${r.exitDate} ${/hits:/.test(cli)}`);
}
{ // [9] 광고 숫자를 쓰는 곳 전부가 같은 출처(성적표)를 쓴다 — 한 곳만 고치고 다른 곳이 옛 채점을 읽지 않게
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../video/', import.meta.url);
  const files = [...readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => new URL(f, dir)), new URL('../refresh-flowvium-card.mjs', import.meta.url)];
  const offenders = files.filter((u) => { const t = readFileSync(u, 'utf8'); return /pickHits|pickBestHit|todaysHit|best-hit/.test(t) && /recommendation_outcomes/.test(t); }).map((u) => u.pathname.split('/').pop());
  (!offenders.length) ? ok('[9] 광고 적중을 쓰는 스크립트가 옛 채점(recommendation_outcomes)을 읽지 않는다') : bad(`[9] 아직 옛 채점: ${offenders.join(', ')}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
