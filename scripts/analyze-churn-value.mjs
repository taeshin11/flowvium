#!/usr/bin/env node
/**
 * analyze-churn-value.mjs — 회차마다 종목을 갈아엎는 것이 값을 하는가. (2026-09-14 신설)
 *
 * 배경: 직전 회차와 겹치는 종목이 평균 46%다. 몇 시간마다 목록의 절반이 바뀐다.
 *   portfolio-churn.mjs 는 그걸 **보이게만** 하고 판정은 미뤘다 —
 *   "갈아엎는 것 자체가 결함은 아니다. 새 데이터가 들어오면 판단이 바뀔 수 있다."
 *   맞는 말이지만 그대로 두면 영원히 모른다. 그래서 여기서 **값을 하는지** 잰다.
 *
 * 물음은 하나다: **뺀 종목보다 넣은 종목이 실제로 더 올랐나?**
 *   · 그렇다면 갈아엎기는 정보다. 그대로 둔다.
 *   · 아니라면 그건 잡음이고, 잡음을 따라 목록을 뒤집는 만큼 보는 사람을 잃는다.
 *
 * 재는 법: 회차 시각 이후 N 거래일 수익률을 넣은 종목·뺀 종목·유지한 종목별로 모은다.
 *   같은 기간·같은 시장이라 서로 비교 가능하다(날짜 효과가 저절로 상쇄된다).
 *   판정은 평균 차이만으로 하지 않는다 — 넣은 쪽이 뺀 쪽을 이긴 비율이 동전과 구별되는지 본다.
 */
import { openDb } from './lib/db.mjs';
import { fetchBars } from './lib/ohlc.mjs';
import { direction, describe } from './lib/edge-significance.mjs';

const HOLD_DAYS = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? 5);
const db = openDb();

const sessions = db.prepare(`
  SELECT report_id, MIN(generated_at) at, GROUP_CONCAT(DISTINCT ticker) tk
  FROM recommendations WHERE action = 'buy'
  GROUP BY report_id ORDER BY at
`).all().map((r) => ({ id: r.report_id, at: r.at, tickers: (r.tk ?? '').split(',').filter(Boolean) }));

console.log(`회차 ${sessions.length}개 · 보유 가정 ${HOLD_DAYS} 거래일\n`);

// 회차 쌍마다 들어온 것/나간 것/유지된 것
const events = [];
for (let i = 1; i < sessions.length; i++) {
  const prev = new Set(sessions[i - 1].tickers), cur = new Set(sessions[i].tickers);
  if (!prev.size || !cur.size) continue;
  for (const t of cur) events.push({ kind: prev.has(t) ? 'kept' : 'added', ticker: t, at: sessions[i].at, pair: i });
  for (const t of prev) if (!cur.has(t)) events.push({ kind: 'dropped', ticker: t, at: sessions[i].at, pair: i });
}
const tickers = [...new Set(events.map((e) => e.ticker))];
const oldest = events.reduce((m, e) => (e.at < m ? e.at : m), events[0].at);
console.log(`사건 ${events.length}건 (넣음 ${events.filter(e=>e.kind==='added').length} · 뺌 ${events.filter(e=>e.kind==='dropped').length} · 유지 ${events.filter(e=>e.kind==='kept').length}) · 종목 ${tickers.length}개`);

// 일봉은 종목당 한 번. 캐시를 쓴다.
const CACHE = `${process.env.TMPDIR ?? '/tmp'}/flowvium-churn-bars.json`;
const barsBy = new Map();
try {
  const { readFileSync, statSync } = await import('fs');
  if (Date.now() - statSync(CACHE).mtimeMs < 6 * 3600e3) {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(CACHE, 'utf8')))) barsBy.set(k, v);
    console.log(`  (캐시 ${barsBy.size} 종목 재사용)`);
  }
} catch { /* 없으면 받는다 */ }

const need = tickers.filter((t) => !barsBy.has(t));
let done = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const t = need.shift();
    if (!t) return;
    const r = await fetchBars(t, oldest, new Date().toISOString());
    if (r?.bars?.length) barsBy.set(t, r.bars);
    if (++done % 40 === 0) process.stdout.write(`  ...${done}\n`);
  }
}));
try { (await import('fs')).writeFileSync(CACHE, JSON.stringify(Object.fromEntries(barsBy))); } catch { /* 캐시 실패는 무시 */ }
console.log(`일봉 ${barsBy.size}/${tickers.length} 종목\n`);

/** 회차 시각 이후 첫 거래일 종가 → N 거래일 뒤 종가. 못 재면 null. */
function forwardPct(ticker, atIso) {
  const bars = barsBy.get(ticker);
  if (!bars) return null;
  const t0 = Date.parse(atIso);
  const i = bars.findIndex((b) => b.t >= t0);
  if (i < 0 || i + HOLD_DAYS >= bars.length) return null;
  const a = bars[i].c, b = bars[i + HOLD_DAYS].c;
  return a > 0 ? (b - a) / a * 100 : null;
}

for (const e of events) e.ret = forwardPct(e.ticker, e.at);
const usable = events.filter((e) => e.ret != null);
const by = (k) => usable.filter((e) => e.kind === k).map((e) => e.ret);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const med = (a) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const f = (x) => (x == null ? '-' : (x > 0 ? '+' : '') + x.toFixed(2) + '%');

console.log(`측정 가능 ${usable.length}/${events.length}건\n`);
console.log('              건수    평균     중앙값');
for (const k of ['added', 'kept', 'dropped']) {
  const a = by(k);
  const label = { added: '넣은 종목', kept: '유지한 종목', dropped: '뺀 종목' }[k];
  console.log(`  ${label.padEnd(12)} ${String(a.length).padStart(4)}  ${f(avg(a)).padStart(8)}  ${f(med(a)).padStart(8)}`);
}

// 같은 회차 안에서 넣은 것 vs 뺀 것을 짝지어 비교 — 날짜 효과가 상쇄된다
const pairs = new Map();
for (const e of usable) {
  if (!pairs.has(e.pair)) pairs.set(e.pair, { added: [], dropped: [] });
  if (e.kind === 'added') pairs.get(e.pair).added.push(e.ret);
  if (e.kind === 'dropped') pairs.get(e.pair).dropped.push(e.ret);
}
let win = 0, lose = 0, diffs = [];
for (const p of pairs.values()) {
  if (!p.added.length || !p.dropped.length) continue;
  const d = avg(p.added) - avg(p.dropped);
  diffs.push(d);
  if (d > 0) win++; else lose++;
}
console.log(`\n같은 회차에서 넣은 것 vs 뺀 것 (회차별 짝비교 ${win + lose}쌍)`);
console.log(`  넣은 쪽이 이긴 회차 ${describe({ wins: win, losses: lose })}`);
console.log(`  평균 차이 ${f(avg(diffs))} · 중앙값 ${f(med(diffs))}`);
const d = direction({ wins: win, losses: lose });
console.log(`\n판정: ${d > 0 ? '✅ 갈아엎기가 값을 한다 — 넣은 쪽이 유의하게 낫다'
  : d < 0 ? '❌ 갈아엎기가 손해다 — 뺀 쪽이 유의하게 낫다'
  : '· 판정 보류 — 동전과 구별되지 않는다. 갈아엎어서 얻는 것이 확인되지 않는다'}`);
