#!/usr/bin/env node
/**
 * scripts/evaluate-sell-outcomes.mjs — 매도 추천 성과 평가기 (2026-06-12 신설).
 *
 * 배경: sell_recommendations 287건 적재·sell_outcomes 스키마 존재하는데 평가기가 한 번도
 *   구현 안 됨(0행) → 매도엔진(tune-sell-rules)의 학습 ground truth 부재 + 사용자 "target 93%
 *   익절이 맞나" 류 질문에 데이터로 답 불가. 매수쪽 recommendation_outcomes 와 대칭 복원.
 *
 * 평가 원리(결정론): 매도 시점 가격 대비 이후 실제 가격 경로(Yahoo 일봉).
 *   - price_delta_pct = (현재가/매도시점가 - 1) — "팔지 않았다면"의 수익률
 *   - delta <= -3%  → good_call      (매도 후 하락 — 매도가 손실 회피/이익 보존)
 *   - delta >= +5%  → missed_upside  (매도 후 상승 — 매도가 상방 놓침)
 *   - 그 외         → neutral
 *   high_seen/low_seen 으로 경로 극값 보존 (사후 분석: 일시반등 vs 추세).
 *
 * 사용: node scripts/evaluate-sell-outcomes.mjs            (evaluate_after 도래분 평가)
 *       node scripts/evaluate-sell-outcomes.mjs --min-days=5  (매도 후 최소 5일 경과분만)
 * cron: cron-runner 매일 03:35 KST (DART prefetch 후)
 */
import Database from 'better-sqlite3';

const UA = { 'User-Agent': 'Mozilla/5.0' };
const minDaysArg = process.argv.find(a => a.startsWith('--min-days='));
const MIN_DAYS = minDaysArg ? +minDaysArg.split('=')[1] : 5;

const db = new Database('data/flowvium.db');
const pending = db.prepare(`
  SELECT id, ticker, generated_at, current_price, sell_type
  FROM sell_recommendations
  WHERE current_price IS NOT NULL AND current_price > 0
    AND generated_at <= datetime('now', '-' || ? || ' days')
    AND id NOT IN (SELECT sell_rec_id FROM sell_outcomes)
  ORDER BY generated_at
`).all(MIN_DAYS);
console.log(`[sell-eval] 평가 대상 ${pending.length}건 (매도 후 ${MIN_DAYS}일+ 경과, 미평가)`);
if (!pending.length) process.exit(0);

// ticker 별 일봉 1회 fetch (3mo — 5/29 이후 커버)
const byTicker = new Map();
for (const p of pending) { if (!byTicker.has(p.ticker)) byTicker.set(p.ticker, []); byTicker.get(p.ticker).push(p); }
console.log(`[sell-eval] 고유 ticker ${byTicker.size}개 일봉 fetch...`);

async function fetchDaily(ticker) {
  for (const host of ['query1', 'query2']) {
    try {
      const j = await (await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=3mo`, { headers: UA, signal: AbortSignal.timeout(10000) })).json();
      const r = j?.chart?.result?.[0];
      const ts = r?.timestamp ?? [];
      const q = r?.indicators?.quote?.[0] ?? {};
      const rows = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close?.[i] == null) continue;
        rows.push({ t: ts[i] * 1000, close: q.close[i], high: q.high?.[i] ?? q.close[i], low: q.low?.[i] ?? q.close[i] });
      }
      if (rows.length) return rows;
    } catch { /* 다음 host */ }
  }
  return null;
}

const ins = db.prepare(`
  INSERT INTO sell_outcomes (sell_rec_id, evaluated_at, price_at_eval, price_delta_pct, outcome, ohlc_days, high_seen, low_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
let ok = 0, fail = 0, badData = 0;
for (const [ticker, recs] of byTicker) {
  const daily = await fetchDaily(ticker);
  await new Promise(r => setTimeout(r, 200));
  if (!daily) { fail += recs.length; console.log(`  ✗ ${ticker}: 일봉 없음 (${recs.length}건 보류)`); continue; }
  for (const rec of recs) {
    const t0 = new Date(rec.generated_at + (rec.generated_at.endsWith('Z') ? '' : 'Z')).getTime();
    const path = daily.filter(d => d.t > t0);
    if (path.length < 2) { fail++; continue; }
    // 데이터 무결성: 매도시점가 대비 경로 첫 종가가 1.8x/0.55x 밖이면 오염(분할 등) — skip
    if (path[0].close / rec.current_price > 1.8 || path[0].close / rec.current_price < 0.55) {
      badData++; console.log(`  ⚠️ ${ticker} 가격 불연속(분할/오염 의심) — skip`); continue;
    }
    const last = path[path.length - 1].close;
    const delta = Math.round((last / rec.current_price - 1) * 1000) / 10;
    const high = Math.max(...path.map(d => d.high));
    const low = Math.min(...path.map(d => d.low));
    const outcome = delta <= -3 ? 'good_call' : delta >= 5 ? 'missed_upside' : 'neutral';
    ins.run(rec.id, new Date().toISOString(), last, delta, outcome, path.length, high, low);
    ok++;
  }
}
console.log(`[sell-eval] ✓ ${ok} 평가 / ✗ ${fail} 보류 / ⚠️ ${badData} 데이터오염 skip`);

// 요약: sell_type 별 적중 통계 (튜닝·사용자 질문 근거)
const stats = db.prepare(`
  SELECT r.sell_type, COUNT(*) n,
    SUM(CASE WHEN o.outcome='good_call' THEN 1 ELSE 0 END) good,
    SUM(CASE WHEN o.outcome='missed_upside' THEN 1 ELSE 0 END) missed,
    ROUND(AVG(o.price_delta_pct),1) avg_delta
  FROM sell_outcomes o JOIN sell_recommendations r ON r.id = o.sell_rec_id
  GROUP BY r.sell_type ORDER BY n DESC
`).all();
console.log('\n[sell-eval] sell_type 별 성과 (delta = 팔지 않았다면의 수익률 — 음수일수록 매도 정당):');
for (const s of stats) console.log(`  ${String(s.sell_type).padEnd(26)} n=${String(s.n).padStart(3)} good ${s.good} / missed ${s.missed} / avg ${s.avg_delta}%`);
db.close();
