#!/usr/bin/env node
/**
 * breadcrumb-i18n.test.mjs — 브레드크럼 라벨이 URL 세그먼트를 그대로 쓰지 않는다.
 *
 * 배경(2026-08-22 눈검증): /ko/company/005930.KS 에 english_leak 'Company'.
 *   SSR HTML: <a href="/ko/company">Company</a> — 한국어 페이지인데 영문이고,
 *   JSON-LD 구조화 데이터에도 "name":"Company" 로 들어간다(검색엔진에 영문으로 노출).
 *
 *   Breadcrumbs.tsx:29  const label = overrides[segment]?.label || formatSegment(segment)
 *   formatSegment 는 'company' → 'Company' 로 *타이틀케이스만* 한다. 번역이 없다.
 *   즉 16개 로케일 전부에서 브레드크럼이 영문이었다 — 페이지 본문은 번역되는데 여기만.
 *
 *   nav 네임스페이스에 이미 같은 이름의 키가 15개 있다(report·screener·signals…).
 *   새 카탈로그를 만들지 않고 그걸 재사용한다 — 같은 목록을 두 곳에 두면 한쪽만 고쳐진다.
 *   kebab 세그먼트(news-gap)와 camel 키(newsGap)를 잇는 변환도 함께 검증한다.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(resolve(ROOT, 'src/components/Breadcrumbs.tsx'), 'utf8');

/(t\(|useTranslations)[^\n]*nav|navT|tNav/.test(src)
  ? ok('브레드크럼이 nav 번역을 참조한다')
  : bad('브레드크럼이 번역을 안 쓴다 — formatSegment(URL) 를 그대로 그린다');

/newsGap|camel|replace\(\/-\(\[a-z\]\)/.test(src)
  ? ok('kebab 세그먼트 → camel 키 변환이 있다')
  : bad('kebab→camel 변환이 없다 — news-gap 같은 세그먼트가 키를 못 찾는다');

// 사용자 대면 세그먼트는 전부 키가 있어야 한다(내부용 admin 제외)
const INTERNAL = new Set(['admin']);
const segs = readdirSync(resolve(ROOT, 'src/app/[locale]'))
  .filter((d) => { try { return statSync(join(ROOT, 'src/app/[locale]', d)).isDirectory() && !d.startsWith('['); } catch { return false; } })
  .filter((d) => !INTERNAL.has(d));
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const LOCALES = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'id', 'th', 'tr', 'vi'];
const nav = {};
for (const l of LOCALES) {
  try { nav[l] = JSON.parse(readFileSync(resolve(ROOT, `messages/${l}.json`), 'utf8')).nav ?? {}; } catch { nav[l] = {}; }
}
let miss = 0;
for (const s of segs) {
  const key = nav.ko[s] !== undefined ? s : camel(s);
  const lack = LOCALES.filter((l) => nav[l][key] === undefined);
  if (lack.length) { bad(`세그먼트 '${s}' → nav.${key} 키 없음 (${lack.length}개 로케일)`); miss++; }
}
if (!miss) ok(`사용자 대면 세그먼트 ${segs.length}종 전부 16개 로케일에 nav 키 존재`);

console.log(fail === 0 ? '\n✅ breadcrumb-i18n 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
