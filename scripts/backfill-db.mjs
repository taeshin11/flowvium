#!/usr/bin/env node
/**
 * backfill-db.mjs — reports/*.json 을 SQLite 에 일괄 적재
 *
 * 보고서 + 추천 + (옵션) 엔드포인트 스냅샷 까지 backfill.
 * 사용:
 *   node scripts/backfill-db.mjs                          # 보고서 + 추천만
 *   node scripts/backfill-db.mjs --with-snapshots         # 각 보고서에 대해 현재 엔드포인트 fetch
 *   node scripts/backfill-db.mjs --since=2026-05-09       # 날짜 필터
 *
 * 주의: --with-snapshots 는 보고서 생성 당시가 아닌 "지금" 엔드포인트 응답을 적재.
 *       과거 컨텍스트는 복원 불가 (이미 시간 지남) — 향후 생성 보고서부터 의미 있음.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { openDb, saveReport, saveRecommendations, getSummary } from './lib/db.mjs';
import { snapshotAllEndpoints } from './lib/snapshot-endpoints.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPORTS_DIR = resolve(ROOT, 'reports');
const args = process.argv.slice(2);
const WITH_SNAPS = args.includes('--with-snapshots');
const since = args.find(a => a.startsWith('--since='))?.split('=')[1];

openDb();
const before = getSummary();
console.log(`\n=== backfill-db ${WITH_SNAPS ? '(+snapshots)' : ''} ===`);
console.log(`이전 DB: reports=${before.reports} recs=${before.recs} snapshots=${before.snapshots}\n`);

const files = readdirSync(REPORTS_DIR)
  .filter(f => f.match(/^report-\d{4}-\d{2}-\d{2}-(morning|afternoon|evening)-(ko|en|ja|zh-CN|zh-TW)\.json$/))
  .filter(f => !since || f.includes(since) || f > `report-${since}`)
  .sort();

let savedReports = 0, savedRecs = 0, savedSnaps = 0;
for (const file of files) {
  const path = resolve(REPORTS_DIR, file);
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    const reportId = saveReport(report);
    const recCount = saveRecommendations(report, reportId);
    savedReports++;
    savedRecs += recCount;
    let snapMsg = '';
    if (WITH_SNAPS) {
      const snaps = await snapshotAllEndpoints(reportId);
      savedSnaps += snaps.length;
      const okCount = snaps.filter(r => r.ok).length;
      snapMsg = ` snap=${okCount}/${snaps.length}`;
    }
    console.log(`📦 ${file}  rec=${recCount}${snapMsg}`);
  } catch (e) {
    console.warn(`  ⚠️  ${file}: ${e.message?.slice(0, 100)}`);
  }
}

const after = getSummary();
console.log(`\n=== 합계 ===`);
console.log(`보고서: +${savedReports} (총 ${after.reports})`);
console.log(`추천:   +${savedRecs - (before.recs ? 0 : 0)} (총 ${after.recs})`);
if (WITH_SNAPS) console.log(`스냅샷: +${savedSnaps} (총 ${after.snapshots})`);
console.log(`pending=${after.pending} overdue=${after.overdue}`);
if (after.overdue > 0) console.log(`💡 평가 가능: node scripts/evaluate-recommendations.mjs`);
