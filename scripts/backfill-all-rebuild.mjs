#!/usr/bin/env node
/**
 * scripts/backfill-all-rebuild.mjs — 매핑 fix 후 모든 archive 재구축.
 *
 * 기존 row 삭제 → fix 된 helper 로 재적재. 매번 실행 가능 (idempotent).
 */
import {
  saveNewsArchive, saveMacroSnapshot, saveDomainArchives, saveFearGreedArchive, openDb,
} from './lib/db.mjs';

const db = openDb();

// 1) 모든 archive 비우기 (fts 도 함께 — 트리거)
console.log('▶ 기존 archive 삭제...');
db.exec(`
  DELETE FROM news_archive;
  DELETE FROM macro_snapshots;
  DELETE FROM short_squeeze_archive;
  DELETE FROM earnings_archive;
  DELETE FROM insider_archive;
  DELETE FROM fg_archive;
  DELETE FROM asset_flow_archive;
`);

const reports = db.prepare(`SELECT id, generated_at, full_json, locale FROM reports ORDER BY generated_at`).all();
console.log(`reports: ${reports.length}개 처리 시작\n`);

let ok = 0;
for (const r of reports) {
  try {
    const d = JSON.parse(r.full_json);
    // 1. macro_snapshots (endpoint_snapshots 직접 query)
    const fgRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/fear-greed'`).get(r.id);
    const macroRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/macro-indicators'`).get(r.id);
    const cfRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/capital-flows'`).get(r.id);
    const ctxRaw = {
      fearGreed: fgRow ? JSON.parse(fgRow.response_json) : null,
      macro: macroRow ? JSON.parse(macroRow.response_json) : null,
      capital: cfRow ? JSON.parse(cfRow.response_json) : null,
    };
    saveMacroSnapshot({ reportId: r.id, capturedAt: r.generated_at, ctxRaw, macroData: { riskLevel: d.riskLevel } });
    saveNewsArchive({
      reportId: r.id, locale: r.locale ?? 'ko',
      newsArticles: d.newsCascade?.articles ?? [],
      supplyChainChanges: d.supplyChainChanges ?? [],
      companyChanges: d.companyChanges ?? [],
    });
    saveDomainArchives({
      reportId: r.id, capturedAt: r.generated_at,
      shortSqueeze: d.shortSqueeze ?? [],
      companyChanges: d.companyChanges ?? [],
      insiderSignals: d.insiderSignals ?? [],
    });
    saveFearGreedArchive({
      reportId: r.id, capturedAt: r.generated_at,
      fgResponse: ctxRaw.fearGreed,
      capitalFlowsResponse: ctxRaw.capital,
    });
    ok++;
  } catch (e) { console.warn(`  skip ${r.id}: ${String(e).slice(0,80)}`); }
}

console.log(`\n✅ rebuild ${ok}/${reports.length}`);
const stats = {
  news_archive: db.prepare('SELECT COUNT(*) c FROM news_archive').get().c,
  macro_snapshots: db.prepare('SELECT COUNT(*) c FROM macro_snapshots').get().c,
  short_squeeze: db.prepare('SELECT COUNT(*) c FROM short_squeeze_archive').get().c,
  earnings: db.prepare('SELECT COUNT(*) c FROM earnings_archive').get().c,
  insider: db.prepare('SELECT COUNT(*) c FROM insider_archive').get().c,
  fg: db.prepare('SELECT COUNT(*) c FROM fg_archive').get().c,
  asset_flow: db.prepare('SELECT COUNT(*) c FROM asset_flow_archive').get().c,
};
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(18)} ${v}`);
