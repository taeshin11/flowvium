#!/usr/bin/env node
/**
 * scripts/eval-shadow-rules.mjs — 전향 연구 평가기 (2026-07-03 신설, TER 회고 후속)
 *
 * shadow_hits(리포트 생성 시점에 발화 기록된 live-미참여 후보 룰)의 *전향* 성적을 계산:
 *   발화 시점 가격 → 이후 5/10 거래일 수익률(Yahoo 실측) vs 같은 기간 SPY.
 *   룰별 집계(n, 평균 초과수익, 승률) → reports/shadow-stats.json + 콘솔 표.
 *   승격 기준(n≥30 && 평균 5d 초과수익 ≥ +0.5%p or 승률 ≥58%) 충족 시 승격 제안 출력 —
 *   승격 자체는 수동(사람/세션이 buy|sell-rules-tuned.json 에 이관, 자동 승격 안 함).
 *
 * 사후 부검(손실 후 회고)에만 의존하던 룰 발굴을 "가설 → 전향 검증 → 승격" 으로 전환하는 파이프라인.
 * cron: 주 1회 (cron-runner MAINT_JOBS 'eval-shadow-rules').
 */
import { openDb } from './lib/db.mjs';
import { writeFileSync, mkdirSync } from 'fs';

const MIN_AGE_DAYS = 8;          // 발화 후 최소 8일(≈5거래일+주말) 지나야 평가
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchDaily(ticker, range = '3mo') {
  const yt = /\.(KS|KQ)$/.test(ticker) ? ticker : ticker.replace(/\./g, '-');
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yt)}?range=${range}&interval=1d`,
    { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const res = (await r.json())?.chart?.result?.[0];
  if (!res?.timestamp) return null;
  const days = [], closes = res.indicators.quote[0].close;
  for (let i = 0; i < res.timestamp.length; i++) {
    if (closes[i] != null) days.push({ d: new Date(res.timestamp[i] * 1000).toISOString().slice(0, 10), c: closes[i] });
  }
  return days;
}
function fwdReturn(days, hitDate, nTrading) {
  const i = days.findIndex(x => x.d >= hitDate);
  if (i < 0 || i + nTrading >= days.length) return null;
  return (days[i + nTrading].c / days[i].c - 1) * 100;
}

const db = openDb();
const hits = db.prepare(`
  SELECT ticker, rule_id, side, price_at_hit, substr(generated_at,1,10) AS hit_date
  FROM shadow_hits WHERE generated_at <= datetime('now', '-${MIN_AGE_DAYS} days')
`).all();
console.log(`평가 대상 shadow 발화: ${hits.length}건 (${MIN_AGE_DAYS}일 경과분)`);
if (!hits.length) { console.log('⚠️ 아직 평가할 발화 없음 — 리포트가 쌓이면 자동 누적'); process.exit(0); }

// SPY 기준선 + 티커별 시세 (중복 fetch 제거, SEC/Yahoo 예의상 순차+간격)
const tickers = [...new Set(hits.map(h => h.ticker))];
const priceMap = new Map();
const spy = await fetchDaily('SPY', '6mo');
for (const t of tickers) {
  try { const d = await fetchDaily(t, '6mo'); if (d) priceMap.set(t, d); } catch { /* skip */ }
  await sleep(250);
}

const agg = new Map(); // rule_id → { side, n, sum5, sum10, win5, evalN5, evalN10 }
for (const h of hits) {
  const days = priceMap.get(h.ticker);
  if (!days) continue;
  const f5 = fwdReturn(days, h.hit_date, 5), f10 = fwdReturn(days, h.hit_date, 10);
  const s5 = spy ? fwdReturn(spy, h.hit_date, 5) : null;
  const a = agg.get(h.rule_id) ?? { side: h.side, n: 0, sum5: 0, sumX5: 0, sum10: 0, win5: 0, evalN5: 0, evalN10: 0 };
  a.n++;
  if (f5 != null) {
    const dir = h.side === 'sell' ? -1 : 1;                    // sell 가설 = 하락하면 적중
    const excess = (f5 - (s5 ?? 0)) * dir;
    a.evalN5++; a.sum5 += f5 * dir; a.sumX5 += excess; if (excess > 0) a.win5++;
  }
  if (f10 != null) { a.evalN10++; a.sum10 += f10 * (h.side === 'sell' ? -1 : 1); }
  agg.set(h.rule_id, a);
}

const out = [];
console.log('\n| rule | side | 발화 n | 평가 n | 방향수익 5d | SPY대비 초과 5d | 승률 5d | 방향수익 10d |');
for (const [id, a] of agg) {
  const row = {
    ruleId: id, side: a.side, hits: a.n, evaluated: a.evalN5,
    avgDir5: a.evalN5 ? +(a.sum5 / a.evalN5).toFixed(2) : null,
    avgExcess5: a.evalN5 ? +(a.sumX5 / a.evalN5).toFixed(2) : null,
    winRate5: a.evalN5 ? +(a.win5 / a.evalN5 * 100).toFixed(0) : null,
    avgDir10: a.evalN10 ? +(a.sum10 / a.evalN10).toFixed(2) : null,
  };
  out.push(row);
  console.log(`| ${id} | ${a.side} | ${row.hits} | ${row.evaluated} | ${row.avgDir5 ?? '-'}% | ${row.avgExcess5 ?? '-'}%p | ${row.winRate5 ?? '-'}% | ${row.avgDir10 ?? '-'}% |`);
  if (row.evaluated >= 30 && (row.avgExcess5 >= 0.5 || row.winRate5 >= 58)) {
    console.log(`  🎓 승격 후보: ${id} — n=${row.evaluated}, 초과 ${row.avgExcess5}%p, 승률 ${row.winRate5}% → live 룰셋 이관 검토`);
  }
}
try { mkdirSync('reports', { recursive: true }); } catch { /* */ }
writeFileSync('reports/shadow-stats.json', JSON.stringify({ evaluatedAt: new Date().toISOString(), minAgeDays: MIN_AGE_DAYS, rules: out }, null, 2));
console.log('\n→ reports/shadow-stats.json 저장');
