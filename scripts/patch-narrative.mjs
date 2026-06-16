#!/usr/bin/env node
// scripts/patch-narrative.mjs — 발행된 보고서 JSON 에 narrative 결정적 corrector 를 적용(in-place).
//   generate-report-local.mjs 의 narrative-corrector 와 동일 규칙. 재생성 없이 라이브 보고서의
//   sticky 기계환각(커브 bp·오타·라틴·% 자금흐름)만 교정 후 --upload 로 재발행하기 위함.
// 사용: node scripts/patch-narrative.mjs <report.json>
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('need <report.json>'); process.exit(1); }
const r = JSON.parse(readFileSync(file, 'utf8'));

const realSlopePp = r.marketVerdict?.analog?.fingerprint?.curveSlopePp ?? r.marketVerdict?.analog?.macroContext?.curveSlopePp;
const realBp = realSlopePp != null ? Math.round(realSlopePp * 100) : null;

function fixField(s) {
  if (typeof s !== 'string' || !s) return s;
  let t = s;
  if (realBp != null) t = t.replace(/(금리\s*(?:곡선|커브)[^.]{0,12}?)([+-]?\d{1,3})(\s*bp)/g, `$1${realBp}$3`);
  t = t.replace(/나스다크/g, '나스닥').replace(/콘텡고|콘텐고|콘탕고|컨텐고|컨티아고|컨텐코/g, '콘탱고');
  t = t.replace(/스que이즈/g, '스퀴즈').replace(/스퀴이즈/g, '스퀴즈');
  t = t.replace(/\d{1,2}(?:\.\d)?\s*%\s*(유입|순매수)/g, '$1');
  t = t.replace(/(유입|순매수)[^.,]{0,12}?\d{1,2}(?:\.\d)?\s*%(?:로|까지|으로)?\s*(확대|증가|상승)/g, '$1 $2');
  return t;
}

let n = 0;
const log = [];
for (const k of ['thesis', 'macroAnalysis', 'technicalAnalysis', 'fundamentalAnalysis', 'topOpportunity', 'hedgingSuggestion']) {
  const b = r[k], a = fixField(b);
  if (a !== b) { r[k] = a; n++; log.push(`  ${k}: 교정`); }
}
if (r.marketNarrative) for (const k of ['why', 'story', 'watch']) {
  const b = r.marketNarrative[k], a = fixField(b);
  if (a !== b) { r.marketNarrative[k] = a; n++; log.push(`  marketNarrative.${k}: 교정`); }
}
if (n) {
  writeFileSync(file, JSON.stringify(r, null, 2), 'utf8');
  console.log(`✅ ${n}필드 교정 (커브bp→${realBp}):\n${log.join('\n')}`);
} else console.log('변경 없음');
