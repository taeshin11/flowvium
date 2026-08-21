#!/usr/bin/env node
/**
 * cascade-sector-i18n.test.mjs — /ko/cascade 의 섹터 라벨이 로케일화되는가.
 *
 * 배경(2026-08-21 눈검증): Playwright 페이지 감사가 /ko/cascade 에서 english_leak 5건을 잡았다.
 *   샘플: "Semiconductors" · "AI / Cloud" · "EV / Battery" — 뉴스 제목이 아니라 섹터·테마 라벨이다.
 *   CascadePage.tsx:77 이 patterns[0].sectorName(= src/data/cascades.ts 의 영문 원문)을 그대로 찍는다.
 *
 *   저장소엔 이미 useSectorLabel() 이 있고 ReportPage 는 그걸 쓴다. 즉 한 곳만 고치고
 *   나머지를 점검하지 않은 것이다(CLAUDE.md 가 반복해 경고하는 그 패턴).
 *
 *   ※ 이 결함은 내가 앞선 감사에서 존재하지 않는 경로(/ko/news)를 넘기는 바람에 놓쳤다.
 *     404 페이지를 검사하고 "통과" 로 읽었다. 실존 라우트로 다시 돌려서야 드러났다.
 *
 * 두 가지를 함께 본다 — 훅 배선만 하면 키 없는 이름은 여전히 영문으로 남는다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sectorSlug } from './sector-label.mjs';   // slug 규칙을 다시 적지 않는다 — 단일 출처

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// [1] cascades.ts 의 모든 sectorName 이 i18n 키를 갖는가 (전 로케일)
const cascades = readFileSync(resolve(ROOT, 'src/data/cascades.ts'), 'utf8');
const names = [...new Set([...cascades.matchAll(/sectorName:\s*"([^"]+)"/g)].map(m => m[1]))].sort();
if (!names.length) bad('cascades.ts 에서 sectorName 을 못 찾음 — 테스트 앵커가 낡았다');

const LOCALES = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'id', 'th', 'tr', 'vi'];
const cat = {};
for (const l of LOCALES) {
  try { cat[l] = JSON.parse(readFileSync(resolve(ROOT, `messages/${l}.json`), 'utf8'))?.explore?.sectors ?? {}; }
  catch { cat[l] = {}; }
}
let missing = 0;
for (const n of names) {
  const slug = sectorSlug(n);
  const lack = LOCALES.filter(l => !cat[l][slug]);
  if (lack.length) { bad(`"${n}" → explore.sectors.${slug} 키 없음 (${lack.length}개 로케일: ${lack.slice(0, 4).join(',')}…)`); missing++; }
}
if (!missing && names.length) ok(`cascades.ts sectorName ${names.length}종 전부 16개 로케일에 키 존재`);

// [2] 화면이 원문 대신 로케일 라벨을 그린다
const page = readFileSync(resolve(ROOT, 'src/components/pages/CascadePage.tsx'), 'utf8');
if (/useSectorLabel|localizeSector/.test(page)) ok('CascadePage 가 섹터 라벨 로케일화를 경유한다');
else bad('CascadePage 가 sectorName 원문을 그대로 찍는다 — ko 화면에 영문 노출');

const raw = page.match(/\{\s*patterns\[0\]\.sectorName\s*\}/);
if (raw) bad('patterns[0].sectorName 원문 렌더가 남아 있다');
else ok('원문 직접 렌더 없음');

console.log(fail === 0 ? '\n✅ cascade-sector-i18n 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
