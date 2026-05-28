#!/usr/bin/env node
/**
 * scripts/backfill-news-archive.mjs
 *
 * 기존 reports + endpoint_snapshots 의 news/supply/companyChange 데이터를 news_archive
 * 테이블로 retroactive 적재. 새 schema 도입 전 보고서들도 검색 가능하게 함.
 *
 * 실행: node scripts/backfill-news-archive.mjs
 */
import { saveNewsArchive, saveMacroSnapshot, openDb } from './lib/db.mjs';

const db = openDb();

// 1) 모든 reports 의 full_json 에서 supplyChainChanges + companyChanges 추출 → news_archive 적재
const reports = db.prepare(`SELECT id, generated_at, full_json, locale FROM reports`).all();
console.log(`reports: ${reports.length}개`);

let totalNews = 0;
let totalMacroSnap = 0;
let reportsProcessed = 0;
const PROGRESS_EVERY = 10;

for (const r of reports) {
  try {
    const d = JSON.parse(r.full_json);
    const newsCount = saveNewsArchive({
      reportId: r.id,
      locale: r.locale ?? 'ko',
      newsArticles: d.newsCascade?.articles ?? [],  // 보고서 안 newsCascade (있을 경우)
      supplyChainChanges: d.supplyChainChanges ?? [],
      companyChanges: d.companyChanges ?? [],
    });
    totalNews += newsCount;

    // macro_snapshots 추출 — full_json 의 macroAnalysis 텍스트에서 일부 값만
    // 더 정확한 데이터는 endpoint_snapshots 의 /api/macro-indicators row 에 있음
    const fgRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/fear-greed'`).get(r.id);
    const macroRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/macro-indicators'`).get(r.id);
    const ycRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/yield-curve'`).get(r.id);
    const capRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/capital-flows'`).get(r.id);

    const ctxRaw = {
      fearGreed: fgRow ? JSON.parse(fgRow.response_json) : null,
      macro: macroRow ? JSON.parse(macroRow.response_json) : null,
      yieldCurve: ycRow ? JSON.parse(ycRow.response_json) : null,
      capital: capRow ? JSON.parse(capRow.response_json) : null,
    };
    saveMacroSnapshot({
      reportId: r.id,
      capturedAt: r.generated_at,
      ctxRaw,
      macroData: { riskLevel: d.riskLevel },
    });
    totalMacroSnap++;
  } catch (e) {
    console.warn(`  ⚠️ ${r.id} skip: ${String(e).slice(0, 80)}`);
  }
  reportsProcessed++;
  if (reportsProcessed % PROGRESS_EVERY === 0) {
    console.log(`  ${reportsProcessed}/${reports.length} processed (news=${totalNews})`);
  }
}

console.log(`\n✅ backfill 완료:`);
console.log(`  - news_archive 신규 row: ${totalNews}`);
console.log(`  - macro_snapshots: ${totalMacroSnap}`);

// FTS5 검증
const fts = db.prepare(`SELECT COUNT(*) c FROM news_archive_fts`).get();
console.log(`  - news_archive_fts: ${fts.c} entries`);
