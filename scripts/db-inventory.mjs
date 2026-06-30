#!/usr/bin/env node
/**
 * scripts/db-inventory.mjs — DB 적재 항목 전체 인벤토리.
 */
import Database from 'better-sqlite3';
const db = new Database('C:/Flowvium/data/flowvium.db', { readonly: true });

const tables = db.prepare(`
  SELECT name, type FROM sqlite_master
  WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE '%_fts_%' AND name NOT LIKE '%_data' AND name NOT LIKE '%_idx' AND name NOT LIKE '%_docsize' AND name NOT LIKE '%_config' AND name NOT LIKE '%_content'
  ORDER BY name
`).all();

console.log('═══════════════════════════════════════════════════════════');
console.log('  FlowVium DB 전체 인벤토리 (data/flowvium.db)');
console.log('═══════════════════════════════════════════════════════════\n');

let totalRows = 0;
for (const t of tables) {
  const isFts = t.name.endsWith('_fts');
  let count = 0;
  try { count = db.prepare(`SELECT COUNT(*) c FROM ${t.name}`).get().c; } catch { count = '?'; }
  if (typeof count === 'number') totalRows += count;
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all().map(c => c.name);
  console.log(`📋 ${t.name}  (${count} rows${isFts ? ', FTS5 검색 인덱스' : ''})`);
  console.log(`   columns: ${cols.join(', ')}`);
  console.log();
}

console.log(`총 row 수: ${totalRows.toLocaleString()}\n`);

// 적재 흐름 요약
console.log('═══ 적재 흐름 (매 보고서 cycle) ═══\n');
console.log(`1. saveReport(finalReport)`);
console.log(`   → reports (1 row)`);
console.log(`     id, generated_at, session, locale, source, stance, risk_level, thesis,`);
console.log(`     quality_score, full_json (전체 JSON), audit_json (harness)\n`);

console.log(`2. saveRecommendations(finalReport, reportId)`);
console.log(`   → recommendations (6-8 rows, 각 portfolio 종목)`);
console.log(`     ticker, market, sector, action, confidence, allocation,`);
console.log(`     entry_low/high, target, target_bull, stop_loss, price_at_gen,`);
console.log(`     currency, rationale, evaluate_after (14d 후)\n`);

console.log(`3. saveNewsArchive({newsArticles, supplyChainChanges, companyChanges})`);
console.log(`   → news_archive (10-15 rows/cycle, dedup INSERT OR IGNORE)`);
console.log(`     external_id (dedup), source (news-cascade/supply-chain/company-change),`);
console.log(`     ticker, headline, summary, pub_date, sentiment, importance,`);
console.log(`     signal_type, direction, link, cascades_json, report_id\n`);

console.log(`4. saveMacroSnapshot({ctxRaw, macroData})`);
console.log(`   → macro_snapshots (1 row/cycle, REPLACE)`);
console.log(`     fg_score/label, vix, cpi, fed_rate, yield_10y/2y/spread,`);
console.log(`     hy/ig_oas, gdp_growth, spy/qqq_close, risk_level\n`);

console.log(`5. snapshotAllEndpoints(reportId)`);
console.log(`   → endpoint_snapshots (20 rows/cycle, 각 endpoint)`);
console.log(`     endpoint, captured_at, http_status, source, ok,`);
console.log(`     response_json (전체 응답 보관), duration_ms\n`);

console.log(`═══ 후처리 cron (별도) ═══\n`);

console.log(`6. evaluate-recommendations.mjs (수동/cron)`);
console.log(`   → recommendation_outcomes (recommendation_id 별 1 row)`);
console.log(`     evaluated_at, price_at_eval, outcome (hit/stop/NE/holding),`);
console.log(`     pnl_pct, ohlc_days, high/low_seen, spy_return, quality_score\n`);

console.log(`7. (예정) news 후 가격 반응 cron`);
console.log(`   → news_price_reactions`);
console.log(`     news_id, ticker, pub_date, pnl_1d/5d/30d, alpha_5d\n`);

// 사용 통계
const recent7d = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM reports WHERE generated_at >= datetime('now','-7 days')) AS reports,
    (SELECT COUNT(*) FROM recommendations WHERE generated_at >= datetime('now','-7 days')) AS recommendations,
    (SELECT COUNT(*) FROM recommendation_outcomes WHERE evaluated_at >= datetime('now','-7 days')) AS outcomes,
    (SELECT COUNT(*) FROM news_archive WHERE captured_at >= datetime('now','-7 days')) AS news,
    (SELECT COUNT(*) FROM macro_snapshots WHERE captured_at >= datetime('now','-7 days')) AS macro_snaps,
    (SELECT COUNT(*) FROM endpoint_snapshots WHERE captured_at >= datetime('now','-7 days')) AS endpoint_snaps
`).get();
console.log('═══ 최근 7일 적재량 ═══');
console.log(`  reports:             ${recent7d.reports}`);
console.log(`  recommendations:     ${recent7d.recommendations}`);
console.log(`  recommendation_outcomes: ${recent7d.outcomes}`);
console.log(`  news_archive:        ${recent7d.news}`);
console.log(`  macro_snapshots:     ${recent7d.macro_snaps}`);
console.log(`  endpoint_snapshots:  ${recent7d.endpoint_snaps}`);

// DB 크기
import { statSync } from 'fs';
const size = statSync('C:/Flowvium/data/flowvium.db').size;
console.log(`\nDB 파일 크기: ${(size / 1024 / 1024).toFixed(1)} MB`);
