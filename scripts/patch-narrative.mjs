#!/usr/bin/env node
// scripts/patch-narrative.mjs — 발행된 보고서 JSON 에 narrative 결정적 corrector 를 적용(in-place).
//   generate-report-local.mjs 와 동일 규칙(scripts/lib/narrative-fix.mjs 단일 source). 재생성 없이
//   라이브 보고서의 sticky 기계환각만 교정 후 --upload 로 재발행하기 위함.
//   지수 등락% 환각 대조를 위해 실시간 일간등락을 직접 fetch.
// 사용: node scripts/patch-narrative.mjs <report.json> [--no-index]
import { readFileSync, writeFileSync } from 'node:fs';
import { correctNarrative, fetchIndexChangeMap } from './lib/narrative-fix.mjs';

const file = process.argv.find((a) => a.endsWith('.json'));
if (!file) { console.error('need <report.json>'); process.exit(1); }
const r = JSON.parse(readFileSync(file, 'utf8'));

let indexMap = {};
if (!process.argv.includes('--no-index')) {
  indexMap = await fetchIndexChangeMap();
  console.log(`[index] 실 일간등락: ${Object.entries(indexMap).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(2)}%`).join(', ') || '(fetch 실패 — 지수대조 skip)'}`);
}

const { nFix, log, realBp } = correctNarrative(r, { indexMap });
if (nFix) {
  writeFileSync(file, JSON.stringify(r, null, 2), 'utf8');
  console.log(`✅ ${nFix}필드 교정 (커브bp→${realBp}): ${log.join(', ')}`);
} else console.log('변경 없음');
