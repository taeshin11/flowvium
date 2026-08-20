#!/usr/bin/env node
/**
 * eval-ic-shadow.mjs — IC 가중 선정을 shadow 로 기록·평가한다 (live 선정 미참여).
 *
 * 배경: 총점 합산의 초과수익 상관이 r=0.333, IC 가중은 r=0.663 (2026-08-20 실측 n=59).
 *   그러나 상위 K 선택에서는 두 방식이 같은 종목을 뽑아 실익이 확인되지 않았다.
 *   이 시스템의 승격 기준(n≥30 + edge)을 따라, 선정에 바로 쓰지 않고 발화만 기록해
 *   전향 성적을 쌓는다. shadow-rules 파이프라인과 같은 철학이다.
 *
 * 출력: reports/ic-shadow.json — 매 실행마다 두 랭킹의 상위 K 와 실현 성과를 누적.
 * 사용: node scripts/eval-ic-shadow.mjs [--k=6] [--min-sample=15]
 */
import { writeFileSync, existsSync, readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { ROOT } from './lib/project-root.mjs';
import { realizedPnlPct } from './lib/realized-pnl.mjs';
import { deriveRuleIC, icWeightedScore } from './lib/rule-ic.mjs';

const K = Number((process.argv.find(a => a.startsWith('--k=')) ?? '').split('=')[1] || 6);
const MIN = Number((process.argv.find(a => a.startsWith('--min-sample=')) ?? '').split('=')[1] || 15);
const OUT = `${ROOT}/reports/ic-shadow.json`;

const ic = deriveRuleIC({ dbPath: `${ROOT}/data/flowvium.db`, minSample: MIN });
if (!ic.length) { console.log('IC 표본 부족 — 기록 생략(지어내지 않음)'); process.exit(0); }

const db = new Database(`${ROOT}/data/flowvium.db`, { readonly: true });
const rows = db.prepare(`
  SELECT bc.ticker, bc.total_score, bc.matched_rules, bc.report_id,
         o.outcome, o.price_at_eval, o.spy_return,
         r.entry_low, r.price_at_gen, r.target, r.stop_loss, r.generated_at
  FROM buy_candidates bc
  JOIN recommendations r ON r.ticker = bc.ticker AND r.report_id = bc.report_id
  JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  WHERE r.action != 'watch'`).all()
  .map(r => {
    const pnl = realizedPnlPct({ outcome: r.outcome, entry: r.entry_low ?? r.price_at_gen, stop: r.stop_loss, target: r.target, lastClose: r.price_at_eval });
    let ids = []; try { ids = [...new Set(JSON.parse(r.matched_rules || '[]').map(m => m.ruleId ?? m))]; } catch {}
    return { ...r, ids, pnl, ex: (pnl != null && r.spy_return != null) ? pnl - r.spy_return : null, icw: icWeightedScore(ids, ic) };
  })
  .filter(r => r.ex != null);

const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
// 종목 단위로 중복 제거 후 상위 K. 같은 종목이 여러 보고서에 반복 추천되므로
//   그대로 자르면 상위 6개가 전부 같은 이름이 된다(실제로 AAPL 6회였다).
//   포트폴리오는 같은 이름을 K번 담지 않으므로, 종목당 최고 점수 1건만 남긴다.
const dedupeBest = (arr, key) => {
  const best = new Map();
  for (const r of arr) {
    const cur = best.get(r.ticker);
    if (!cur || r[key] > cur[key]) best.set(r.ticker, r);
  }
  return [...best.values()].sort((a, b) => b[key] - a[key]);
};
const byScore = dedupeBest(rows, 'total_score').slice(0, K);
const byIC    = dedupeBest(rows, 'icw').slice(0, K);
const overlap = byScore.filter(x => byIC.some(y => y.ticker === x.ticker && y.report_id === x.report_id)).length;

const rec = {
  evaluatedAt: new Date().toISOString(), k: K, minSample: MIN, sample: rows.length, distinctTickers: new Set(rows.map(r => r.ticker)).size,
  icTable: ic,
  totalScore: { pickedExcess: +avg(byScore.map(r => r.ex)).toFixed(3), tickers: byScore.map(r => r.ticker) },
  icWeighted: { pickedExcess: +avg(byIC.map(r => r.ex)).toFixed(3), tickers: byIC.map(r => r.ticker) },
  overlapCount: overlap,
  note: '선정 미참여. 표본이 쌓이면 두 방식의 상위 K 실현 초과수익을 비교해 승격 여부를 판단한다.',
};
const hist = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { runs: [] };
hist.runs.push(rec);
writeFileSync(OUT, JSON.stringify(hist, null, 2));

console.log(`IC shadow 기록 (n=${rows.length}, K=${K})`);
console.log(`  총점 상위${K}  초과수익 ${rec.totalScore.pickedExcess >= 0 ? '+' : ''}${rec.totalScore.pickedExcess}%p  ${rec.totalScore.tickers.join(' ')}`);
console.log(`  IC 상위${K}    초과수익 ${rec.icWeighted.pickedExcess >= 0 ? '+' : ''}${rec.icWeighted.pickedExcess}%p  ${rec.icWeighted.tickers.join(' ')}`);
console.log(`  겹침 ${overlap}/${K} · 누적 ${hist.runs.length}회 → ${OUT}`);
