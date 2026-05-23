#!/usr/bin/env node
/**
 * scripts/normalize-sectors.mjs — companies-batch*.ts 섹터 표기 정규화.
 *
 * 발견된 불일치:
 *   - "real-estate" (32) + "real estate" (2) — 공백 차이로 분리
 *   - "consumer" (22) — 모호 (discretionary vs defensive)
 *   - "media" (2) → "communication-services" (23)
 *
 * 매핑 규칙 (보수적 — 명확한 동치만 통합):
 *   "real estate"   → "real-estate"
 *   "media"         → "communication-services"
 *
 * "consumer" 22개는 회사별 분류 필요 (자동 분류 X) → 수동 검토 권장. 그래도 일단 'consumer-discretionary'로 통합 (다수).
 *
 * 실행:
 *   node scripts/normalize-sectors.mjs           # 변경 미리보기
 *   node scripts/normalize-sectors.mjs --apply   # 실제 파일 수정
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const APPLY = process.argv.includes('--apply');
const DATA_DIR = 'C:/NoAddsMakingApps/FlowVium/src/data';

const MAPPING = {
  'real estate': 'real-estate',
  'media': 'communication-services',
  'consumer': 'consumer-discretionary', // 다수 케이스 — 사후 검토 필요
};

const files = readdirSync(DATA_DIR).filter(f => f.startsWith('companies-batch') || f === 'companies.ts');
let totalReplacements = 0;
const log = [];

for (const f of files) {
  const filePath = resolve(DATA_DIR, f);
  let content = readFileSync(filePath, 'utf8');
  let changed = false;
  let fileReplacements = 0;
  for (const [from, to] of Object.entries(MAPPING)) {
    // sector: 'X' 또는 sector: "X" 만 매칭 (다른 곳 영향 없게)
    const pattern = new RegExp(`(sector:\\s*['"])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(['"])`, 'g');
    const before = content;
    content = content.replace(pattern, `$1${to}$2`);
    const count = (before.match(pattern) ?? []).length;
    if (count > 0) {
      fileReplacements += count;
      log.push(`  ${f}: ${count}× "${from}" → "${to}"`);
      changed = true;
    }
  }
  if (changed) {
    totalReplacements += fileReplacements;
    if (APPLY) writeFileSync(filePath, content, 'utf8');
  }
}

console.log(APPLY ? '✅ 적용됨:' : '🔍 미리보기 (--apply 로 실제 적용):');
log.forEach(l => console.log(l));
console.log(`\n총 ${totalReplacements} 곳 변경${APPLY ? ' 적용' : ' 예정'}`);

if (APPLY && totalReplacements > 0) {
  console.log('\n🔄 다음 단계: node scripts/build-candidate-tickers.mjs 재실행 (candidate-tickers.json 갱신)');
}
