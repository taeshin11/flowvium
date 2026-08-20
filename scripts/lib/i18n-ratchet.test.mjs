#!/usr/bin/env node
/**
 * i18n-ratchet.test.mjs — i18n 리터럴 래칫 검증.
 *
 * 배경(2026-08-20): 'Company Comparator' 리터럴이 모든 로케일에 영문으로 노출됐고,
 *   저는 UI 를 눈으로 보고서야 찾았다. eslint-plugin-i18next 는 이것을 잡는다:
 *     "…: title: 'Company Comparator'"   ✅ (mode:all 설정에서)
 *   그런데 전면 도입하면 src/components/pages 만으로 594건이라 소음에 묻힌다.
 *
 *   레거시 코드베이스에 린터를 들이는 확립된 해법은 ratcheting 이다
 *   (esplint · eslint-formatter-ratchet · Notion 의 자체 시스템):
 *   기존 위반은 baseline 으로 인정하고, 파일별 건수가 '증가'할 때만 실패시킨다.
 *   줄어들면 baseline 을 자동으로 조여 되돌아갈 수 없게 한다.
 *
 *   이 저장소는 이미 check-*.mjs 관습이 있고 npm run verify 가 그것들을 모은다.
 *   새 의존성을 늘리지 않고 같은 방식으로 만든다.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

existsSync(resolve(ROOT, 'scripts/check-i18n-ratchet.mjs'))
  ? ok('래칫 스크립트 존재') : bad('scripts/check-i18n-ratchet.mjs 없음');
existsSync(resolve(ROOT, 'data/i18n-baseline.json'))
  ? ok('baseline 파일 존재') : bad('data/i18n-baseline.json 없음 — 기준선이 없으면 증가를 못 잰다');

if (existsSync(resolve(ROOT, 'data/i18n-baseline.json'))) {
  const b = JSON.parse(readFileSync(resolve(ROOT, 'data/i18n-baseline.json'), 'utf8'));
  (b.files && typeof b.files === 'object' && b.generatedAt)
    ? ok(`baseline 파일별 건수 ${Object.keys(b.files).length}개 · 총 ${Object.values(b.files).reduce((a,c)=>a+c,0)}건`)
    : bad('baseline 구조가 files/generatedAt 형태가 아니다');
  // 값이 손으로 적힌 게 아니라 생성물이어야 한다
  b.command ? ok(`재생성 방법 기록됨: ${b.command}`) : bad('재생성 명령이 없다 — 손으로 유지하게 된다');
}

// 현재 상태에서 래칫이 통과해야 한다 (기준선 = 현재)
try {
  execSync('node scripts/check-i18n-ratchet.mjs', { cwd: ROOT, stdio: 'pipe' });
  ok('현재 코드가 baseline 이내 (증가 없음)');
} catch (e) {
  bad(`래칫 실패: ${String(e.stdout ?? e.message).slice(0, 200)}`);
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
