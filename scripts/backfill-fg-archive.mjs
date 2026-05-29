#!/usr/bin/env node
/**
 * scripts/backfill-fg-archive.mjs
 * 기존 endpoint_snapshots 의 /api/fear-greed + /api/capital-flows → fg_archive + asset_flow_archive.
 * macro_snapshots 의 fg_score NULL 도 다시 채움.
 */
import { saveFearGreedArchive, openDb } from './lib/db.mjs';
const db = openDb();

const reports = db.prepare(`SELECT id, generated_at FROM reports`).all();
console.log(`reports: ${reports.length}개`);

let ok = 0;
for (const r of reports) {
  try {
    const fgRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/fear-greed'`).get(r.id);
    const cfRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/capital-flows'`).get(r.id);
    if (!fgRow) continue;
    const fg = JSON.parse(fgRow.response_json);
    const cf = cfRow ? JSON.parse(cfRow.response_json) : null;
    saveFearGreedArchive({
      reportId: r.id,
      capturedAt: r.generated_at,
      fgResponse: fg,
      capitalFlowsResponse: cf,
    });
    // macro_snapshots 의 fg_score NULL 채우기
    const usFg = Array.isArray(fg?.byCountry)
      ? fg.byCountry.find(c => c.id === 'us')
      : fg?.byCountry?.us ?? null;
    if (usFg && typeof usFg.score === 'number') {
      db.prepare(`UPDATE macro_snapshots SET fg_score=?, fg_label=? WHERE report_id=?`)
        .run(usFg.score, usFg.level ?? usFg.label ?? null, r.id);
    }
    ok++;
  } catch (e) { console.warn(`  skip ${r.id}: ${String(e).slice(0,80)}`); }
}

console.log(`\n✅ backfilled ${ok}/${reports.length}`);
console.log(`  fg_archive:         ${db.prepare('SELECT COUNT(*) c FROM fg_archive').get().c}`);
console.log(`  asset_flow_archive: ${db.prepare('SELECT COUNT(*) c FROM asset_flow_archive').get().c}`);
const updated = db.prepare(`SELECT COUNT(*) c FROM macro_snapshots WHERE fg_score IS NOT NULL`).get().c;
console.log(`  macro_snapshots.fg_score 채워짐: ${updated}/${db.prepare('SELECT COUNT(*) c FROM macro_snapshots').get().c}`);

// 샘플
const sample = db.prepare(`SELECT captured_at, country, score, level, trend, driver FROM fg_archive ORDER BY captured_at DESC LIMIT 10`).all();
console.log('\n샘플 (최근 10):');
for (const s of sample) console.log(`  ${s.captured_at?.slice(0,10)} ${s.country.padEnd(10)} score=${s.score} level=${(s.level ?? '').padEnd(7)} trend=${(s.trend ?? '').padEnd(8)} ${s.driver?.slice(0,40)}`);
