/**
 * check-hardcoded.mjs — 하드코딩된 금융 데이터 감지 스크립트
 *
 * src/data/companies-batch*.ts에서 자동으로 stale될 수 있는 값들을 감지.
 * 빌드 실패가 아닌 경고(warning)만 출력. CI에서 참고 정보로 활용.
 *
 * 사용: node scripts/check-hardcoded.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(ROOT, 'src/data');

// 감지 패턴
const PATTERNS = [
  { name: 'dollar_amount',  regex: /"\$\d+(\.\d+)?[BM]"/, desc: '하드코딩 달러 금액 (revenue.total, segment amounts)' },
  { name: 'employee_count', regex: /"[\d,]+(,\d{3})*\+"/, desc: '하드코딩 직원수 (employees)' },
  { name: 'stale_year',     regex: /\b20(2[0-2])\b/, desc: '오래된 연도 참조 (2020-2022)' },
];

// company-financials API로 live 데이터 제공되는 필드 목록
const LIVE_OVERRIDDEN = [
  'revenue.total → SEC EDGAR /api/company-financials/{ticker}',
  'revenue.segments[].amount → liveRevenue × percentage (CompanyPage)',
  'employees → Yahoo Finance v10 summaryProfile.fullTimeEmployees (CompanyPage)',
];

let totalWarnings = 0;
const warnings = [];

// companies-batch*.ts 파일 스캔
const files = readdirSync(DATA_DIR).filter(f => f.match(/^companies-batch\d+\.ts$/) || f === 'companies.ts');

for (const file of files) {
  const content = readFileSync(resolve(DATA_DIR, file), 'utf8');
  const lines = content.split('\n');

  for (const { name, regex, desc } of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        // 주석 줄은 스킵
        if (lines[i].trim().startsWith('//') || lines[i].trim().startsWith('*')) continue;
        // @static-data-warning 주석이 있는 파일은 인지된 것으로 처리
        const hasWarningComment = content.includes('@static-data-warning');

        warnings.push({
          file, line: i + 1, pattern: name, desc,
          snippet: lines[i].trim().slice(0, 80),
          acknowledged: hasWarningComment,
        });
        totalWarnings++;
      }
    }
  }
}

// 결과 출력
console.log('\n🔍 FlowVium 하드코딩 데이터 감사 결과\n');
console.log('📌 Live API로 자동 override되는 필드:');
LIVE_OVERRIDDEN.forEach(f => console.log(`   ✅ ${f}`));
console.log('');

if (warnings.length === 0) {
  console.log('✅ 감지된 하드코딩 금융 데이터 없음\n');
  process.exit(0);
}

const acknowledged = warnings.filter(w => w.acknowledged);
const unacknowledged = warnings.filter(w => !w.acknowledged);

if (acknowledged.length) {
  console.log(`ℹ️  인지된 하드코딩 (파일에 @static-data-warning 있음): ${acknowledged.length}건`);
  const byFile = {};
  for (const w of acknowledged) { byFile[w.file] = (byFile[w.file] ?? 0) + 1; }
  Object.entries(byFile).forEach(([f, n]) => console.log(`   ${f}: ${n}건`));
  console.log('');
}

if (unacknowledged.length) {
  console.log(`⚠️  새로운 하드코딩 감지: ${unacknowledged.length}건\n`);
  for (const w of unacknowledged.slice(0, 10)) {
    console.log(`  ${w.file}:${w.line} [${w.pattern}]`);
    console.log(`  → ${w.snippet}`);
    console.log(`  → ${w.desc}\n`);
  }
  if (unacknowledged.length > 10) {
    console.log(`  ... 외 ${unacknowledged.length - 10}건 더`);
  }
  console.log('💡 수정 방법:');
  console.log('   1. live API로 교체 (권장) — /api/company-financials/{ticker}');
  console.log('   2. 파일 상단에 @static-data-warning 주석 추가 (인지됨으로 표시)');
}

console.log(`\n총계: ${totalWarnings}건 감지 (${acknowledged.length} 인지, ${unacknowledged.length} 미인지)\n`);
// 경고만 출력하고 빌드는 실패시키지 않음
process.exit(0);
