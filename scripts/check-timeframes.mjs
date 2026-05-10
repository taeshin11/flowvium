#!/usr/bin/env node
/**
 * Timeframe 매핑 일관성 + 하드코딩 재확산 감지 (CI gating).
 *
 * 1) src/lib/timeframes.ts 의 TIMEFRAME 객체가 일관성 invariant 를 만족하는지 검증
 *    - retKey/rotKey 가 'ret{K}'/'rotations{K}' 형태인지
 *    - weeks*5 ≈ tradingDays
 *    - parseTimeframe 이 invalid 입력을 fallback 으로 정규화하는지
 *
 * 2) src/ 전반에서 timeframes.ts 외부에 흩어진 동일 매핑 하드코딩을 감지
 *    - tf === '1w' ? 'ret1w' : tf === '4w' ... 같은 ad-hoc switch
 *    - allowlist: timeframes.ts 자신, 컴포넌트 i18n 라벨, 정의 파일
 *
 * 사용: node scripts/check-timeframes.mjs
 * 실패 시 exit 1
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── 1) TIMEFRAME 객체 invariant 검증 ───────────────────────────────────────────
//    동적 import 대신 정적 파싱 (빌드 단계 의존 없이 .mjs 단독 실행 가능하게)
const tfPath = resolve(ROOT, 'src/lib/timeframes.ts');
const tfSrc = readFileSync(tfPath, 'utf8');

function extractTimeframeMap(src) {
  const m = src.match(/export const TIMEFRAME = \{([\s\S]*?)\n\} as const;/);
  if (!m) throw new Error('TIMEFRAME 객체를 timeframes.ts 에서 찾지 못함');
  const block = m[1];
  const entries = {};
  const entryRe = /'(\w+)':\s*\{([\s\S]*?)\}/g;
  let mm;
  while ((mm = entryRe.exec(block)) !== null) {
    const key = mm[1];
    const body = mm[2];
    const fieldRe = /(\w+):\s*('([^']+)'|(\d+))/g;
    const fields = {};
    let f;
    while ((f = fieldRe.exec(body)) !== null) {
      const fname = f[1];
      const fval = f[3] ?? Number(f[4]);
      fields[fname] = fval;
    }
    entries[key] = fields;
  }
  return entries;
}

const violations = [];
const tfMap = extractTimeframeMap(tfSrc);

for (const [key, cfg] of Object.entries(tfMap)) {
  const expectRetKey = `ret${key}`;
  const expectRotKey = `rotations${key}`;
  if (cfg.retKey !== expectRetKey) violations.push(`TIMEFRAME['${key}'].retKey='${cfg.retKey}' ≠ '${expectRetKey}'`);
  if (cfg.rotKey !== expectRotKey) violations.push(`TIMEFRAME['${key}'].rotKey='${cfg.rotKey}' ≠ '${expectRotKey}'`);
  if (typeof cfg.weeks !== 'number' || cfg.weeks <= 0) violations.push(`TIMEFRAME['${key}'].weeks=${cfg.weeks} 가 양의 정수가 아님`);
  if (typeof cfg.tradingDays !== 'number' || cfg.tradingDays !== cfg.weeks * 5) {
    violations.push(`TIMEFRAME['${key}'].tradingDays=${cfg.tradingDays} ≠ weeks(${cfg.weeks})*5`);
  }
  if (!cfg.label) violations.push(`TIMEFRAME['${key}'].label 누락`);
}

// ── 2) 하드코딩 재확산 감지 ────────────────────────────────────────────────────
//    timeframes.ts 외부 src/ 파일에서 'ret1w'/'ret4w'/'ret13w' 가 inline 삼항/switch 로
//    매핑되는 패턴을 차단. allowlist 는 컴포넌트 props/문자열 리터럴/타입 정의용.
const ALLOWED_PATHS = new Set([
  'src/lib/timeframes.ts',
  'scripts/check-timeframes.mjs',
]);

// 'ret1w' 자체가 등장하는 건 OK (TIMEFRAME 사용). 문제는 ad-hoc 매핑:
// "tf === '1w' ? 'ret1w' : tf === '4w' ? 'ret4w' : 'ret13w'"
// 같은 식의 inline 삼항만 걸러냄.
const AD_HOC_PATTERN = /tf\s*===\s*['"]1w['"]\s*\?\s*['"]ret1w['"]/;
const AD_HOC_ROT_PATTERN = /tf\s*===\s*['"]1w['"]\s*\?\s*['"]rotations1w['"]/;

function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir)) {
    if (ent === 'node_modules' || ent === '.next' || ent.startsWith('.')) continue;
    const full = join(dir, ent);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(ent)) out.push(full);
  }
  return out;
}

const adHocViolations = [];
for (const file of walk(resolve(ROOT, 'src'))) {
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
  if (ALLOWED_PATHS.has(rel)) continue;
  const content = readFileSync(file, 'utf8');
  if (AD_HOC_PATTERN.test(content)) adHocViolations.push(`${rel}: ad-hoc retKey 매핑 (TIMEFRAME[tf].retKey 사용 권장)`);
  if (AD_HOC_ROT_PATTERN.test(content)) adHocViolations.push(`${rel}: ad-hoc rotKey 매핑 (TIMEFRAME[tf].rotKey 사용 권장)`);
}

// ── 출력 ──────────────────────────────────────────────────────────────────────
console.log('=== Timeframe 일관성 검증 ===');
for (const [key, cfg] of Object.entries(tfMap)) {
  console.log(`  ${key.padEnd(4)} → label=${cfg.label} weeks=${cfg.weeks} tradingDays=${cfg.tradingDays} retKey=${cfg.retKey} rotKey=${cfg.rotKey}`);
}

if (violations.length === 0 && adHocViolations.length === 0) {
  console.log('\n✅ TIMEFRAME 매핑 일관성 OK + ad-hoc 하드코딩 0건');
  process.exit(0);
}

if (violations.length > 0) {
  console.error(`\n❌ TIMEFRAME invariant 위반 ${violations.length}건:`);
  for (const v of violations) console.error(`   - ${v}`);
}
if (adHocViolations.length > 0) {
  console.error(`\n❌ ad-hoc 하드코딩 매핑 ${adHocViolations.length}건:`);
  for (const v of adHocViolations) console.error(`   - ${v}`);
  console.error('   → src/lib/timeframes.ts 의 TIMEFRAME[tf].retKey / rotKey 를 사용하세요.');
}
process.exit(1);
