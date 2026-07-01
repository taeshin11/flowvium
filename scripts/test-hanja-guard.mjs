// 한자(漢字) zero-tolerance 가드 회귀 테스트 (2026-07-01, spinai6 defense-b 차용).
//   ★프로덕션 sanitizeText 를 *직접 재사용* — 인라인 정규식 복제 금지(복제하면 같은 삼킴버그가
//     테스트도 통과시켜 오탐). 한자범위 literal 이 인코딩/에디터로 변질돼 한글(U+AC00-D7A3)을
//     삼키면 여기서 즉시 FAIL. verify-all 배선으로 매 push 게이트.
import { sanitizeText } from './lib/narrative-fix.mjs';

const cases = [
  // [설명, 실제, 기대]
  ['한글 시작경계 U+AC00(가) 보존', sanitizeText('가나다라마 코스피', 'ko'), '가나다라마 코스피'],
  ['한글 끝경계 U+D7A3(힣) 보존', sanitizeText('힣뷁쭯 삼성전자', 'ko'), '힣뷁쭯 삼성전자'],
  ['한글 혼합문장 무손실(삼킴 없음)', sanitizeText('코스피 반등 삼성전자 목표가 상승 매수', 'ko'), '코스피 반등 삼성전자 목표가 상승 매수'],
  ['한자 국가약어 한글매핑', sanitizeText('美中日韓', 'ko'), '미국중국일본한국'],
  ['한자 通貨 매핑', sanitizeText('元 兌 강세', 'ko'), '원 / 강세'],
  ['locale 미지정=ko 기본(스트립)', sanitizeText('美 반도체', undefined), '미국 반도체'],
  ['ja 로케일 한자 보존', sanitizeText('日本経済 中国貿易', 'ja'), '日本経済 中国貿易'],
  ['zh-CN 로케일 한자 보존', sanitizeText('中国 半导体 增长', 'zh-CN'), '中国 半导体 增长'],
  ['CJK 호환이데오그래프(U+F900) 스트립', sanitizeText('삼성 豈 반도체', 'ko'), '삼성 반도체'],
  ['병기괄호 한자 스트립 잔여정리', sanitizeText('부위 (椒間孔, foramen) 확인', 'ko'), '부위 (foramen) 확인'],
];
let fail = 0;
for (const [desc, got, want] of cases) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${desc}${ok ? '' : `\n    기대: "${want}"\n    실제: "${got}"`}`);
}
// ★codepoint 경계 assert (spinai1/6 defense-b) — 인라인 정규식 복제 금지, 프로덕션 sanitizeText 재사용.
//   각 한자범위 대표/경계 codepoint 제거 + 한글경계·비-CJK(9FFF<x<AC00) 보존 확인. 정규식 끝점이
//   변질돼 한글 삼키거나 한자범위 축소 시 즉시 FAIL.
const wrap = (n) => sanitizeText('가' + String.fromCodePoint(n) + '나', 'ko');
const stripped = (n) => !wrap(n).includes(String.fromCodePoint(n));
const kept = (n) => wrap(n).includes(String.fromCodePoint(n));
const cpAsserts = [
  ['한자 Ext-A 시작 U+3400 제거', stripped(0x3400)],
  ['한자 Ext-A 끝 U+4DBF 제거', stripped(0x4DBF)],
  ['한자 Unified 시작 U+4E00 제거', stripped(0x4E00)],
  ['한자 Unified 끝 U+9FFF 제거', stripped(0x9FFF)],
  ['한자 Compat 시작 U+F900 제거', stripped(0xF900)],
  ['한자 Compat 끝 U+FAFF 제거', stripped(0xFAFF)],
  ['한글 시작 U+AC00 보존(삼킴 없음)', kept(0xAC00)],
  ['한글 끝 U+D7A3 보존(삼킴 없음)', kept(0xD7A3)],
  ['비-CJK U+A000(9FFF<x<AC00) 보존(범위 과확장 없음)', kept(0xA000)],
];
for (const [desc, ok] of cpAsserts) {
  if (!ok) fail++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${desc}`);
}

console.log(`\n한자가드: ${cases.length + cpAsserts.length - fail}/${cases.length + cpAsserts.length} PASS`);
if (fail) { console.error(`❌ 한자가드 ${fail}건 FAIL — 한글삼킴/한자누출 회귀`); process.exit(1); }
console.log('✅ 한자 zero-tolerance 가드 OK');
