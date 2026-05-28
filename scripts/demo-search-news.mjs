#!/usr/bin/env node
/**
 * scripts/demo-search-news.mjs
 *
 * news_archive 검색 데모 — 자연어 query + 시점 context auto-join.
 *
 * 실행 예시:
 *   node scripts/demo-search-news.mjs "NVDA"
 *   node scripts/demo-search-news.mjs "Samsung"
 *   node scripts/demo-search-news.mjs "supply"
 *   node scripts/demo-search-news.mjs "CoWoS"
 */
import { searchNewsContext, openDb } from './lib/db.mjs';

const query = process.argv.slice(2).join(' ') || 'NVDA';
console.log(`🔍 Search: "${query}"\n`);

const results = searchNewsContext(query, 10);
console.log(`results: ${results.length}\n`);

for (const r of results) {
  console.log(`[${r.pub_date ?? '?'}] ${r.ticker ?? 'macro'} (${r.source})`);
  console.log(`  📰 ${r.headline.slice(0, 100)}`);
  if (r.summary) console.log(`     ${r.summary.slice(0, 100)}`);
  console.log(`  sentiment=${r.sentiment ?? '-'} importance=${r.importance ?? '-'} signal=${r.signal_type ?? '-'}`);
  console.log(`  📊 그 시점 macro: FG=${r.fg_score ?? '?'}(${r.fg_label ?? ''}) VIX=${r.vix ?? '?'} CPI=${r.cpi ?? '?'}% Fed=${r.fed_rate ?? '?'}% Y10=${r.yield_10y ?? '?'} risk=${r.risk_level ?? '?'}`);
  console.log(`  📑 보고서: ${r.report_id ?? '-'} stance=${r.stance ?? '-'} quality=${r.quality_score ?? '-'}`);
  if (r.pnl_1d != null || r.pnl_5d != null) {
    console.log(`  💹 가격 반응: 1d=${r.pnl_1d ?? '-'}% 5d=${r.pnl_5d ?? '-'}% 30d=${r.pnl_30d ?? '-'}% alpha=${r.alpha_5d ?? '-'}%`);
  } else {
    console.log(`  💹 가격 반응: 미평가 (cron 대기)`);
  }
  console.log('');
}

// 요약 통계
const db = openDb();
console.log('═══ DB 통계 ═══');
console.log(`  news_archive total: ${db.prepare('SELECT COUNT(*) c FROM news_archive').get().c}`);
console.log(`  news_archive_fts:    ${db.prepare('SELECT COUNT(*) c FROM news_archive_fts').get().c}`);
console.log(`  macro_snapshots:     ${db.prepare('SELECT COUNT(*) c FROM macro_snapshots').get().c}`);
console.log(`  news_price_reactions:${db.prepare('SELECT COUNT(*) c FROM news_price_reactions').get().c}`);

// source 분포
console.log('\n  source 분포:');
const src = db.prepare(`SELECT source, COUNT(*) c FROM news_archive GROUP BY source ORDER BY c DESC`).all();
for (const r of src) console.log(`    ${r.source.padEnd(20)} ${r.c}건`);

// ticker 분포 top 10
console.log('\n  ticker 분포 (top 10):');
const tk = db.prepare(`SELECT ticker, COUNT(*) c FROM news_archive WHERE ticker IS NOT NULL GROUP BY ticker ORDER BY c DESC LIMIT 10`).all();
for (const r of tk) console.log(`    ${r.ticker.padEnd(15)} ${r.c}건`);
