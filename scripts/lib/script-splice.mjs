/**
 * script-splice.mjs — 음차 중단(script splice) 검출.
 *
 * 배경(2026-08-20): 번역 모델이 단어 중간에 음차를 포기하고 원문 철자를 그대로 이어 붙인다.
 *     "Keurig Dr Pepper"        → "케urig 드피퍼"        (27B 도 고유명사에서 발생)
 *     "industrial conglomerate" → "산업 컨glomerate" / "산업 컨гло머리트"  (4B)
 *   기존 검출기(isUntranslated / residualForeign)는 이 서명을 못 잡는다 — 문장 전체로는
 *   목표 문자가 우세하고 '미번역'도 아니기 때문이다. 확정 번역 사전에 들어가면 영구히 박힌다.
 *
 * 정당한 혼용과 구분하는 게 핵심이다:
 *     "IT 서비스" · "네트워킹 ASIC"  공백으로 분리된 두문자어      → 정상
 *     "SK하이닉스"                   라틴 다음 한글, 확립된 브랜드  → 정상
 *   서명은 '목표 문자 바로 뒤에 소문자 라틴/키릴' — 음차하다 만 자리다.
 *   대문자로 이어지면 두문자어일 확률이 높아 잡지 않는다(오탐이 정탐보다 비싸다:
 *   멀쩡한 번역을 버리면 원문이 그대로 노출된다).
 */

// 목표 문자 집합. 라틴 계열 로케일은 원문도 라틴이라 이 서명이 성립하지 않아 대상에서 뺀다.
const TARGET = {
  ko: /[가-힣]/,
  ja: /[぀-ヿ一-鿿]/,
  zh: /[一-鿿]/,
  ru: /[Ѐ-ӿ]/,
  ar: /[؀-ۿ]/,
  hi: /[ऀ-ॿ]/,
  th: /[฀-๿]/,
};

const HANGUL = '가-힣';
const KANA_HAN = '぀-ヿ一-鿿';
const CYRILLIC = 'Ѐ-ӿ';

/**
 * 음차 중단이 있으면 true.
 * @param {string} text  번역 결과
 * @param {string} locale  목표 로케일
 */
export function hasScriptSplice(text, locale) {
  // 2026-08-21: ICU 자리표시자({count}·{market}·{n})는 번역 대상이 아니다.
  //   검사 [3]이 구분자에 {} 를 포함해 {market} 을 'market' 이라는 소문자 낱말로 쪼갰고,
  //   그래서 자리표시자가 든 문자열은 *올바른 번역이어도* 음차 중단으로 거부됐다.
  //   실측: en 카탈로그의 자리표시자 포함 키 104개. 이미 번역된 것들이 전부 거부됐다
  //   ("전체 {count}개 기업 검색 가능" · "공급업체 {count}곳").
  //   add-i18n-key.mjs 가 이 검사로 번역을 버리므로 그 키들은 영영 못 채운다.
  //   자리표시자를 지우고 나머지만 본다 — 실제 검출력은 그대로다(테스트가 고정).
  const s = String(text ?? '').replace(/\{[^{}]*\}/g, ' ');
  if (!s) return false;
  const target = TARGET[String(locale ?? '').split('-')[0]];
  if (!target) return false;          // 라틴 계열 등 — 비적용
  if (!target.test(s)) return false;  // 목표 문자가 아예 없으면 '미번역' 문제지 splice 가 아니다

  const cls = locale.startsWith('ko') ? HANGUL : locale.startsWith('ja') ? KANA_HAN
            : locale.startsWith('zh') ? '一-鿿' : locale.startsWith('ru') ? CYRILLIC : null;

  if (cls) {
    // [1] 목표 문자 바로 뒤에 소문자 라틴이 붙는다 — "케urig", "컨glomerate"
    if (new RegExp(`[${cls}][a-z]`).test(s)) return true;
    // [2] 한글/가나 바로 뒤에 키릴이 붙는다 — "컨гло머리트"
    if (locale.startsWith('ko') || locale.startsWith('ja')) {
      if (new RegExp(`[${cls}][${CYRILLIC}]|[${CYRILLIC}][${cls}]`).test(s)) return true;
    }
  }
  // [3] 공백으로 분리된 순수 소문자 라틴 낱말이 통째로 남았다 — "쇼트 스퀴즈 candidate".
  //     대문자로 시작하면 고유명사(정상 유지)일 수 있어 제외한다.
  for (const w of s.split(/[\s·,()[\]{}"'!?]+/)) {
    if (w.length >= 3 && /^[a-z]+$/.test(w)) return true;
  }
  return false;
}
