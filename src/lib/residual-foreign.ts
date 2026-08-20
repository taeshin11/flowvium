/**
 * residual-foreign.mjs — 번역 후 '아직 번역 안 된' 텍스트 판정.
 *
 * 종전(news-cascade/route.ts:80-88)은 대상별로 '특정 스크립트'만 봤다:
 *   ko → 가나만 · ja → 한글만 · zh → 가나·한글만
 * 영문은 어떤 대상에서도 잔존으로 판정되지 않아, 영어 요약이 한국어 페이지에 그대로 노출됐다
 * (2026-08-20 실측). 특정 언어를 하나씩 추가하는 건 화이트리스트 하드코딩이다.
 *
 * 일반 규칙: 대상 언어 문자가 하나도 없으면 미번역이다.
 *   · 티커('BILL')·숫자·기호처럼 정상적으로 대상문자가 없는 짧은 텍스트는 제외한다.
 *     판정에 쓸 최소 '단어 성격 문자' 수를 두고, 그 미만은 판단 보류(false).
 *   · 종전의 타언어 스크립트 검사도 유지한다 — 가나/한글 누출은 길이와 무관하게 잔존이다.
 */
const SCRIPT: Record<string, RegExp> = {
  ko: /[가-힣]/,
  ja: /[ぁ-んァ-ヶ]/,
  'zh-CN': /[一-龥]/,
  'zh-TW': /[一-龥]/,
};
// 대상이 CJK 가 아닌 로케일(en/es/…)은 'CJK 가 남아 있으면 잔존'이라는 종전 규칙을 그대로 쓴다.
const ANY_CJK = /[ぁ-んァ-ヶ가-힣一-龯]/;
// 판정에 쓸 최소 문자 수. 숫자·구두점·공백을 뺀 '말' 부분이 이보다 짧으면 판단하지 않는다.
const MIN_WORDY = Number(process.env.RESIDUAL_MIN_WORDY ?? 12);

export function residualForeign(text: string | null | undefined, locale: string): boolean {
  if (!text) return false;
  const target = SCRIPT[locale];
  if (!target) return ANY_CJK.test(text);          // 비-CJK 대상: 종전 규칙 유지

  // ① 타 CJK 스크립트 누출은 길이와 무관하게 잔존 (종전 동작 보존)
  for (const [loc, re] of Object.entries(SCRIPT)) {
    if (loc === locale) continue;
    if (loc.startsWith('zh') && locale.startsWith('zh')) continue;
    // ko 대상에서 한자는 정상 혼용(한자어)이라 제외 — 가나/한글만 타언어 신호로 본다.
    if (locale === 'ko' && loc.startsWith('zh')) continue;
    if (locale === 'ja' && loc.startsWith('zh')) continue;
    if (re.test(text)) return true;
  }

  // ② 대상 언어 문자가 하나도 없으면 미번역. 단 '말' 부분이 충분히 길 때만 판정한다.
  if (target.test(text)) return false;
  // \p{P}/\p{S} 는 tsconfig target 이 낮으면 컴파일 불가(TS1501). 동등한 문자군으로 대체한다 —
  //   '말' 부분만 남기려는 목적이므로 문자·숫자 이외를 제거하는 것으로 충분하다.
  const wordy = String(text).replace(/[^A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g, '');
  return wordy.length >= MIN_WORDY;
}


/**
 * kanaDominant — '로컬 모델이 감당 못 하는 일본어 위주 텍스트'인가.
 *
 * residualForeign 과 분리한 이유: 종전에는 이름 하나가 두 가지 일을 했다.
 *   ① sweep: "아직 번역 안 됐는가"   ② skipLocal: "일본어라 로컬 LLM 이 못 하는가"
 * residualForeign 을 '대상 문자 부재'로 일반화하자 영어 요약도 ①에 걸렸는데,
 * ②가 같은 함수를 쓰는 바람에 영어 요약마다 로컬 LLM 을 건너뛰고 클라우드(키 없음)로 가
 * 원문이 그대로 남았다(2026-08-20 실측 회귀: 요약 한글 9/12 → 0/11).
 * 판정 목적이 다르면 함수도 달라야 한다.
 */
export function kanaDominant(text: string | null | undefined): boolean {
  if (!text) return false;
  const kana = (String(text).match(/[\u3041-\u3096\u30A1-\u30FA]/g) || []).length;
  if (!kana) return false;
  const hangul = (String(text).match(/[\uAC00-\uD7A3]/g) || []).length;
  return kana >= hangul;
}
