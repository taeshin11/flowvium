#!/usr/bin/env node
/**
 * scripts/stats-advanced.mjs ???ъ옄 ?깃낵 ?뺣웾 遺꾩꽍 (Sharpe / Profit Factor / Bayesian / Calibration).
 *
 * ?곗텧 吏??
 *  - Sharpe ratio (risk-adjusted return, mean/std 횞 ??52)
 *  - Sortino ratio (downside std留?
 *  - Profit factor (total wins / total losses)
 *  - Expectancy (嫄곕옒??湲곕?媛?
 *  - Alpha vs SPY (benchmark ?鍮?
 *  - Max drawdown (cumulative pnl 理쒕? ?먯떎)
 *  - Bayesian posterior CI (Beta-Binomial, ?묒? sample ?좊ː援ш컙)
 *  - Brier score (confidence calibration)
 *  - Time-to-target (hit_target ?됯퇏 ?쇱닔)
 *  - Herfindahl (吏묒쨷??
 */
import Database from 'better-sqlite3';

const db = new Database('C:/Flowvium/data/flowvium.db', { readonly: true });
const PAD = (s, n) => String(s ?? '').padEnd(n);

console.log('?붴븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??);
console.log('?? ?ъ옄 ?깃낵 ?뺣웾 遺꾩꽍 ??' + new Date().toISOString().slice(0,19) + '          ??);
console.log('?싢븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??n');

// 吏꾩엯??buy 異붿쿇 + outcome
const rows = db.prepare(`
  SELECT r.ticker, r.action, r.confidence, r.sector, r.allocation,
         r.entry_high, r.target, r.stop_loss, r.generated_at,
         o.outcome, o.pnl_pct, o.spy_return, o.evaluated_at, o.ohlc_days
  FROM recommendations r
  JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  WHERE r.action = 'buy' AND o.outcome != 'not_entered' AND o.pnl_pct IS NOT NULL
`).all();

const ne = db.prepare(`
  SELECT COUNT(*) AS c FROM recommendation_outcomes o
  JOIN recommendations r ON r.id = o.recommendation_id
  WHERE r.action='buy' AND o.outcome='not_entered'
`).get().c;

const totalBuy = rows.length + ne;
console.log(`?뱤 吏꾩엯??buy 異붿쿇: ${rows.length} (NE ?쒖쇅) / ?꾩껜 buy: ${totalBuy}\n`);

// ?? [1] 湲곕낯 stats ??????????????????????????????????????????????????????????
const pnls = rows.map(r => r.pnl_pct);
const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
const variance = pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / (pnls.length - 1);
const std = Math.sqrt(variance);
const wins = pnls.filter(p => p > 0);
const losses = pnls.filter(p => p < 0);
const winRate = wins.length / pnls.length;
const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
const profitFactor = losses.length ? Math.abs(wins.reduce((a, b) => a + b, 0) / losses.reduce((a, b) => a + b, 0)) : Infinity;
const expectancy = (winRate * avgWin) + ((1 - winRate) * avgLoss);

console.log('=== [1] ?듭떖 吏??===');
console.log(`  ?됯퇏 pnl:      ${mean.toFixed(2)}% (sample n=${pnls.length})`);
console.log(`  ?쒖??몄감:      ${std.toFixed(2)}%`);
console.log(`  Win rate:      ${(winRate * 100).toFixed(1)}% (${wins.length}/${pnls.length})`);
console.log(`  ?됯퇏 win:      +${avgWin.toFixed(2)}%`);
console.log(`  ?됯퇏 loss:     ${avgLoss.toFixed(2)}%`);
console.log(`  Profit factor: ${profitFactor.toFixed(2)} (>1.5 ?묓샇, >2.0 ?곗닔)`);
console.log(`  Expectancy:    ${expectancy.toFixed(2)}% / 嫄곕옒`);

// ?? [2] Sharpe / Sortino ?????????????????????????????????????????????????????
// 14???덈룄??湲곗? ???고솚??
const ANNUALIZE = Math.sqrt(252 / 14);
const RISK_FREE = 0.045 / (252 / 14); // ??4.5% / 14?쇰떦
const sharpe = (mean - RISK_FREE) / std * ANNUALIZE;
const downside = pnls.filter(p => p < RISK_FREE);
const downsideStd = downside.length ? Math.sqrt(downside.reduce((a, b) => a + (b - RISK_FREE) ** 2, 0) / downside.length) : std;
const sortino = (mean - RISK_FREE) / downsideStd * ANNUALIZE;

console.log('\n=== [2] Risk-adjusted (?고솚?? ===');
console.log(`  Sharpe ratio:  ${sharpe.toFixed(2)}  (>1 ?묓샇, >2 ?곗닔, >3 ?곸썡)`);
console.log(`  Sortino ratio: ${sortino.toFixed(2)}  (downside-only 蹂?숈꽦, Sharpe蹂대떎 ?좊ː)`);

// ?? [3] Alpha vs SPY ????????????????????????????????????????????????????????
const withSpy = rows.filter(r => r.spy_return != null);
const alphas = withSpy.map(r => r.pnl_pct - r.spy_return);
const avgAlpha = alphas.length ? alphas.reduce((a, b) => a + b, 0) / alphas.length : 0;
const beatBenchmark = withSpy.filter(r => r.pnl_pct > r.spy_return).length;
console.log('\n=== [3] Benchmark (SPY) ?鍮?===');
console.log(`  ?됯퇏 ?뚰뙆:     +${avgAlpha.toFixed(2)}% (SPY ?鍮?`);
console.log(`  SPY 珥덇낵 鍮꾩쑉: ${(beatBenchmark / withSpy.length * 100).toFixed(0)}% (${beatBenchmark}/${withSpy.length})`);

// ?? [4] Max drawdown (?ы듃?대━???꾩쟻) ???????????????????????????????????????
// allocation 媛以??꾩쟻 pnl
const sortedByDate = [...rows].sort((a, b) => (a.generated_at ?? '').localeCompare(b.generated_at ?? ''));
let cumPnl = 0, peak = 0, maxDD = 0;
for (const r of sortedByDate) {
  const weight = (r.allocation ?? 10) / 100;
  cumPnl += r.pnl_pct * weight;
  if (cumPnl > peak) peak = cumPnl;
  const dd = peak - cumPnl;
  if (dd > maxDD) maxDD = dd;
}
console.log('\n=== [4] Drawdown ===');
console.log(`  ?꾩쟻 媛以?pnl: ${cumPnl.toFixed(1)}% (allocation 媛以?`);
console.log(`  Max drawdown:  ${maxDD.toFixed(2)}%`);
console.log(`  Calmar ratio:  ${maxDD > 0 ? (mean / maxDD).toFixed(2) : '??} (return / max DD)`);

// ?? [5] Bayesian posterior ??ticker蹂??곸쨷瑜??좊ː援ш컙 ????????????????????????
function betaCI(hits, total, ci = 0.95) {
  // Beta(慣=hits+1, 棺=total-hits+1), Jeffreys/Beta prior
  // Approximate CI via Wilson score or numerical inversion
  // Wilson score interval (醫 ??robust)
  if (total === 0) return [0, 1];
  const z = 1.96;
  const p = hits / total;
  const center = (p + z * z / (2 * total)) / (1 + z * z / total);
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / (1 + z * z / total);
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

console.log('\n=== [5] Ticker蹂?Bayesian 95% CI ===');
const tickerStats = {};
for (const r of rows) {
  const t = tickerStats[r.ticker] ?? { hits: 0, total: 0, pnls: [] };
  t.total++;
  if (r.outcome === 'hit_target') t.hits++;
  t.pnls.push(r.pnl_pct);
  tickerStats[r.ticker] = t;
}
console.log('  ticker      n   hits  raw_rate  95% CI         avg_pnl');
Object.entries(tickerStats)
  .filter(([, s]) => s.total >= 3)
  .sort((a, b) => (b[1].hits / b[1].total) - (a[1].hits / a[1].total))
  .forEach(([t, s]) => {
    const [lo, hi] = betaCI(s.hits, s.total);
    const avgT = s.pnls.reduce((a, b) => a + b, 0) / s.pnls.length;
    const reliable = s.total >= 7 ? '?? : ' ';
    console.log(`  ${reliable} ${PAD(t, 10)} ${PAD(s.total, 3)} ${PAD(s.hits, 4)} ${PAD((s.hits/s.total*100).toFixed(0)+'%', 8)} [${(lo*100).toFixed(0)}-${(hi*100).toFixed(0)}%]    ${avgT.toFixed(2)}%`);
  });
console.log('  (??= n?? ?좊ː. ?묒? sample? CI 留ㅼ슦 ?볦쓬)');

// ?? [6] Confidence calibration ??Brier score ?????????????????????????????????
// confidence='high' 異붿쿇??????留욌뒗媛?
console.log('\n=== [6] Confidence calibration ===');
const confLevels = ['high', 'medium', 'low'];
const confMap = { high: 0.7, medium: 0.5, low: 0.3 };
let totalBrier = 0, nBrier = 0;
for (const r of rows) {
  if (!r.confidence) continue;
  const expected = confMap[r.confidence] ?? 0.5;
  const actual = r.outcome === 'hit_target' ? 1 : 0;
  totalBrier += (expected - actual) ** 2;
  nBrier++;
}
const brier = nBrier ? totalBrier / nBrier : 0;
console.log(`  Brier score: ${brier.toFixed(3)} (0=?꾨꼍, 0.25=臾댁?, 1=?뺣컲?)`);
for (const lvl of confLevels) {
  const sub = rows.filter(r => r.confidence === lvl);
  if (!sub.length) continue;
  const hits = sub.filter(r => r.outcome === 'hit_target').length;
  console.log(`    ${PAD(lvl, 8)} n=${sub.length}  hit_rate=${(hits/sub.length*100).toFixed(0)}%  (expected ${(confMap[lvl]*100).toFixed(0)}%)`);
}

// ?? [7] Time-to-target ???????????????????????????????????????????????????????
const hits = rows.filter(r => r.outcome === 'hit_target' && r.ohlc_days);
if (hits.length) {
  const days = hits.map(r => r.ohlc_days);
  const meanDays = days.reduce((a, b) => a + b, 0) / days.length;
  const sortedDays = [...days].sort((a, b) => a - b);
  const medianDays = sortedDays[Math.floor(sortedDays.length / 2)];
  console.log('\n=== [7] Time-to-target (hit源뚯? ?됯퇏 ?쇱닔) ===');
  console.log(`  ?됯퇏: ${meanDays.toFixed(1)}?? median: ${medianDays}?? range: [${Math.min(...days)}, ${Math.max(...days)}]`);
}

// ?? [8] Herfindahl (?ы듃?대━??吏묒쨷?? ????????????????????????????????????????
const totalAlloc = rows.reduce((s, r) => s + (r.allocation ?? 0), 0);
const allocByTicker = {};
for (const r of rows) {
  allocByTicker[r.ticker] = (allocByTicker[r.ticker] ?? 0) + (r.allocation ?? 0);
}
const shares = Object.values(allocByTicker).map(a => a / totalAlloc);
const herfindahl = shares.reduce((s, x) => s + x * x, 0);
const effectiveN = 1 / herfindahl;
console.log('\n=== [8] 吏묒쨷??(Herfindahl) ===');
console.log(`  HHI: ${(herfindahl * 10000).toFixed(0)}  (>2500=吏묒쨷, <1500=?ㅺ컖??`);
console.log(`  Effective N (?ㅽ슚 醫낅ぉ??: ${effectiveN.toFixed(1)}`);

// ?? [9] Sector 蹂??꾪뿕-?섏씡 ??????????????????????????????????????????????????
console.log('\n=== [9] Sector蹂?Sharpe ===');
const sectorMap = {};
for (const r of rows) {
  if (!r.sector) continue;
  const s = sectorMap[r.sector] ?? { pnls: [] };
  s.pnls.push(r.pnl_pct);
  sectorMap[r.sector] = s;
}
Object.entries(sectorMap)
  .filter(([, s]) => s.pnls.length >= 3)
  .map(([sector, s]) => {
    const m = s.pnls.reduce((a, b) => a + b, 0) / s.pnls.length;
    const v = s.pnls.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, s.pnls.length - 1);
    const sd = Math.sqrt(v);
    const sh = sd > 0 ? (m - RISK_FREE) / sd * ANNUALIZE : 0;
    return { sector, n: s.pnls.length, mean: m, sd, sharpe: sh };
  })
  .sort((a, b) => b.sharpe - a.sharpe)
  .forEach(s => {
    console.log(`  ${PAD(s.sector, 28)} n=${PAD(s.n,3)} mean=${s.mean.toFixed(2)}% sd=${s.sd.toFixed(2)}%  Sharpe=${s.sharpe.toFixed(2)}`);
  });

db.close();
