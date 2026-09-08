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
import { readFileSync, writeFileSync, renameSync } from 'fs';
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

// ── [3.5] 룰별 outcome 귀속 → score 백튜닝 (2026-06-16: 사용자 "그 중 좋은 것만 학습해야지") ───────
//   기존 [1~3] 은 *집계* hitRate 만 — 어느 룰이 좋은 결과를 냈는지 score 에 반영 안 됨(매도측엔 ruleEdge
//   있는데 매수측 비대칭). 선정 매수후보(buy_candidates.selected=1)의 matched_rules 를 그 추천의 종결
//   outcome(hit/stop)·pnl·alpha 와 join → 룰별 edge 산출 → edge>0(좋은 룰) score↑, edge<0 score↓.
//   표본 < MIN_SAMPLE 룰은 미변경(얇은 데이터 과적합 방지 — 데이터 쌓이면 자동 활성).
const MIN_SAMPLE = 5, MAX_CHANGE_PCT = 0.20, SCORE_MIN = 1, SCORE_MAX = 10;
const ruleOutcomeRows = db.prepare(`
  SELECT bc.matched_rules AS rules, o.outcome AS outcome, o.pnl_pct AS pnl, o.spy_return AS spy
  FROM recommendations r
  JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  JOIN buy_candidates bc ON bc.ticker = r.ticker AND bc.report_id = r.report_id AND bc.selected = 1
  -- 2026-09-07: 여기서 **'sold' 를 통째로 빼고** 있었다. 종결 1,527건 중 776건이 sold 인데,
  --   매도엔진이 목표 전에 **이익 상태로 파는** 경우가 대부분이다(전체 수익률 63.9%).
  --   그걸 빼면 "목표에 닿았나" 만 남고, 이익으로 팔아 준 룰은 점수를 한 푼도 못 받는다.
  --   실제로 오늘 제안 4건이 전부 감점이었고 사유가 모두 hit=0% 였다.
  --   손익이 채워진 것만 넣는다 — --verify 가 매일 채운다(2026-09-07 신설).
  WHERE o.outcome IN ('hit_target', 'stop_loss', 'sold')
    AND o.pnl_pct IS NOT NULL
`).all();
const ruleEdge = {}; // id → { n, hits, stops, pnlSum, alphaSum, alphaN, hitRate, avgPnl, avgAlpha, edge }
for (const row of ruleOutcomeRows) {
  const ids = new Set();
  try { for (const x of JSON.parse(row.rules || '[]')) { const id = typeof x === 'string' ? x : (x.ruleId || x.id); if (id) ids.add(id); } } catch { /* skip */ }
  const alpha = (row.pnl != null && row.spy != null) ? row.pnl - row.spy : null;
  for (const id of ids) {
    const e = ruleEdge[id] ?? (ruleEdge[id] = { n: 0, hits: 0, stops: 0, wins: 0, losses: 0, pnlSum: 0, alphaSum: 0, alphaN: 0 });
    e.n++;
    if (row.outcome === 'hit_target') e.hits++; else if (row.outcome === 'stop_loss') e.stops++;
    // 성공의 정의를 **손익 부호**로 바꾼다. 목표에 닿지 않아도 이익으로 팔았으면 성공이다.
    if (row.pnl > 0) e.wins++; else e.losses++;
    if (row.pnl != null) e.pnlSum += row.pnl;
    if (alpha != null) { e.alphaSum += alpha; e.alphaN++; }
  }
}
for (const e of Object.values(ruleEdge)) {
  const term = e.hits + e.stops;
  e.hitRate = term > 0 ? e.hits / term : 0;           // 목표 도달률(참고용으로 남긴다)
  const wl = e.wins + e.losses;
  e.winRate = wl > 0 ? e.wins / wl : 0;               // **수익 낸 비율 — 이게 성공이다**
  e.avgPnl = e.n > 0 ? e.pnlSum / e.n : 0;
  e.avgAlpha = e.alphaN > 0 ? e.alphaSum / e.alphaN : 0;
  // edge = 수익률(−1..+1)*0.6 + 알파(±10%p→±1)*0.4 — 양수=좋은 룰, 음수=역효과
  const hitComp = (e.winRate - 0.5) * 2;
  const alphaComp = Math.max(-1, Math.min(1, e.avgAlpha / 10));
  e.edge = Math.round((hitComp * 0.6 + alphaComp * 0.4) * 100) / 100;
}
const ruleProposals = [];
for (const r of spec.rules) {
  // 2026-06-19(ChatGPT 지적): ban/veto 등 음수·구조적 룰은 자동튜닝 금지 — SCORE_MIN clamp(=1)이 -100 을 +1 로
  //   뒤집어 *금지 종목이 매수 가점*으로 변하는 치명버그. tunable:false 또는 score<=0 룰은 현 score 고정.
  if (r.tunable === false || r.score <= 0) {
    ruleProposals.push({ id: r.id, category: r.category, n: ruleEdge[r.id]?.n ?? 0, edge: null, current: r.score, proposed: r.score, changed: false, reason: '구조적 룰(튜닝 제외)' });
    continue;
  }
  const e = ruleEdge[r.id];
  if (!e || e.n < MIN_SAMPLE) {
    ruleProposals.push({ id: r.id, category: r.category, n: e?.n ?? 0, edge: e?.edge ?? null, current: r.score, proposed: r.score, changed: false, reason: `표본부족(n=${e?.n ?? 0}<${MIN_SAMPLE})` });
    continue;
  }
  const mult = 1 + Math.max(-MAX_CHANGE_PCT, Math.min(MAX_CHANGE_PCT, e.edge * MAX_CHANGE_PCT));
  // 2026-09-09: 조정 폭이 `edge × 20%` 라 **낮은 점수는 영원히 못 움직인다.**
  //   실측: price_pullback_50ma 는 표본 107건에 **수익 69%·평균 +2.31%** 인데 점수가 3이다.
  //   3 × (1 + 0.31×0.20) = 3.19 → 반올림 3. 아무리 좋아도 그대로다.
  //   이 룰들이 3으로 내려간 이유가 **틀린 기준**(목표 도달만 세던 시절)이었는데,
  //   기준을 고쳐도 스스로 못 돌아온다. 갇힌 것을 풀어 준다.
  //   표본이 충분하고(30건+) 방향이 뚜렷하면(|edge| >= 0.2) **최소 한 칸**은 움직인다.
  //   한 칸씩이라 급격하지 않다 — 주 1회니까 잘못돼도 다음 주에 되돌아온다.
  let proposed = Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(r.score * mult)));
  if (proposed === r.score && e.n >= 30 && Math.abs(e.edge) >= 0.2) {
    proposed = Math.max(SCORE_MIN, Math.min(SCORE_MAX, r.score + (e.edge > 0 ? 1 : -1)));
  }
  ruleProposals.push({ id: r.id, category: r.category, n: e.n, hitRate: Math.round(e.hitRate * 100), winRate: Math.round(e.winRate * 100), avgAlpha: Math.round(e.avgAlpha * 10) / 10, edge: e.edge, current: r.score, proposed, changed: proposed !== r.score, reason: proposed !== r.score ? `edge=${e.edge} → ×${mult.toFixed(2)}` : `edge=${e.edge}(변화없음)` });
}
const tunable = ruleProposals.filter((p) => p.n >= MIN_SAMPLE);
const changes = ruleProposals.filter((p) => p.changed);
console.log(`\n▶ [3.5] 룰별 outcome 백튜닝 ("좋은 것만 학습")`);
console.log(`  종결 outcome 귀속 ${ruleOutcomeRows.length}건 → 표본충족 룰 ${tunable.length}/${spec.rules.length}, 조정 제안 ${changes.length}`);
for (const p of changes) console.log(`    ${p.id.padEnd(24)} score ${p.current}→${p.proposed} (${p.reason}; n=${p.n}, 수익=${p.winRate ?? p.hitRate}%, α=${p.avgAlpha}%)`);
if (!tunable.length) console.log(`  (아직 룰당 종결 outcome ${MIN_SAMPLE}건 미만 — 데이터 축적 시 자동 활성. 매 발간 outcome 평가로 채워짐.)`);
spec.ruleEdge = Object.fromEntries(Object.entries(ruleEdge).map(([k, v]) => [k, { n: v.n, hitRate: Math.round(v.hitRate * 100), winRate: Math.round(v.winRate * 100), avgAlpha: Math.round(v.avgAlpha * 10) / 10, edge: v.edge }]));

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
  // [3.5] 룰별 outcome 백튜닝 score 적용 (표본충족 룰만 — 위에서 changed 판정)
  for (const p of changes) { const rule = spec.rules.find((x) => x.id === p.id); if (rule) rule.score = p.proposed; }
  try { writeFileSync(RULES_PATH + '.bak', readFileSync(RULES_PATH)); } catch {}
  // 2026-06-19(ChatGPT #1): 원자적 교체 — 부분 JSON race 방지(loader hot-reload).
  writeFileSync(RULES_PATH + '.tmp', JSON.stringify(spec, null, 2) + '\n', 'utf8');
  renameSync(RULES_PATH + '.tmp', RULES_PATH);
  console.log(`\n✅ buy-rules-tuned.json 적용 — outcomeStats 갱신 (n=${total}, hitRate ${spec.outcomeStats.hitRate}%) + 룰 score 백튜닝 ${changes.length}건`);
} else {
  console.log(`\n[dry-run] buy-rules-tuned.json 미적용 (--apply 로 적용). outcomeStats n=${total}, hitRate ${spec.outcomeStats.hitRate}%, avgAlpha ${spec.outcomeStats.avgAlpha}% | 룰 백튜닝 제안 ${changes.length}건 (표본충족 ${tunable.length})`);
}

db.close();
