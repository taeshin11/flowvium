#!/usr/bin/env node
/**
 * scripts/check-doc-sync.mjs — 문서(FEATURES/METRICS) vs 코드 상수 동기화 검증 (2026-06-05 신설).
 *
 * 사각지대 배경: 모니터(check-stall/check-data-quality)는 *런타임 데이터*만 봤지 *문서가 코드와
 *   일치하는지*는 아무도 점검 안 했음. FEATURES 가 "ETF 풀 193"(실제 30), "1,210 종목"(실제
 *   UNIVERSE_COUNT=1338) 처럼 거짓 주장을 해도 잡히지 않던 메타-사각지대 (사용자 "모니터링이
 *   왜 이걸 못 잡았어"). 권위 코드 상수를 추출해 문서의 수치 주장과 대조 → 불일치 시 ❌.
 *
 * 사용: node scripts/check-doc-sync.mjs   (exit 1 = 문서-코드 불일치)
 */
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const DOCS = ['FEATURES.md', 'METRICS.md'].map(f => readFileSync(f, 'utf8')).join('\n');
const norm = (s) => parseInt(String(s).replace(/[,\s]/g, ''), 10);

// 권위 코드 상수 추출
function etfCount() {
  const blk = readFileSync('scripts/generate-report-local.mjs', 'utf8').match(/const ETF_META = \{[\s\S]*?\n\};/)[0];
  return new Set([...blk.matchAll(/([A-Z]{2,6}):\s*\{\s*name:/g)].map(m => m[1])).size;
}

const CHECKS = [
  {
    name: 'UNIVERSE_COUNT (종목/검색 풀)',
    code: norm(readFileSync('src/data/universe-count.ts', 'utf8').match(/UNIVERSE_COUNT\s*=\s*([0-9]+)/)[1]),
    // "유니버스 1,210 종목", "기업 직접 검색 — 1,210개 기업", "모니터링 풀 N"
    docRe: /(?:유니버스|모니터링\s*(?:풀|유니버스)|기업\s*(?:직접\s*)?검색)[^0-9]{0,24}([0-9,]{3,6})\s*(?:개\s*기업|종목)/g,
  },
  {
    name: 'ETF_META (ETF 풀)',
    code: etfCount(),
    docRe: /ETF\s*풀\s*([0-9]+)\s*종?/g,
  },
  {
    name: '지원 언어 수',
    code: execSync('ls messages/*.json').toString().trim().split('\n').length,
    docRe: /([0-9]+)\s*개?\s*(?:국어|언어)\b/g,
  },
];

// 2026-06-05: UNIVERSE_SEARCH 회사명 품질 — name 이 산업라벨("OEM & Other")/Unknown 이면 UI 에
//   회사명 대신 분류 라벨이 노출됨(TSLA 사건). build 가 막지만 런타임 재검증으로 회귀 차단.
const NAME_ISSUES = (() => {
  try {
    const us = readFileSync('src/data/universe-search.ts', 'utf8');
    const entries = [...us.matchAll(/\{"ticker":"([^"]+)","name":"([^"]+)"/g)];
    const garbage = entries.filter(([, , n]) => /\b(& Other|Unknown|N\/A)\b/i.test(n));
    return { total: entries.length, garbage: garbage.map(m => `${m[1]}="${m[2]}"`) };
  } catch { return null; }
})();

const issues = [];
const ok = [];

if (NAME_ISSUES) {
  if (NAME_ISSUES.garbage.length) issues.push(`UNIVERSE_SEARCH 회사명 산업라벨 오염 ${NAME_ISSUES.garbage.length}: ${NAME_ISSUES.garbage.slice(0, 4).join(', ')} (build:universe 재실행/큐레이션 필요)`);
  else ok.push(`UNIVERSE_SEARCH 회사명 정상 (산업라벨/Unknown 오염 0, ${NAME_ISSUES.total} entries)`);
}
for (const c of CHECKS) {
  const claims = [...DOCS.matchAll(c.docRe)].map(m => norm(m[1])).filter((v, i, a) => a.indexOf(v) === i && !isNaN(v));
  const bad = claims.filter(v => v !== c.code);
  if (bad.length) issues.push(`${c.name}: 코드=${c.code} ↔ 문서 주장=${bad.join(', ')} (불일치 — 문서 갱신 필요)`);
  else ok.push(`${c.name}: 코드=${c.code} = 문서 (주장 ${claims.length ? claims.join(',') : '없음'})`);
}

console.log(`\n[doc-sync ${new Date().toISOString().slice(0, 19)}]`);
for (const s of ok) console.log('  ✅', s);
for (const s of issues) console.log('  🚨', s);
console.log(issues.length ? `  → ${issues.length} 문서-코드 불일치` : '  → OK (문서-코드 동기화)');
process.exit(issues.length ? 1 : 0);
