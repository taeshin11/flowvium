#!/usr/bin/env node
/**
 * audit-locale-scope.test.mjs — 페이지 감사기의 한국어 전용 탐지기가 다른 로케일에서 안 울린다.
 *
 * 배경(2026-08-22): KR 티커 페이지의 로케일 붕괴를 고친 뒤 다국어로 감사를 넓혔더니
 *   /ja/company/005930.KS  cjk_bleed×6  샘플: "資金追跡" "売上" "端末表示"
 *   /zh-CN/company/196170.KQ cjk_bleed×6 샘플: "搜索公司" "报告" "操纵嫌疑"
 *   — 전부 그 언어의 *정상 텍스트* 다. 중국어 페이지의 중국어를 '누출' 로 세고 있었다.
 *
 *   원인: 이 도구는 한국어 페이지 전용으로 만들어졌다(DEFAULT_PAGES 가 전부 /ko/…,
 *   브라우저 컨텍스트도 locale:'ko-KR' 고정). cjk_bleed·latin_bleed·return_as_flow 등은
 *   한국어를 전제한 정규식이다. 내가 설계 범위 밖에서 썼고, 도구는 그걸 모른 채 울렸다.
 *
 *   다국어 페이지가 실제로 중요해졌으므로(로케일 붕괴를 방금 고쳤다) 도구가 페이지 로케일을
 *   알아야 한다. 오탐을 내는 감시는 진짜 경보까지 무디게 만든다 — 오늘 반복해 확인한 원칙이다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(resolve(ROOT, 'scripts/visual/audit-pages.mjs'), 'utf8');

// 1) 탐지기가 적용 로케일을 선언한다
/locales\s*:/.test(src)
  ? ok('탐지기에 적용 로케일 선언이 있다')
  : bad('탐지기가 로케일을 모른다 — 한국어 전용 규칙이 ja/zh 페이지에서 울린다');

// 2) 한국어 전제 정규식을 가진 탐지기는 ko 로 한정돼야 한다
const KO_ONLY = ['cjk_bleed', 'latin_bleed', 'return_as_flow', 'garbled_contango'];
let missing = 0;
for (const name of KO_ONLY) {
  const i = src.indexOf(`name: '${name}'`);
  if (i < 0) { bad(`탐지기 '${name}' 를 못 찾음 — 앵커가 낡았다`); missing++; continue; }
  const block = src.slice(i, i + 900);
  if (!/locales\s*:\s*\[[^\]]*'ko'[^\]]*\]/.test(block)) { bad(`'${name}' 가 ko 한정이 아니다`); missing++; }
}
if (!missing) ok(`한국어 전제 탐지기 ${KO_ONLY.length}종이 ko 한정`);

// 3) 페이지 경로에서 로케일을 뽑는 함수가 있다
/pageLocale|localeOf|localeFromPath/.test(src)
  ? ok('경로에서 페이지 로케일을 판별한다')
  : bad('경로 → 로케일 판별이 없다');

// 4) 기본 로케일(en) 페이지에서는 영문 누출을 세지 않는다
/=== *'en'|!== *'en'|locale === 'en'/.test(src)
  ? ok('기본 로케일(en) 페이지에서 영문 검사를 건너뛴다')
  : bad('en 페이지에서도 영문을 누출로 센다 — /company/AAPL 같은 기본 로케일 경로가 전부 결함이 된다');

console.log(fail === 0 ? '\n✅ audit-locale-scope 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
