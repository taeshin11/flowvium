#!/usr/bin/env node
/**
 * i18n-keys.test.mjs — messages/*.json 키 추가·조회의 안전성.
 *
 * 배경(2026-08-20): i18n 래칫 baseline 이 2,781건인데, 분석해 보니 1,491건(54%)이
 *   src/app/api 의 로그 태그·프롬프트 문자열이라 사용자에게 안 보인다.
 *   실제 UI 부채는 src/components/pages(594) + src/app/[locale](511) 쪽이다.
 *   그걸 줄이려면 키를 16개 로케일에 일관되게 넣는 도구가 필요하다 —
 *   손으로 16개 파일을 고치면 한두 개를 빠뜨리고, 그러면 그 로케일만 MISSING_MESSAGE 로 깨진다.
 *   (이번 세션에 이미 home.featureCards.companyComparator 로 그 실패를 겪었다.)
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let K;
try { K = await import('./i18n-keys.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const dir = mkdtempSync(join(tmpdir(), 'i18n-'));
for (const loc of ['en', 'ko', 'ja']) {
  writeFileSync(join(dir, `${loc}.json`), JSON.stringify({ home: { title: `T-${loc}`, nested: { a: 1 } } }, null, 2));
}

// [1] 로케일 목록
const locs = K.listLocales(dir);
locs.length === 3 && locs.includes('ko') ? ok(`로케일 ${locs.length}개 탐지`) : bad(`로케일 탐지 이상: ${locs}`);

// [2] 점 경로로 읽기
K.getKey(JSON.parse(readFileSync(join(dir, 'ko.json'), 'utf8')), 'home.title') === 'T-ko'
  ? ok('점 경로 조회') : bad('점 경로 조회 실패');
K.getKey({}, 'a.b.c') === undefined ? ok('없는 경로 → undefined') : bad('없는 경로 처리 이상');

// [3] 쓰기 — 기존 키를 보존해야 한다
K.setKey(dir, 'ko', 'home.breadth', '시장폭');
const ko = JSON.parse(readFileSync(join(dir, 'ko.json'), 'utf8'));
ko.home.breadth === '시장폭' ? ok('키 추가') : bad('키 추가 실패');
ko.home.title === 'T-ko' && ko.home.nested?.a === 1 ? ok('기존 키 보존') : bad('기존 키가 손실됨');

// [4] 중첩 경로 생성
K.setKey(dir, 'ko', 'home.deep.new.key', 'X');
JSON.parse(readFileSync(join(dir, 'ko.json'), 'utf8')).home.deep.new.key === 'X'
  ? ok('중첩 경로 자동 생성') : bad('중첩 생성 실패');

// [5] 누락 로케일 검출 — 한 곳만 넣고 나머지를 빠뜨리면 그 로케일이 런타임에 깨진다
const missing = K.missingLocales(dir, 'home.breadth');
missing.sort().join(',') === 'en,ja' ? ok(`누락 로케일 검출: ${missing.join(',')}`) : bad(`누락 검출 이상: ${missing}`);
K.missingLocales(dir, 'home.title').length === 0 ? ok('전 로케일 보유 시 누락 0') : bad('누락 오탐');

// [6] JSON 형식 유지 (들여쓰기 2 + 끝 개행) — diff 노이즈 방지
const raw = readFileSync(join(dir, 'ko.json'), 'utf8');
raw.endsWith('\n') && raw.includes('\n  "home"') ? ok('JSON 포맷 유지 (indent 2 + 끝 개행)') : bad('포맷이 바뀜 — diff 노이즈');

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
