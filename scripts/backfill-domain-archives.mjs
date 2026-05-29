#!/usr/bin/env node
/**
 * scripts/backfill-domain-archives.mjs
 * 기존 reports → short_squeeze / earnings / insider 아카이브 retroactive 적재.
 */
import { saveDomainArchives, openDb } from './lib/db.mjs';
const db = openDb();
const reports = db.prepare(`SELECT id, generated_at, full_json FROM reports`).all();
console.log(`reports: ${reports.length}개`);
let ok = 0;
for (const r of reports) {
  try {
    const d = JSON.parse(r.full_json);
    saveDomainArchives({
      reportId: r.id,
      capturedAt: r.generated_at,
      shortSqueeze: d.shortSqueeze ?? [],
      companyChanges: d.companyChanges ?? [],
      insiderSignals: d.insiderSignals ?? [],
    });
    ok++;
  } catch (e) { console.warn(`  skip ${r.id}: ${String(e).slice(0,80)}`); }
}
console.log(`\n✅ backfilled ${ok}/${reports.length}`);
console.log(`  short_squeeze_archive: ${db.prepare('SELECT COUNT(*) c FROM short_squeeze_archive').get().c}`);
console.log(`  earnings_archive:      ${db.prepare('SELECT COUNT(*) c FROM earnings_archive').get().c}`);
console.log(`  insider_archive:       ${db.prepare('SELECT COUNT(*) c FROM insider_archive').get().c}`);
