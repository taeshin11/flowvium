#!/usr/bin/env node
/**
 * analyze-exit-quality.mjs — 잃을 때 무엇을 놓쳤나, 팔고 나서 더 갔나. (2026-09-12 신설)
 *
 * 왜 필요한가: 지금까지 성과를 "몇 % 벌었나" 로만 봤다. 그 숫자로는
 *   **작게 잃고 크게 버는가** 를 물을 수 없다. 물어야 할 건 세 가지다 —
 *     ① 손절된 건은 얼마나 갔다가 돌아섰나 (목표 코앞에서 놓쳤나)
 *     ② 손절한 뒤에 올랐나 (성급했나)
 *     ③ 목표에 닿아 판 뒤에 더 갔나 (목표가 너무 가까운가)
 *
 * DB 만으로는 답이 안 나온다. high_seen 은 **판정이 끝난 시점까지** 의 최고가라
 *   진입 전 고가까지 섞여 있고(LRCX: 진입가 320인데 high_seen 438 — 그건 하락 전 고가다),
 *   청산 이후는 아예 안 들어 있다. 그래서 일봉을 다시 받아 하루씩 따라간다.
 *
 * 같은 종목이 여러 회차에서 중복 추천되므로 (종목, 생성일) 로 한 건씩만 센다 —
 *   안 그러면 현대차 한 건이 7건으로 세어져 손실 꼬리가 부풀려진다(실측).
 */
import { openDb } from './lib/db.mjs';
import { REALIZED, sqlIn } from './lib/outcome-classes.mjs';
import { fetchBars, walkExit, afterExit, simulate } from './lib/ohlc.mjs';
import { writeFileSync } from 'fs';
import { ROOT } from './lib/project-root.mjs';

const DAYS_BACK = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? 120);
const AFTER_N = 20;              // 청산 뒤 몇 거래일을 볼 것인가 (약 한 달)
const CONCURRENCY = 4;

const db = openDb();
const trades = db.prepare(`
  SELECT r.ticker, date(r.generated_at) gen, r.generated_at gen_iso,
         MIN(r.entry_low) entry_low, MIN(r.entry_high) entry_high,
         AVG(r.stop_loss) stop, AVG(r.target) target, AVG(r.price_at_gen) gen_px,
         COUNT(*) dup, MIN(r.market) market
  FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id
  WHERE r.action = 'buy' AND o.outcome ${sqlIn(REALIZED)}
    AND date(r.generated_at) >= date('now', '-${DAYS_BACK} days')
    AND r.entry_high > 0 AND r.stop_loss > 0 AND r.target > 0
  GROUP BY r.ticker, date(r.generated_at)
  ORDER BY gen
`).all();

const tickers = [...new Set(trades.map((t) => t.ticker))];
const oldest = trades.reduce((m, t) => (t.gen < m ? t.gen : m), trades[0]?.gen ?? '');
console.log(`거래 ${trades.length}건 (중복 제거 전 ${trades.reduce((s, t) => s + t.dup, 0)}행) · 종목 ${tickers.length}개 · ${oldest}~\n`);

// 종목당 한 번만 받는다. 받은 건 캐시에 둔다 — 같은 자료로 여러 가정을 시험해야 한다.
const CACHE = `${process.env.TMPDIR ?? '/tmp'}/flowvium-bars-${DAYS_BACK}d.json`;
const barsBy = new Map();
try {
  const { readFileSync, statSync } = await import('fs');
  if ((Date.now() - statSync(CACHE).mtimeMs) < 6 * 3600e3) {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(CACHE, 'utf8')))) barsBy.set(k, v);
    console.log(`  (캐시 ${barsBy.size} 종목 재사용)`);
  }
} catch { /* 캐시 없으면 받는다 */ }
let done = 0;
async function worker(queue) {
  for (;;) {
    const tk = queue.shift();
    if (!tk) return;
    const r = await fetchBars(tk, oldest, new Date().toISOString());
    if (r?.bars?.length) barsBy.set(tk, r.bars);
    if (++done % 40 === 0) process.stdout.write(`  ...${done}/${tickers.length}\n`);
  }
}
const queue = tickers.filter((t) => !barsBy.has(t));
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
console.log(`일봉 확보 ${barsBy.size}/${tickers.length} 종목\n`);
try { (await import('fs')).writeFileSync(CACHE, JSON.stringify(Object.fromEntries(barsBy))); } catch { /* 캐시 못 써도 진행 */ }

const rows = [];
for (const t of trades) {
  const all = barsBy.get(t.ticker);
  if (!all) continue;
  const from = Date.parse(t.gen_iso);
  const bars = all.filter((b) => b.t >= from - 86400000);
  if (bars.length < 5) continue;
  const w = walkExit({ bars, entryHigh: t.entry_high, stop: t.stop, target: t.target });
  if (w.kind === 'no_entry') continue;
  const entry = t.entry_high;                       // 체결은 진입 상단으로 본다(보수적)
  const pct = (p) => (p - entry) / entry * 100;
  const mfe = isFinite(w.peakBefore) ? pct(w.peakBefore) : null;   // 최대 평가이익
  const mae = isFinite(w.troughBefore) ? pct(w.troughBefore) : null; // 최대 평가손실
  const tgtPct = pct(t.target), stopPct = pct(t.stop);
  const after = w.idx != null ? afterExit(bars, w.idx, AFTER_N) : null;
  rows.push({
    ticker: t.ticker, market: t.market, gen: t.gen, dup: t.dup, kind: w.kind,
    entry, stop: t.stop, target: t.target, tgtPct, stopPct, mfe, mae,
    exitAt: w.at ? new Date(w.at).toISOString().slice(0, 10) : null,
    reachedPctOfTarget: mfe != null && tgtPct > 0 ? mfe / tgtPct * 100 : null,
    afterHighPct: after ? pct(after.high) : null,
    afterLastPct: after ? pct(after.last) : null,
    afterDays: after?.days ?? 0,
  });
}

const n = (a) => a.length;
const avg = (a, f) => a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : null;
const med = (a, f) => { const v = a.map(f).filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const pctOf = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '-';
const f1 = (x) => x == null ? '-' : (x > 0 ? '+' : '') + x.toFixed(1);

const stops = rows.filter((r) => r.kind === 'stop');
const hits  = rows.filter((r) => r.kind === 'target');
const open  = rows.filter((r) => r.kind === 'open');

console.log(`════ 판정 ${rows.length}건 — 손절 ${n(stops)} · 목표도달 ${n(hits)} · 아직보유 ${n(open)}\n`);

console.log('① 손절된 건은 얼마나 갔다가 돌아섰나');
{
  const near = stops.filter((r) => r.reachedPctOfTarget >= 80);
  const half = stops.filter((r) => r.reachedPctOfTarget >= 50);
  const never = stops.filter((r) => r.mfe != null && r.mfe <= 0);
  console.log(`   진입 후 최대 평가이익 중앙값 ${f1(med(stops, (r) => r.mfe))}% (목표는 평균 ${f1(avg(stops, (r) => r.tgtPct))}%)`);
  console.log(`   목표의 80% 이상까지 갔다가 손절 : ${n(near)}건 (${pctOf(n(near), n(stops))})  ← 다 와서 놓친 것`);
  console.log(`   목표의 50% 이상까지 갔다가 손절 : ${n(half)}건 (${pctOf(n(half), n(stops))})`);
  console.log(`   한 번도 플러스가 안 된 채 손절 : ${n(never)}건 (${pctOf(n(never), n(stops))})  ← 진입 자체가 틀린 것`);
}

console.log('\n② 손절한 뒤에 올랐나 (성급했나)');
{
  const back = stops.filter((r) => r.afterHighPct != null && r.afterHighPct >= r.stopPct + 0.01 && r.afterHighPct >= 0);
  const toTgt = stops.filter((r) => r.afterHighPct != null && r.afterHighPct >= r.tgtPct);
  console.log(`   손절 후 ${AFTER_N}거래일 최고가 중앙값 ${f1(med(stops, (r) => r.afterHighPct))}% (진입가 대비)`);
  console.log(`   손절 후 본전 위로 회복      : ${n(back)}건 (${pctOf(n(back), n(stops))})`);
  console.log(`   손절 후 목표까지 도달       : ${n(toTgt)}건 (${pctOf(n(toTgt), n(stops))})  ← 손절이 성급했던 것`);
  console.log(`   손절 후 ${AFTER_N}일 종가 중앙값      ${f1(med(stops, (r) => r.afterLastPct))}%  ← 마이너스면 손절이 옳았다`);
}

console.log('\n③ 목표에 닿아 판 뒤에 더 갔나 (목표가 너무 가까운가)');
{
  const more = hits.filter((r) => r.afterHighPct != null && r.afterHighPct > r.tgtPct * 1.05);
  console.log(`   목표 폭 중앙값 ${f1(med(hits, (r) => r.tgtPct))}% · 손절 폭 중앙값 ${f1(med(rows, (r) => r.stopPct))}%`);
  console.log(`   기대 손익비 (목표/손절) ${med(hits, (r) => r.tgtPct) != null && med(rows, (r) => r.stopPct) ? Math.abs(med(hits, (r) => r.tgtPct) / med(rows, (r) => r.stopPct)).toFixed(2) : '-'} : 1`);
  console.log(`   매도 후 ${AFTER_N}거래일 최고가 중앙값 ${f1(med(hits, (r) => r.afterHighPct))}% (목표는 ${f1(med(hits, (r) => r.tgtPct))}%)`);
  console.log(`   목표보다 5% 이상 더 간 건 : ${n(more)}건 (${pctOf(n(more), n(hits))})  ← 더 기다릴 여지가 있었던 것`);
}

console.log('\n④ 실제로 작게 잃고 크게 벌었나');
{
  const winMfe = med(hits, (r) => r.mfe), lossMae = med(stops, (r) => r.mae);
  console.log(`   이긴 거래 최대이익 중앙값 ${f1(winMfe)}% vs 진 거래 최대손실 중앙값 ${f1(lossMae)}%`);
  const realized = rows.map((r) => r.kind === 'target' ? r.tgtPct : r.kind === 'stop' ? r.stopPct : null).filter((x) => x != null);
  const wins = realized.filter((x) => x > 0), losses = realized.filter((x) => x <= 0);
  console.log(`   실현 기준 평균 이익 ${f1(avg(wins, (x) => x))}% (${wins.length}건) · 평균 손실 ${f1(avg(losses, (x) => x))}% (${losses.length}건)`);
  const exp = (wins.length * (avg(wins, (x) => x) ?? 0) + losses.length * (avg(losses, (x) => x) ?? 0)) / (realized.length || 1);
  console.log(`   기대값 ${f1(exp)}% / 거래`);
}

console.log('\n⑤ 목표를 넓히면 / 손절을 조이면 기대값이 어떻게 되나 (같은 진입, 같은 일봉으로 재판정)');
{
  // 손절 폭을 1 로 두고 목표를 그 몇 배로 잡을 것인가. 실제 값이 1.13 배다.
  const sweep = [];
  for (const k of [1.0, 1.5, 2.0, 2.5, 3.0]) {
    let win = 0, loss = 0, openN = 0, sum = 0;
    for (const t of trades) {
      const all = barsBy.get(t.ticker);
      if (!all) continue;
      const bars = all.filter((b) => b.t >= Date.parse(t.gen_iso) - 86400000);
      if (bars.length < 5) continue;
      const entry = t.entry_high;
      const stopDist = (entry - t.stop) / entry;          // 양수(아래로 몇 %)
      if (!(stopDist > 0)) continue;
      const target = entry * (1 + k * stopDist);
      const w = walkExit({ bars, entryHigh: entry, stop: t.stop, target });
      if (w.kind === 'no_entry') continue;
      if (w.kind === 'stop')       { loss++; sum += -stopDist * 100; }
      else if (w.kind === 'target'){ win++;  sum += k * stopDist * 100; }
      else { openN++; const last = bars.at(-1).c; sum += (last - entry) / entry * 100; }
    }
    const nAll = win + loss + openN;
    sweep.push({ k, win, loss, openN, winRate: win / (win + loss) * 100, exp: sum / nAll });
  }
  console.log('   목표/손절   승   패   보유   승률    기대값/거래');
  for (const s2 of sweep) {
    const mark = Math.abs(s2.k - 1.13) < 0.2 ? '  ← 지금' : '';
    console.log(`   ${s2.k.toFixed(1)}:1      ${String(s2.win).padStart(4)} ${String(s2.loss).padStart(4)} ${String(s2.openN).padStart(5)}   ${s2.winRate.toFixed(0).padStart(3)}%   ${(s2.exp > 0 ? '+' : '') + s2.exp.toFixed(2)}%${mark}`);
  }
  console.log('   → 목표를 넓히면 승률은 떨어지지만 이긴 건이 커진다. 곱이 어디서 제일 큰지 본다.');
}

console.log('\n⑥ 청산 규칙을 바꿔 보면 (같은 진입, 같은 일봉 · 같은 날 둘 다 걸리면 손절 우선)');
{
  const cases = [
    { name: '지금 그대로',              stop: null, target: null, be: null, trail: null },
    { name: '손절 절반으로 조임',        stop: 0.5,  target: null, be: null, trail: null },
    { name: '본전 손절 (+1×손절폭에서)',  stop: null, target: null, be: 1.0,  trail: null },
    { name: '본전 손절 + 목표 없앰',      stop: null, target: 'none', be: 1.0, trail: null },
    { name: '추격 손절 8%',             stop: null, target: 'none', be: null, trail: 0.08 },
    { name: '추격 손절 12%',            stop: null, target: 'none', be: null, trail: 0.12 },
    { name: '추격 12% + 본전 손절',      stop: null, target: 'none', be: 1.0,  trail: 0.12 },
  ];
  console.log('   규칙                          승   패   추격청산  보유   기대값/거래   평균이익  평균손실');
  for (const c of cases) {
    const pnls = []; let win = 0, loss = 0, trail = 0, openN = 0;
    for (const t of trades) {
      const all = barsBy.get(t.ticker);
      if (!all) continue;
      const bars = all.filter((b) => b.t >= Date.parse(t.gen_iso) - 86400000);
      if (bars.length < 5) continue;
      const entry = t.entry_high;
      const baseStop = (entry - t.stop) / entry, baseTgt = (t.target - entry) / entry;
      if (!(baseStop > 0) || !(baseTgt > 0)) continue;
      const r = simulate({
        bars, entryHigh: entry,
        stopPct: baseStop * (c.stop ?? 1),
        targetPct: c.target === 'none' ? null : baseTgt,
        breakevenAt: c.be != null ? baseStop * c.be : null,
        trailPct: c.trail,
      });
      if (r.kind === 'no_entry') continue;
      pnls.push(r.pnlPct);
      if (r.kind === 'target') win++; else if (r.kind === 'stop') loss++; else if (r.kind === 'trail') trail++; else openN++;
    }
    const exp = pnls.reduce((a, b) => a + b, 0) / (pnls.length || 1);
    const ups = pnls.filter((x) => x > 0), dns = pnls.filter((x) => x <= 0);
    const m = (a) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0;
    console.log(`   ${c.name.padEnd(26)} ${String(win).padStart(4)} ${String(loss).padStart(4)} ${String(trail).padStart(7)} ${String(openN).padStart(6)}   `
      + `${((exp > 0 ? '+' : '') + exp.toFixed(2) + '%').padStart(9)}   ${('+' + m(ups).toFixed(1) + '%').padStart(7)}  ${(m(dns).toFixed(1) + '%').padStart(7)}`);
  }
}

const out = `${ROOT}/reports/exit-quality.json`;
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), daysBack: DAYS_BACK, afterN: AFTER_N, rows }, null, 1));
console.log(`\n행 단위 결과: ${out}`);
