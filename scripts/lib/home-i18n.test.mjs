#!/usr/bin/env node
/**
 * home-i18n.test.mjs — 홈 화면의 정적 설명문이 번역 경로를 타는지 검증.
 *
 * 배경(2026-08-20 UI 검증): https://flowvium.net/ko 에 영문 문장 21건.
 *   "The foundational hardware layer powering AI, mobile, automotive…"
 *   출처: src/data/sectors.ts 의 description (영문 하드코딩, messages/ 에 없음)
 *   렌더: HomePage.tsx:1142 가 {sector.description.split('.')[0]} 로 그대로 출력.
 *   같은 저장소의 다른 페이지(CascadeDetailPage 등)는 <T text={…}> 로 런타임 번역한다.
 *   CLAUDE.md: "모든 UI 문자열은 messages/*.json 에 넣고 하드코딩 금지".
 *   16개 언어를 손으로 번역하는 대신, 이미 있는 런타임 번역(<T>)을 쓰는 것이 이 저장소의 관습이다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const home = readFileSync(resolve(ROOT, 'src/components/pages/HomePage.tsx'), 'utf8');

// 래퍼 이름은 T 또는 TranslatedText — 둘 다 useTranslatedText 로 위임한다.
/<(?:T|TranslatedText)\s+text=\{[^}]*sector\.description/.test(home)
  ? ok('섹터 설명이 런타임 번역 경로를 탄다')
  : bad('sector.description 을 번역 없이 출력 (HomePage.tsx)');

// 다른 정적 설명문도 같은 처리인지
// 번역 래퍼 안에 들어간 것은 제외하고, 맨몸으로 출력되는 description 만 센다.
const wrapped = new Set([...home.matchAll(/<(?:T|TranslatedText)\s+text=\{`?([^`}]*)/g)].map(m => m[1]));
const raw = [...home.matchAll(/\{(\w+)\.description[^}]*\}/g)].map(m => m[0])
  .filter(x => ![...wrapped].some(w => w.includes('.description')));
raw.length === 0 ? ok('번역 미경유 description 출력 없음') : bad(`번역 미경유 출력 ${raw.length}곳: ${raw.slice(0,3).join(', ')}`);

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
