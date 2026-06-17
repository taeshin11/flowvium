/**
 * check-static-fallbacks.mjs — API route 정적 데이터 폴백 감사
 *
 * 발생 경위:
 *   - 2026-05-03: institutionalSignals (Q4 2025 13F 하드코딩) Redis miss 폴백으로 stale 노출
 *   - 2026-05-05: credit-balance DATA 배열의 histPercentile/riskLevel/changeYoY 가
 *     historical 배열 변경 시에도 업데이트되지 않아 게이지 마커와 불일치 발생
 *
 * 이 스크립트가 하는 일:
 *   1. src/app/api/ + src/lib/ 파일에서 @/data/ 값 import 탐지
 *   2. 같은 파일 내 const DATA/STATIC 배열 정의 탐지 (Pattern A)
 *   3. DATA 배열 내 파생 분석 필드 리터럴 탐지 (Pattern B) — 동적 계산 필요
 *   4. 해당 파일의 응답에 source 필드가 있는지 확인
 *   5. verify-metrics 에 해당 엔드포인트 probe가 있는지 확인
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
  'src/app/api/market-caps/route.ts',          // bands enum 정적 (categorical) + caps 30개 라이브; source: 'live'|'partial'|'error'
  'src/app/api/market-heatmap/route.ts',        // SECTOR_COLORS (색상, 변경 없음)
  'src/app/api/cron/log-cascade-events/route.ts', // cascadePatterns (관계 구조 설정)
  'src/lib/daily-brief.ts',                     // newsGapData → AI prompt 재료 (사용자 직접 노출 아님)
  'src/lib/news-gap-service.ts',                // source: 'static' 명시, getNewsGapData() 투명 처리
  'src/lib/ishares-holdings.ts',                // UNIVERSE_SEARCH 는 ticker/name/sector(구조 메타)만 사용 — marketValue/weight/price 는 Naver 라이브 quote(없으면 skip), 정적 시세 폴백 아님 (2026-06-05 검증)
]);

// type-only import 패턴 (문제 아님)
const TYPE_IMPORT_RE = /import\s+type\s+[{(]/;

// 값 import 패턴: import { something } from '@/data/...' (type 키워드 없음)
const VALUE_IMPORT_RE = /^import\s+(?!type\s)\{([^}]+)\}\s+from\s+'@\/data\//m;
const VALUE_IMPORT_MULTI = /import\s+(?!type\s)\{[^}]+\}\s+from\s+'@\/data\//g;

// Pattern A: 같은 파일 내 static DATA 배열 정의
// (const DATA = [...], const STATIC_FOO = [...], const FALLBACK_BAR = [...])
const INLINE_DATA_ARRAY_RE = /const\s+(DATA|STATIC_\w+|FALLBACK_\w+|HARDCODED_\w+)\s*(?::\s*\w[^=]*)?\s*=\s*\[/g;

// Pattern B: DATA 배열 내 파생 분석 필드 리터럴 — 이런 값은 historical 배열로부터 동적 계산해야 함
// 예: histPercentile: 78, riskLevel: 'high', changeYoY: -9.2, signal: 'bearish'
const DERIVED_FIELD_PATTERNS = [
  { re: /histPercentile\s*:\s*\d+/g,                               name: 'histPercentile (숫자 리터럴 — historical 배열에서 동적 계산 필요)' },
  { re: /riskLevel\s*:\s*['"](?:low|medium|high|extreme)['"]/g,    name: 'riskLevel (문자열 리터럴 — histPercentile에서 동적 계산 필요)' },
  { re: /changeYoY\s*:\s*[+-]?\d+(?:\.\d+)?(?!\s*\*)/g,           name: 'changeYoY (숫자 리터럴 — historical 배열 마지막 두 항목으로 동적 계산 필요)' },
  { re: /signal\s*:\s*['"](?:bullish|bearish|neutral|buy|sell)['"]/g, name: 'signal (문자열 리터럴 — 가격 데이터에서 동적 계산 필요)' },
  { re: /stance\s*:\s*['"](?:bullish|bearish|neutral)['"]/g,       name: 'stance (문자열 리터럴 — 시장 데이터에서 동적 계산 필요)' },
  { re: /gdpRatioRank\s*:\s*['"](?:low|medium|high|extreme)['"]/g, name: 'gdpRatioRank (문자열 리터럴 — gdpRatio에서 동적 계산 필요)' },
];

// Pattern A+B 허용 목록 — 이 파일들의 inline DATA 배열 또는 파생 필드 리터럴은 설계상 허용
const INLINE_DATA_ALLOWED = new Set([
  'src/app/api/credit-balance/route.ts',         // DATA 배열 있지만 파생값은 이제 동적 계산됨
  'src/app/api/cascade-events/route.ts',         // 역사적 사건 기록 (변경 없는 과거 데이터)
  'src/app/api/market-heatmap/route.ts',         // SECTOR_COLORS (색상 설정)
  'src/app/api/investment-strategy/route.ts',    // riskLevel:'medium' — source:'fallback' 명시된 최후 중립 fallback
                                                 // stance:'bullish' — AI 생성 응답 검증/파싱용 타입 가드
]);

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
  // source: '<any string>' | source: <variable> | source 단축형 | 알려진 source 변수명
  // 2026-05-10: source 값 화이트리스트 → 임의 문자열 허용 (live/mixed/static/krx/edgar-form4 등 모든 패턴 인정)
  return /source:\s*['"`][^'"`]+['"`]|source:\s*[a-zA-Z_]\w*[,}\s]|source,\s|,\s*source\s*[,}]|instSource|ownership13FSource|analysisSource/.test(content);
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
const inlineDataIssues = [];  // Pattern A+B issues
const allowed = [];
const clean = [];

for (const file of files) {
  const rel = getRelPath(file);
  const content = readFileSync(file, 'utf8');

  // ── Pattern A+B: 같은 파일 내 inline DATA 배열 탐지 ──────────────────────────
  if (rel.startsWith('src/app/api/') && rel.endsWith('/route.ts') && !INLINE_DATA_ALLOWED.has(rel)) {
    const inlineArrays = [...content.matchAll(INLINE_DATA_ARRAY_RE)];
    if (inlineArrays.length > 0) {
      const derivedHits = [];
      for (const { re, name } of DERIVED_FIELD_PATTERNS) {
        const matches = [...content.matchAll(re)];
        if (matches.length > 0) {
          derivedHits.push({ name, count: matches.length, sample: matches[0][0].trim() });
        }
      }
      if (derivedHits.length > 0) {
        inlineDataIssues.push({ file: rel, arrays: inlineArrays.map(m => m[1]), derived: derivedHits });
      } else {
        // Pattern A만 — 파생값 없으면 INFO
        inlineDataIssues.push({ file: rel, arrays: inlineArrays.map(m => m[1]), derived: [], infoOnly: true });
      }
    }
  }

  // ── @/data/ 값 import 탐지 (기존 로직) ──────────────────────────────────────
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

// Pattern A+B 결과
const derivedErrors = inlineDataIssues.filter(i => !i.infoOnly && i.derived.length > 0);
const inlineInfos = inlineDataIssues.filter(i => i.infoOnly);
if (derivedErrors.length > 0) {
  console.log(`🚨 [Pattern B] 파생 분석 필드 리터럴 하드코딩: ${derivedErrors.length}개 파일`);
  console.log('   → 이 필드들은 historical/시장 데이터에서 동적 계산해야 합니다.\n');
  for (const e of derivedErrors) {
    console.log(`  📄 ${e.file}`);
    console.log(`     배열: ${e.arrays.join(', ')}`);
    for (const d of e.derived) {
      console.log(`     ❌ ${d.name}`);
      console.log(`        예시: ${d.sample} (${d.count}개)`);
    }
    console.log('');
  }
}
if (inlineInfos.length > 0) {
  console.log(`ℹ️  [Pattern A] 파일 내 static 배열 (파생값 없음 — 구조 데이터로 보임): ${inlineInfos.length}개`);
  for (const i of inlineInfos) console.log(`   ${i.file} — const ${i.arrays.join(', ')}`);
  console.log('');
}

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

// 2026-06-17 전수조사 A3: 조기 exit(0) 제거 — Pattern A 가 깨끗해도 아래 Pattern C 가 돌아야 함(기존엔
//   여기서 exit 해 Pattern A 무결 시 Pattern C 가 아예 미실행). 최종 exit 에서 A+B+C 합산해 결정.
if (issues.length === 0) console.log('🎉 Pattern A(import 측 폴백) 정상\n');
else console.log(`⚠️  수정 필요: ${issues.length}개 파일\n`);
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

// ── [Pattern C] 페이지 컴포넌트의 정적 시계열 데이터 import (2026-06-04 신설) ──────────
//   사각지대: 기존 스캔은 src/app/api + src/lib 만 봐서, 페이지가 직접 import 하는 정적
//   시계열 데이터(institutional-signals=13F, news-gap=시장)가 무검증이었음 (cascade/institutionalSignals
//   /newsGapData 가 사용자에게 "라이브"처럼 보이던 원인). 시계열 데이터는 라이브 API 로 받아야 함.
//   구조/설정 데이터(sectors, sector-context, cascades 관계, macro-narratives)는 정적 허용.
const PAGES_DIR = resolve(ROOT, 'src/components/pages');
const TIME_SERIES_STATIC = ['institutional-signals', 'news-gap']; // 라이브여야 함(13F/시장 시계열)
const pageStaticIssues = [];
try {
  for (const file of walkDir(PAGES_DIR)) {
    const rel = getRelPath(file);
    const content = readFileSync(file, 'utf8');
    for (const m of content.matchAll(/^import\s+\{([^}]+)\}\s+from\s+'@\/data\/([a-z-]+)'/gm)) {
      const mod = m[2];
      if (!TIME_SERIES_STATIC.includes(mod)) continue;
      // inline `type X` 명세 + 헬퍼 함수 제외 — 실제 정적 데이터 value binding 만 flag.
      const bindings = m[1].split(',').map(s => s.trim()).filter(b => b && !b.startsWith('type '));
      const dataBinding = bindings.find(b => /^(institutionalSignals|newsGapData)$/.test(b));
      if (dataBinding) pageStaticIssues.push({ file: rel, mod, imports: dataBinding });
    }
  }
} catch { /* PAGES_DIR 없음 */ }

if (pageStaticIssues.length > 0) {
  console.log(`🚨 [Pattern C] 페이지가 정적 시계열 데이터 직접 import (라이브 API 로 받아야 함): ${pageStaticIssues.length}건`);
  for (const p of pageStaticIssues) {
    console.log(`  📄 ${p.file} — { ${p.imports} } from '@/data/${p.mod}'`);
    console.log(`     → /api 라이브 엔드포인트로 교체 (정적 시계열 = 사용자에게 stale '라이브' 위장)`);
  }
  console.log('');
} else {
  console.log('✅ [Pattern C] 페이지 정적 시계열 import 없음\n');
}

// 2026-06-17 전수조사 A3: exit code 가 결함 반영 — 기존 무조건 exit(0) 이라 Pattern B(파생값 하드코딩)/
//   C(페이지 정적 시계열) 의 🚨 가 caller(verify-all)의 exit-code 게이트에 안 잡혔다. verify 전용(Vercel
//   빌드 경로 아님)이라 exit 1 안전. A(import 누락)+B+C 중 하나라도 있으면 실패.
const totalViolations = issues.length + derivedErrors.length + pageStaticIssues.length;
process.exit(totalViolations > 0 ? 1 : 0);
