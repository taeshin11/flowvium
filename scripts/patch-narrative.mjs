#!/usr/bin/env node
// scripts/patch-narrative.mjs — 발행된 보고서 JSON 에 narrative 결정적 corrector 를 적용(in-place).
//   generate-report-local.mjs 와 동일 규칙(scripts/lib/narrative-fix.mjs 단일 source). 재생성 없이
//   라이브 보고서의 sticky 기계환각만 교정 후 --upload 로 재발행하기 위함.
//   지수 등락% 환각 대조를 위해 실시간 일간등락을 직접 fetch.
// 사용: node scripts/patch-narrative.mjs <report.json> [--no-index]
import { readFileSync, writeFileSync } from 'node:fs';
import { correctNarrative, fetchIndexChangeMap, sanitizeReport, fixDuplicateCentralBankEvents, attributePctSubjects, dedupeThesisMacro } from './lib/narrative-fix.mjs';

const file = process.argv.find((a) => a.endsWith('.json'));
if (!file) { console.error('need <report.json>'); process.exit(1); }
const r = JSON.parse(readFileSync(file, 'utf8'));

let indexMap = {};
if (!process.argv.includes('--no-index')) {
  indexMap = await fetchIndexChangeMap();
  console.log(`[index] 실 일간등락: ${Object.entries(indexMap).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(2)}%`).join(', ') || '(fetch 실패 — 지수대조 skip)'}`);
}

// 2026-07-04 (thesis 품질): 등락% 주어 귀속 풀 — 이 보고서 발간 시점의 capital-flows DB 스냅샷(실값 대조).
let pctPool = [];
try {
  const { openDb } = await import('./lib/db.mjs');
  const db = openDb();
  const row = r.id
    ? db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/capital-flows'`).get(r.id)
    : db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE endpoint='/api/capital-flows' ORDER BY captured_at DESC LIMIT 1`).get();
  const cap = row ? JSON.parse(row.response_json) : {};
  pctPool = [...(cap.assets ?? []), ...(cap.countryFlow?.countries ?? []), ...(cap.sectorPerformance ?? []), ...(cap.factorPerformance ?? [])]
    .filter((e) => e?.ticker && (Number.isFinite(e.ret1w) || Number.isFinite(e.ret4w)))
    .map((e) => ({ ticker: e.ticker, label: e.label, values: [e.ret1w, e.ret4w] }));
} catch (e) { console.warn(`[pool] capital-flows 스냅샷 로드 실패 — 주어귀속 skip (${e.message})`); }

const { nFix, log, realBp } = correctNarrative(r, { indexMap });
const { nFix: nAttr, log: attrLog } = attributePctSubjects(r, pctPool);
const { nFix: nDup } = dedupeThesisMacro(r);
const { nFix: nSan } = sanitizeReport(r);
const { nFix: nCB } = fixDuplicateCentralBankEvents(r);
if (nFix || nSan || nCB || nAttr || nDup) {
  writeFileSync(file, JSON.stringify(r, null, 2), 'utf8');
  console.log(`✅ 교정 — narrative ${nFix}필드(${log.join(',')||'-'}; 커브bp→${realBp}) + 주어귀속 ${nAttr}건(${attrLog.join(', ') || '-'}) + thesis복붙 ${nDup}문장 + 전역 garble ${nSan}건 + 중복중앙은행 ${nCB}건`);
} else console.log('변경 없음');
