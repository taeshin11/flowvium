#!/usr/bin/env node
/**
 * script-splice.test.mjs — 음차 중단(script splice) 검출.
 *
 * 배경(2026-08-20): 번역 모델이 단어 중간에 음차를 포기하고 원문 철자를 그대로 붙이는 실패가 있다.
 *     "Keurig Dr Pepper" → "케urig 드피퍼"      (27B 도 고유명사에서 발생)
 *     "industrial conglomerate" → "산업 컨glomerate" / "산업 컨гло머리트"  (4B)
 *   기존 검출기는 둘 다 못 잡거나 일부만 잡았다:
 *     isUntranslated("케urig 드피퍼")   → false  (놓침)
 *     residualForeign("케urig 드피퍼")  → false  (놓침)
 *   이대로 확정 번역 사전에 들어가면 깨진 번역이 영구히 박힌다.
 *
 * 정당한 혼용과 구분해야 한다 — 이게 어려운 부분이다:
 *     "IT 서비스" · "네트워킹 ASIC"  → 공백으로 분리된 두문자어. 정상.
 *     "SK하이닉스"                  → 라틴 다음 한글. 확립된 브랜드 표기. 정상.
 *   서명은 '한글 바로 뒤에 소문자 라틴'이다 — 음차하다 만 자리.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let S;
try { S = await import('./script-splice.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const BAD = [
  ['케urig 드피퍼', 'Keurig 음차 중단 (한글+소문자라틴)'],
  ['산업 컨glomerate', 'conglomerate 음차 중단'],
  ['산업 컨гло머리트', '키릴 혼입'],
  ['쇼트 스퀴즈 candidate', '단어 통째로 미번역 잔존'],
];
const GOOD = [
  ['IT 서비스', '공백 분리 두문자어'],
  ['네트워킹 ASIC', '공백 분리 대문자 두문자어'],
  ['SK하이닉스는 세계', '라틴→한글 브랜드 표기'],
  ['산업 재벌', '순수 한글'],
  ['숏 스퀴즈 후보', '순수 한글'],
  ['S&P500 지수', '지수명 + 한글'],
  ['ETF 비중', '두문자어 + 한글'],
];

for (const [t, why] of BAD)  S.hasScriptSplice(t, 'ko') ? ok(`잡음: ${JSON.stringify(t)} — ${why}`) : bad(`놓침: ${JSON.stringify(t)} — ${why}`);
for (const [t, why] of GOOD) !S.hasScriptSplice(t, 'ko') ? ok(`통과: ${JSON.stringify(t)} — ${why}`) : bad(`오탐: ${JSON.stringify(t)} — ${why}`);

// 일본어도 같은 실패가 난다
S.hasScriptSplice('ショート・スクイーズcandidate', 'ja') ? ok('ja: 미번역 잔존 검출') : bad('ja 검출 실패');
!S.hasScriptSplice('ショート・スクイーズ候補', 'ja') ? ok('ja: 정상 통과') : bad('ja 오탐');
// 라틴 계열 로케일에는 적용하지 않는다 — 원문도 라틴이라 서명이 성립하지 않는다
!S.hasScriptSplice('conglomerado industrial', 'es') ? ok('es: 비적용 (라틴 로케일)') : bad('es 오탐');

// ── 2026-08-21: ICU 자리표시자 오탐 ─────────────────────────────────────────────
// 검사 [3]("공백 분리 소문자 라틴 낱말")이 구분자에 {} 를 포함해 {market} 을 'market' 으로 쪼갠다.
// 그래서 자리표시자가 든 문자열은 *올바른 번역이어도* 음차 중단으로 거부된다.
// 실측: en 카탈로그의 자리표시자 포함 키 104개. 이미 번역된 것들이 전부 거부됐다 —
//   "전체 {count}개 기업 검색 가능" · "공급업체 {count}곳" · "상위 {n}건 표시 ({total} 종목 중)"
// add-i18n-key.mjs 는 이 검사로 번역을 버리므로(`✗ 음차 중단`), 자리표시자 키는 영영 못 채운다.
// 실제로 내가 fearGreedMarket.metaTitle 을 채우려다 이 가드에 막혔고, 그때 발견했다.
{
  const OK = [
    '전체 {count}개 기업 검색 가능',
    '공급업체 {count}곳',
    '상위 {n}건 표시 ({total} 종목 중) — 필터로 좁히세요',
    '{market} 공포·탐욕 지수 | Flowvium',
    'Finnhub · {period}',
  ];
  for (const s of OK) {
    S.hasScriptSplice(s, 'ko')
      ? bad(`자리표시자 오탐: ${JSON.stringify(s)}`)
      : ok(`자리표시자 통과: ${JSON.stringify(s).slice(0, 44)}`);
  }
  // 자리표시자를 빼도 진짜 음차 중단은 여전히 잡아야 한다 (가드를 무력화하면 안 된다)
  S.hasScriptSplice('{count}개 쇼트 스퀴즈 candidate', 'ko')
    ? ok('자리표시자가 있어도 진짜 잔여 영단어는 검출')
    : bad('자리표시자 처리하며 실제 검출까지 죽였다');
  S.hasScriptSplice('{n}개 케urig 드피퍼', 'ko')
    ? ok('자리표시자가 있어도 음차 중단은 검출')
    : bad('음차 중단 검출 실패');
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
