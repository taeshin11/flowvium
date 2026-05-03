/**
 * check-static-fallbacks.mjs — API route 정적 데이터 폴백 감사
 *
 * 발생 경위: institutionalSignals (Q4 2025 13F 하드코딩) 가 여러 API route에서
 * Redis miss 폴백으로 사용되어 stale 데이터가 실시간처럼 표시됨 (2026-05-03).
 *
 * 이 스크립트가 하는 일:
 *   1. src/app/api/ + src/lib/ 파일에서 @/data/ 값 import 탐지
 *   2. 해당 파일의 응답에 source 필드가 있는지 확인
 *   3. verify-metrics 에 해당 엔드포인트 probe가 있는지 확인
 *
 * 허용 목록 (설계상 정적이 맞는 경우):
 *   - colors, sector labels, company relationship graph (구조/설정 데이터)
 *   - cascade historical occurrences (과거 역사 기록)
 *   - market-cap band enum (연 단위 변경)
 *
 * 사용: node scripts/check-static-fallbacks.mjs
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = resolve(ROOT, 'src/app/api');
const LIB_DIR = resolve(ROOT, 'src/lib');
const VERIFY_METRICS_PATH = resolve(ROOT, 'src/app/api/cron/verify-metrics/route.ts');

// 허용 목록 — 이 파일들은 정적 데이터 사용이 설계상 허용됨
const ALLOWED = new Set([
  'src/app/api/market-caps/route.ts',          // enum bands (연 단위), source: 'static' 명시됨
  'src/app/api/market-heatmap/route.ts',        // SECTOR_COLORS (색상, 변경 없음)
  'src/app/api/cron/log-cascade-events/route.ts', // cascadePatterns (관계 구조 설정)
  'src/lib/daily-brief.ts',                     // newsGapData → AI prompt 재료 (사용자 직접 노출 아님)
  'src/lib/news-gap-service.ts',                // source: 'static' 명시, getNewsGapData() 투명 처리
]);

// type-only import 패턴 (문제 아님)
const TYPE_IMPORT_RE = /import\s+type\s+[{(]/;

// 값 import 패턴: import { something } from '@/data/...' (type 키워드 없음)
const VALUE_IMPORT_RE = /^import\s+(?!type\s)\{([^}]+)\}\s+from\s+'@\/data\//m;
const VALUE_IMPORT_MULTI = /import\s+(?!type\s)\{[^}]+\}\s+from\s+'@\/data\//g;

function walkDir(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) results.push(...walkDir(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) results.push(full);
  }
  return results;
}

function getRelPath(abs) {
  return relative(ROOT, abs).replace(/\\/g, '/');
}

function hasSourceField(content) {
  // source: 'live' | source: 'static' | source: 'cached' | source: dataSource 등
  return /source:\s*['"`]?(live|static|cached|unknown)|source,\s|,\s*source\s*[,}]|instSource|ownership13FSource|analysisSource/.test(content);
}

function hasVerifyProbe(verifyContent, endpointPath) {
  // /api/signals → accuracy.signals.source 또는 market.signals 등
  const seg = endpointPath.replace(/^\/api\//, '').replace(/\//g, '.');
  return verifyContent.includes(endpointPath) || verifyContent.includes(seg);
}

// verify-metrics 내용 로드
let verifyContent = '';
try { verifyContent = readFileSync(VERIFY_METRICS_PATH, 'utf8'); } catch { /* ignore */ }

const files = [
  ...walkDir(API_DIR),
  ...walkDir(LIB_DIR),
];

const issues = [];
const allowed = [];
const clean = [];

for (const file of files) {
  const rel = getRelPath(file);
  const content = readFileSync(file, 'utf8');

  // @/data/ 값 import 탐지
  const valueImports = [...content.matchAll(VALUE_IMPORT_MULTI)];
  if (valueImports.length === 0) continue;

  // type-only import만 있는 경우 제외
  const hasOnlyTypeImports = valueImports.every(m => {
    const lineStart = content.lastIndexOf('\n', m.index) + 1;
    const line = content.slice(lineStart, content.indexOf('\n', m.index));
    return line.includes('import type');
  });
  if (hasOnlyTypeImports) continue;

  // 허용 목록
  if (ALLOWED.has(rel)) {
    allowed.push({ file: rel, imports: valueImports.map(m => m[0].slice(0, 60)) });
    continue;
  }

  // source 필드 확인
  const hasSrc = hasSourceField(content);

  // verify-metrics probe 확인 (API route만)
  let hasProbe = true;
  let endpointGuess = '';
  if (rel.startsWith('src/app/api/') && rel.endsWith('/route.ts')) {
    endpointGuess = '/' + rel.replace('src/app/', '').replace('/route.ts', '');
    hasProbe = hasVerifyProbe(verifyContent, endpointGuess);
  }

  if (!hasSrc || !hasProbe) {
    issues.push({
      file: rel,
      imports: valueImports.map(m => m[0].trim().slice(0, 80)),
      missingSource: !hasSrc,
      missingProbe: !hasProbe && endpointGuess !== '',
      endpoint: endpointGuess,
    });
  } else {
    clean.push(rel);
  }
}

// ── 결과 출력 ──────────────────────────────────────────────────────────────────
console.log('\n🔍 FlowVium 정적 데이터 폴백 감사\n');
console.log(`스캔: src/app/api/ + src/lib/ | ${files.length}개 파일\n`);

if (allowed.length) {
  console.log(`✅ 허용 목록 (설계상 정적 허용): ${allowed.length}개 파일`);
  for (const a of allowed) console.log(`   ${a.file}`);
  console.log('');
}

if (clean.length) {
  console.log(`✅ 정상 (source 필드 + probe 있음): ${clean.length}개 파일`);
  for (const c of clean) console.log(`   ${c}`);
  console.log('');
}

if (issues.length === 0) {
  console.log('🎉 문제 없음 — 모든 정적 데이터 폴백이 올바르게 처리됨\n');
  process.exit(0);
}

console.log(`⚠️  수정 필요: ${issues.length}개 파일\n`);
for (const issue of issues) {
  console.log(`  📄 ${issue.file}`);
  for (const imp of issue.imports) console.log(`     import: ${imp}`);
  if (issue.missingSource) {
    console.log(`     ❌ 응답에 source 필드 없음`);
    console.log(`        → 추가 필요: source: liveData ? 'live' : 'static'`);
  }
  if (issue.missingProbe) {
    console.log(`     ❌ verify-metrics에 probe 없음 (endpoint: ${issue.endpoint})`);
    console.log(`        → verify-metrics/route.ts 에 accuracy probe 추가 필요`);
  }
  console.log('');
}

console.log('📖 규칙: CLAUDE.md → "정적 데이터 폴백 금지 규칙" 참고\n');

// 경고만 출력 (빌드 실패 아님)
process.exit(0);
