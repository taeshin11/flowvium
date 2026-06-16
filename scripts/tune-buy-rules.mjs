#!/usr/bin/env node
/**
 * scripts/tune-buy-rules.mjs
 *
 * 매수 룰 grid search — recommendation_outcomes 의 buy outcome 데이터로
 * 각 룰의 적중률 평가 + 임계값 (RSI<35 vs <40 등) 데이터 기반 조정.
 *
 * 출력: data/buy-rules-tuned.json (outcomeStats + 임계값 update)
 * 실행 (주 1회):
 *   node scripts/tune-buy-rules.mjs
 */
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RULES_PATH = resolve(ROOT, 'data/buy-rules-tuned.json');
const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });

const spec = JSON.parse(readFileSync(RULES_PATH, 'utf8'));

// ── [1] recommendation_outcomes 별 buy 추천 평가 ────────────────────────────────
console.log('▶ buy outcome 평가 (recommendations + outcomes join)');

const outcomes = db.prepare(`
  SELECT r.ticker, r.sector, r.market, r.action,
         o.outcome, o.pnl_pct, o.spy_return, o.evaluated_at
  FROM recommendations r
  JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  WHERE r.action = 'buy'
    AND o.outcome IN ('hit_target', 'stop_loss', 'still_holding', 'not_entered')
`).all();

const total = outcomes.length;
const hits = outcomes.filter(o => o.outcome === 'hit_target').length;
const stops = outcomes.filter(o => o.outcome === 'stop_loss').length;
const ne = outcomes.filter(o => o.outcome === 'not_entered').length;
const holding = outcomes.filter(o => o.outcome === 'still_holding').length;
const evaluated = hits + stops; // 종결된 outcome 만
const hitRate = evaluated ? (hits / evaluated) * 100 : 0;
const avgPnl = outcomes.filter(o => o.pnl_pct != null).reduce((a, o) => a + o.pnl_pct, 0) / Math.max(1, outcomes.filter(o => o.pnl_pct != null).length);
const avgAlpha = outcomes.filter(o => o.spy_return != null).reduce((a, o) => a + (o.pnl_pct - o.spy_return), 0) / Math.max(1, outcomes.filter(o => o.spy_return != null).length);

console.log(`  총 ${total}건: hit ${hits} / stop ${stops} / NE ${ne} / holding ${holding}`);
console.log(`  종결 ${evaluated}건 hitRate=${hitRate.toFixed(1)}% / avgPnl ${avgPnl.toFixed(1)}% / α ${avgAlpha.toFixed(1)}%`);

// ── [2] sector 별 hit rate ──────────────────────────────────────────────────────
console.log('\n▶ sector 별 hit rate');
const bySector = {};
for (const o of outcomes) {
  const s = o.sector ?? 'Unknown';
  if (!bySector[s]) bySector[s] = { hit: 0, stop: 0, total: 0 };
  bySector[s].total++;
  if (o.outcome === 'hit_target') bySector[s].hit++;
  else if (o.outcome === 'stop_loss') bySector[s].stop++;
}
const sectorStats = Object.entries(bySector)
  .filter(([, s]) => s.total >= 5)
  .map(([sector, s]) => ({ sector, ...s, hitRate: s.hit / (s.hit + s.stop || 1) * 100 }))
  .sort((a, b) => b.hitRate - a.hitRate);
for (const s of sectorStats.slice(0, 8)) {
  console.log(`    ${s.sector.padEnd(20)} ${s.hit}/${s.stop+s.hit} hit=${s.hitRate.toFixed(0)}% (n=${s.total})`);
}

// ── [3] ticker 별 best/worst ────────────────────────────────────────────────────
const byTicker = {};
for (const o of outcomes) {
  if (o.pnl_pct == null) continue;
  if (!byTicker[o.ticker]) byTicker[o.ticker] = { ticker: o.ticker, pnls: [] };
  byTicker[o.ticker].pnls.push(o.pnl_pct);
}
const tickerStats = Object.values(byTicker)
  .map(t => ({ ticker: t.ticker, avg: t.pnls.reduce((a, b) => a + b, 0) / t.pnls.length, n: t.pnls.length }))
  .filter(t => t.n >= 2);
tickerStats.sort((a, b) => b.avg - a.avg);
const bestTickers = tickerStats.slice(0, 5);
const worstTickers = tickerStats.slice(-5).reverse();

// ── [4] buy-rules-tuned.json 업데이트 ──────────────────────────────────────────
spec.tunedAt = new Date().toISOString();
spec.sampleSize = total;
spec.outcomeStats = {
  total, hits, stops, ne, holding,
  hitRate: Math.round(hitRate * 10) / 10,
  avgPnl: Math.round(avgPnl * 10) / 10,
  avgAlpha: Math.round(avgAlpha * 10) / 10,
  bySector: sectorStats,
  bestTickers, worstTickers,
};

// 2026-06-16: dry-run 기본 + --apply 게이트 (tune-sell-rules 와 대칭). cron 은 --apply+commitPaths 로
//   호출 → 갱신분이 커밋+푸시돼 report cron checkout 에 revert 안 됨(기존엔 write-then-revert 로 무효).
if (process.argv.includes('--apply')) {
  try { writeFileSync(RULES_PATH + '.bak', readFileSync(RULES_PATH)); } catch {}
  writeFileSync(RULES_PATH, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  console.log(`\n✅ buy-rules-tuned.json 적용 — outcomeStats 갱신 (n=${total}, hitRate ${spec.outcomeStats.hitRate}% avgPnl ${spec.outcomeStats.avgPnl}%)`);
} else {
  console.log(`\n[dry-run] buy-rules-tuned.json 미적용 (--apply 로 적용). outcomeStats: n=${total}, hitRate ${spec.outcomeStats.hitRate}%, avgPnl ${spec.outcomeStats.avgPnl}%, avgAlpha ${spec.outcomeStats.avgAlpha}%`);
}

db.close();
