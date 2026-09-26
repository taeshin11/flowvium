#!/usr/bin/env node
/**
 * scripts/eval-shadow-rules.mjs — 전향 연구 평가기 (2026-07-03 신설, TER 회고 후속)
 *
 * shadow_hits(리포트 생성 시점에 발화 기록된 live-미참여 후보 룰)의 *전향* 성적을 계산:
 *   발화 시점 가격 → 이후 5/10 거래일 수익률(Yahoo 실측) vs 같은 기간 시장(미국 SPY · 코스피 ^KS11 · 코스닥 ^KQ11).
 *   룰별 집계(n, 평균 초과수익, t, 승률, 10일 초과) → reports/shadow-stats.json + 콘솔 표.
 *   2026-09-27: (룰,종목,날) 하나로 센다 — 보고서가 하루 여러 번 같은 발화를 적어 n 이 2배 넘게 부풀었고,
 *     한국 종목을 SPY 와 비교했다. 승격 기준은 lib/shadow-eval.mjs isPromotable(유의 t≥2 · 10일 지속 포함).
 *   승격 후보 출력 —
 *   승격 자체는 수동(사람/세션이 buy|sell-rules-tuned.json 에 이관, 자동 승격 안 함).
 *
 * 사후 부검(손실 후 회고)에만 의존하던 룰 발굴을 "가설 → 전향 검증 → 승격" 으로 전환하는 파이프라인.
 * cron: 주 1회 (cron-runner MAINT_JOBS 'eval-shadow-rules').
 */
import { openDb } from './lib/db.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { dedupeHits, benchmarkFor, summarizeExcess, isPromotable } from './lib/shadow-eval.mjs';

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
const rawHits = db.prepare(`
  SELECT ticker, rule_id, side, price_at_hit, substr(generated_at,1,10) AS hit_date
  FROM shadow_hits WHERE datetime(generated_at) <= datetime('now', '-${MIN_AGE_DAYS} days')
`).all();
const hits = dedupeHits(rawHits);
console.log(`평가 대상 shadow 발화: ${hits.length}건 (룰·종목·날 기준, 원 기록 ${rawHits.length}건 · ${MIN_AGE_DAYS}일 경과분)`);
if (!hits.length) { console.log('⚠️ 아직 평가할 발화 없음 — 리포트가 쌓이면 자동 누적'); process.exit(0); }

// 시장 기준선 + 티커별 시세 (중복 fetch 제거, 예의상 순차+간격)
const tickers = [...new Set(hits.map(h => h.ticker))];
const priceMap = new Map();
const benchMap = new Map();
for (const b of new Set(tickers.map(benchmarkFor))) {
  try { const d = await fetchDaily(b, '6mo'); if (d) benchMap.set(b, d); } catch { /* 아래에서 평가 제외 */ }
  await sleep(250);
}
for (const t of tickers) {
  try { const d = await fetchDaily(t, '6mo'); if (d) priceMap.set(t, d); } catch { /* skip */ }
  await sleep(250);
}

// 기준선이 없으면 초과수익을 0 기준으로 세지 않고 평가에서 뺀다(예전엔 SPY 실패 시 절대수익이 초과로 둔갑했다).
const agg = new Map(); // rule_id → { side, n, dir5[], ex5[], dir10[], ex10[] }
for (const h of hits) {
  const a = agg.get(h.rule_id) ?? { side: h.side, n: 0, dir5: [], ex5: [], dir10: [], ex10: [] };
  a.n++;
  agg.set(h.rule_id, a);
  const days = priceMap.get(h.ticker), bench = benchMap.get(benchmarkFor(h.ticker));
  if (!days || !bench) continue;
  const dir = h.side === 'sell' ? -1 : 1;                      // sell 가설 = 하락하면 적중
  for (const n of [5, 10]) {
    const f = fwdReturn(days, h.hit_date, n), b = fwdReturn(bench, h.hit_date, n);
    if (f == null || b == null) continue;
    a[`dir${n}`].push(f * dir);
    a[`ex${n}`].push((f - b) * dir);
  }
}

const avg = (xs) => xs.length ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2) : null;
const out = [];
console.log('\n| rule | side | 발화 n | 평가 n | 방향수익 5d | 시장대비 초과 5d | t | 승률 5d | 초과 10d |');
for (const [id, a] of agg) {
  const row = { ruleId: id, side: a.side, hits: a.n, avgDir5: avg(a.dir5), avgDir10: avg(a.dir10), ...summarizeExcess(a.ex5, a.ex10) };
  row.promotable = isPromotable(row);
  out.push(row);
  console.log(`| ${id} | ${a.side} | ${row.hits} | ${row.evaluated} | ${row.avgDir5 ?? '-'}% | ${row.avgExcess5 ?? '-'}%p | ${row.t5 ?? '-'} | ${row.winRate5 ?? '-'}% | ${row.avgExcess10 ?? '-'}%p |`);
  if (row.promotable) {
    console.log(`  🎓 승격 후보: ${id} — n=${row.evaluated}, 초과 ${row.avgExcess5}%p(t ${row.t5}), 승률 ${row.winRate5}%, 10일 ${row.avgExcess10}%p → live 룰셋 이관 검토`);
  }
}
try { mkdirSync('reports', { recursive: true }); } catch { /* */ }
writeFileSync('reports/shadow-stats.json', JSON.stringify({ evaluatedAt: new Date().toISOString(), minAgeDays: MIN_AGE_DAYS,
  method: 'dedupe(rule,ticker,day) · benchmark SPY/^KS11/^KQ11 · promote=isPromotable', rules: out }, null, 2));
console.log('\n→ reports/shadow-stats.json 저장');
