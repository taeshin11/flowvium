#!/usr/bin/env node
/**
 * check-i18n-ratchet.mjs — 사용자 노출 문자열 하드코딩의 '증가'를 막는다.
 *
 * 왜 래칫인가: eslint-plugin-i18next 를 그냥 켜면 src/components/pages 만으로 594건이라
 *   소음에 묻힌다. 레거시 코드베이스에 린터를 들이는 확립된 해법이 ratcheting 이고
 *   (esplint · eslint-formatter-ratchet · Notion), 기존 위반은 baseline 으로 인정하되
 *   파일별 건수가 늘면 실패시킨다. 줄면 baseline 을 자동으로 조여 되돌아갈 수 없게 한다.
 *
 * 이걸로 잡히는 실제 사례(2026-08-20): HomePage 의 title: 'Company Comparator' 가
 *   모든 로케일에 영문으로 노출됐는데, 사람이 UI 를 눈으로 봐서 찾았다. 이 규칙이면 자동으로 잡힌다.
 *
 * 사용:
 *   node scripts/check-i18n-ratchet.mjs            검사 (증가 시 exit 1)
 *   node scripts/check-i18n-ratchet.mjs --update   baseline 재생성(증가분도 인정 — 신중히)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const BASELINE = resolve(ROOT, 'data/i18n-baseline.json');
const CONFIG = resolve(ROOT, '.eslintrc.i18n.json');
const TARGETS = ['src/components', 'src/app'];
const UPDATE = process.argv.includes('--update');

function run() {
  const out = execFileSync('npx', ['eslint', '--no-eslintrc', '-c', CONFIG, '--ext', '.tsx,.ts', ...TARGETS, '-f', 'json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  const files = {};
  for (const f of JSON.parse(out)) {
    if (!f.messages?.length) continue;
    files[f.filePath.replace(ROOT + '/', '')] = f.messages.length;
  }
  return files;
}

let current;
try { current = run(); }
catch (e) {
  // eslint 는 위반이 있으면 비0 로 끝난다. stdout 에 JSON 이 있으면 정상 경로다.
  const so = e.stdout?.toString() ?? '';
  if (!so.trim().startsWith('[')) {
    console.error('[i18n-ratchet] eslint 실행 실패:', (e.stderr?.toString() ?? e.message).slice(0, 300));
    process.exit(3);
  }
  current = {};
  for (const f of JSON.parse(so)) {
    if (!f.messages?.length) continue;
    current[f.filePath.replace(ROOT + '/', '')] = f.messages.length;
  }
}

const total = Object.values(current).reduce((a, c) => a + c, 0);

if (UPDATE || !existsSync(BASELINE)) {
  writeFileSync(BASELINE, JSON.stringify({
    _note: '사용자 노출 문자열 하드코딩의 파일별 건수 기준선. 손으로 고치지 말 것 — 아래 명령으로 재생성한다. 증가하면 CI 가 막고, 줄면 이 파일을 갱신해 되돌아갈 수 없게 한다.',
    command: 'node scripts/check-i18n-ratchet.mjs --update',
    generatedAt: new Date().toISOString(),
    total, files: Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))),
  }, null, 2) + '\n');
  console.log(`[i18n-ratchet] baseline 생성: ${Object.keys(current).length}개 파일 · ${total}건`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const grew = [], shrank = [];
for (const [f, n] of Object.entries(current)) {
  const b = base.files[f] ?? 0;
  if (n > b) grew.push(`${f}: ${b} → ${n}`);
  else if (n < b) shrank.push(`${f}: ${b} → ${n}`);
}
for (const f of Object.keys(base.files)) if (!(f in current)) shrank.push(`${f}: ${base.files[f]} → 0`);

console.log(`[i18n-ratchet] 현재 ${total}건 / baseline ${base.total}건`);
if (shrank.length) console.log(`  ↓ 줄어든 파일 ${shrank.length}개 — 'node scripts/check-i18n-ratchet.mjs --update' 로 baseline 을 조이세요`);
if (grew.length) {
  console.error(`  🚨 새 하드코딩 문자열 ${grew.length}개 파일:`);
  for (const g of grew.slice(0, 10)) console.error(`     ${g}`);
  console.error('  → messages/*.json 키를 쓰거나 런타임 번역(<TranslatedText>)을 태우세요.');
  process.exit(1);
}
console.log('  ✅ 증가 없음');
