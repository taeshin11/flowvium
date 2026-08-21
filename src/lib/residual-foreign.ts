import { isUntranslated } from './lang-detect';
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
  // 2026-08-20: 정규식 휴리스틱(대상 문자 부재 + 길이 임계)에서 언어 감지기로 교체.
  //   종전에는 '동일 출력'과 '번역 불필요'를 구분하지 못했고, 티커·숫자 오탐을 임의 길이값으로 막았다.
  //   franc 는 실제 언어를 판정하고 판정 불가는 'und' 를 돌려주므로 둘 다 해결된다.
  //   부분 스크립트 혼입은 감지기가 못 잡으므로 lang-detect 안에서 함께 검사한다.
  return isUntranslated(text, locale);
}



/**
 * untranslatedLabel — *짧은 라벨*(테마·섹터명)이 아직 번역 안 됐는가.
 *
 * residualForeign 과 분리한다. 이 파일이 스스로 적어 둔 교훈 그대로다 —
 * "판정 목적이 다르면 함수도 달라야 한다".
 *   residualForeign 은 franc 언어감지 기반이라 '말' 부분이 12자 미만이면 판단을 보류한다.
 *   문장에는 옳은 규칙이지만 라벨에는 치명적이다 — 'KOSPI Index'(11자)·'Growth ETFs'(11자)는
 *   영원히 안 잡힌다. 2026-08-22 실측: /ko 뉴스 태그의 테마 라벨 19건 중 14건이 영문으로
 *   남았는데 sweep 이 하나도 못 잡았다.
 *
 * 라벨은 문장이 아니므로 결정론적 규칙이 맞다 — 대상 스크립트 문자가 하나도 없고
 * 라틴 문자가 있으면 미번역이다. 티커는 호출부가 이미 kind 로 걸러 두므로 여기 오지 않는다.
 * 대상이 CJK 가 아닌 로케일(en/es/…)은 이 판정을 쓰지 않는다 — 라틴 문자가 정상이다.
 */
export function untranslatedLabel(text: string | null | undefined, locale: string): boolean {
  const script = SCRIPT[locale];
  if (!script) return false;
  const t = String(text ?? '').trim();
  if (!t) return false;
  return !script.test(t) && /[A-Za-z]{2,}/.test(t);
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
