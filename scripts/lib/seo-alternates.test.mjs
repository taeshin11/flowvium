// seo-alternates.test.mjs — 언어판 주소(hreflang)는 실제로 있는 언어만. node scripts/lib/seo-alternates.test.mjs
// 왜(11/07 실측): 모든 페이지가 16개 언어판을 알렸는데 사이트 언어는 en·ko·ja 셋 — /zh-CN/report 등 13개가 404 였다.
import assert from 'node:assert/strict';
import { alternateLanguages } from '../../src/lib/seo-alternates.mjs';

const BASE = 'https://flowvium.net';
// [1] 받은 언어만 낸다 + x-default
assert.deepEqual(alternateLanguages('/report', ['en', 'ko', 'ja'], BASE), {
  'x-default': `${BASE}/report`, en: `${BASE}/report`, ko: `${BASE}/ko/report`, ja: `${BASE}/ja/report`,
});
// [2] 홈('')은 끝 빗금 없이
assert.equal(alternateLanguages('', ['en', 'ko'], BASE).ko, `${BASE}/ko`);
// [3] 사이트 라우팅의 언어 목록과 같아야 한다(routing.ts 가 진실)
const fs = await import('node:fs');
const routing = fs.readFileSync(new URL('../../src/i18n/routing.ts', import.meta.url), 'utf8');
const locales = JSON.parse(routing.match(/locales:\s*(\[[^\]]*\])/)[1].replace(/'/g, '"'));
const seo = fs.readFileSync(new URL('../../src/lib/seo.ts', import.meta.url), 'utf8');
assert.ok(!/ALL_LOCALES\s*=\s*\[/.test(seo), 'seo.ts 가 언어 목록을 따로 들고 있으면 routing 과 어긋난다');
assert.ok(/routing\.locales/.test(seo), 'seo.ts 는 routing.locales 를 써야 한다');
assert.equal(Object.keys(alternateLanguages('/x', locales, BASE)).length, locales.length + 1);
console.log('seo-alternates.test: 3/3 통과');
