#!/usr/bin/env node
/**
 * scripts/satellite-correlation.mjs — 위성 활동 vs outcome 상관관계 backtest.
 *
 * 1개월+ 데이터 축적 후 실행하여 위성 시스템 ROI 측정:
 *   - factory activity_score → 해당 ticker outcome 영향
 *   - activity high (60+) → hit_target 비율 증가하나?
 *   - activity delta (전일 대비 +20%) → 다음 14일 pnl 영향?
 *
 * 의미 있으면 유지, 없으면 폐기 결정 근거.
 *
 * 사용:
 *   1) scripts/sync-satellite-to-db.mjs 매일 cron (Vercel → 로컬 SQLite 동기화)
 *   2) 1개월 후 이 스크립트 실행 → keep/drop 권고
 */
import Database from 'better-sqlite3';

const DB_PATH = 'C:/NoAddsMakingApps/FlowVium/data/flowvium.db';
const db = new Database(DB_PATH, { readonly: true });
const PAD = (s, n) => String(s ?? '').padEnd(n);

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  위성 활동 vs Outcome 상관관계 — ' + new Date().toISOString().slice(0,19) + ' ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// satellite_observations 테이블 있나?
const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='satellite_observations'").get();
if (!hasTable) {
  console.log('❌ satellite_observations 테이블 없음');
  console.log('   먼저 scripts/sync-satellite-to-db.mjs 실행 필요 (Vercel endpoint → 로컬 SQLite)');
  process.exit(1);
}

// 1. 데이터 가용성
const counts = db.prepare(`
  SELECT
    COUNT(*) AS obs_count,
    COUNT(DISTINCT ticker) AS tickers,
    MIN(observed_at) AS first,
    MAX(observed_at) AS last
  FROM satellite_observations
`).get();
console.log('=== [1] satellite_observations 가용성 ===');
console.log(`  관측 수: ${counts.obs_count}, ticker: ${counts.tickers}`);
console.log(`  기간: ${counts.first?.slice(0,10)} → ${counts.last?.slice(0,10)}`);

if (counts.obs_count < 100) {
  console.log('\n⚠️  관측 수 < 100 — 통계적 의미 부족. 더 축적 후 재실행 권장.');
  process.exit(0);
}

// 2. ticker별 평균 activity vs hit rate
console.log('\n=== [2] Ticker별 위성 활동 vs hit rate ===');
const corr = db.prepare(`
  SELECT
    r.ticker,
    AVG(s.activity_score) AS avg_activity,
    COUNT(DISTINCT s.observed_at) AS obs_days,
    COUNT(DISTINCT r.id) AS rec_count,
    SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN o.outcome IN ('hit_target','stop_loss','still_holding') THEN 1 ELSE 0 END) AS entered,
    AVG(CASE WHEN o.outcome != 'not_entered' THEN o.pnl_pct END) AS avg_pnl
  FROM recommendations r
  JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  LEFT JOIN satellite_observations s
    ON s.ticker = r.ticker
    AND s.observed_at >= date(r.generated_at, '-7 days')
    AND s.observed_at <= date(r.generated_at)
  WHERE r.action = 'buy'
  GROUP BY r.ticker
  HAVING obs_days >= 5 AND rec_count >= 3
  ORDER BY avg_activity DESC
`).all();

console.log('  ticker      avg_act  obs  recs  hits/entered  hit%   avg_pnl');
for (const r of corr) {
  const hitPct = r.entered > 0 ? (r.hits / r.entered * 100).toFixed(0) : '-';
  console.log(`  ${PAD(r.ticker, 10)} ${PAD((r.avg_activity ?? 0).toFixed(1), 8)} ${PAD(r.obs_days, 4)} ${PAD(r.rec_count, 5)} ${PAD(r.hits+'/'+r.entered, 12)} ${PAD(hitPct+'%', 6)} ${(r.avg_pnl ?? 0).toFixed(2)}%`);
}

// 3. 위성 활동 high (>=60) vs low (<60) 그룹 비교
console.log('\n=== [3] 활동 점수 그룹 비교 (high vs low) ===');
const groups = db.prepare(`
  WITH t AS (
    SELECT r.id, r.ticker, o.outcome, o.pnl_pct,
      AVG(s.activity_score) AS avg_act
    FROM recommendations r
    JOIN recommendation_outcomes o ON o.recommendation_id = r.id
    LEFT JOIN satellite_observations s
      ON s.ticker = r.ticker
      AND s.observed_at BETWEEN date(r.generated_at, '-7 days') AND date(r.generated_at)
    WHERE r.action = 'buy'
    GROUP BY r.id
    HAVING avg_act IS NOT NULL
  )
  SELECT
    CASE WHEN avg_act >= 60 THEN 'high' ELSE 'low' END AS grp,
    COUNT(*) AS n,
    SUM(CASE WHEN outcome='hit_target' THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN outcome='stop_loss' THEN 1 ELSE 0 END) AS stops,
    SUM(CASE WHEN outcome='not_entered' THEN 1 ELSE 0 END) AS ne,
    AVG(CASE WHEN outcome != 'not_entered' THEN pnl_pct END) AS avg_pnl
  FROM t GROUP BY grp
`).all();
for (const g of groups) {
  const entered = g.n - g.ne;
  console.log(`  ${PAD(g.grp, 6)} n=${g.n} hit=${g.hits} stop=${g.stops} ne=${g.ne}  hit_rate=${entered ? (g.hits/entered*100).toFixed(0) : '-'}%  avg_pnl=${(g.avg_pnl ?? 0).toFixed(2)}%`);
}

if (groups.length === 2) {
  const high = groups.find(g => g.grp === 'high');
  const low = groups.find(g => g.grp === 'low');
  if (high && low && high.n >= 10 && low.n >= 10) {
    const highRate = high.hits / (high.n - high.ne);
    const lowRate = low.hits / (low.n - low.ne);
    const lift = (highRate - lowRate) * 100;
    const pnlLift = (high.avg_pnl ?? 0) - (low.avg_pnl ?? 0);
    console.log(`\n  📊 high vs low lift: hit_rate +${lift.toFixed(1)}pp, avg_pnl +${pnlLift.toFixed(2)}%`);
    if (Math.abs(lift) < 3 && Math.abs(pnlLift) < 1) {
      console.log('  ❌ 의미 있는 차이 없음 (lift < 3pp + pnl < 1%) → 위성 시스템 폐기 권장');
    } else if (lift > 5 || pnlLift > 2) {
      console.log('  ✅ 유의미한 효과 — 시스템 유지 + 24개 시설 부활 검토');
    } else {
      console.log('  ⚠️  marginal effect — 1개월 더 축적 후 재평가');
    }
  } else {
    console.log('\n  ⚠️  표본 부족 (각 그룹 < 10) — 통계적 결론 보류');
  }
}

db.close();
