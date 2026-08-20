/**
 * lang-detect.mjs — 미번역 판정. 정규식 휴리스틱 대신 언어 감지기(franc)를 쓴다.
 *
 * 종전 판정은 '대상 언어 문자가 있는가'라는 정규식이었다. 그래서
 *   · 짧은 명사 나열을 모델이 그대로 되돌려줘도 '동일 출력'인지 '번역 불필요'인지 몰랐고
 *   · 티커·숫자 오탐을 임의 길이 임계(MIN_WORDY)로 막아야 했다.
 * franc 는 실제 언어를 판정하고, 판정 불가면 'und' 를 돌려주므로 두 문제가 함께 풀린다.
 * (실측: 영문 명사나열→eng · 한국어→kor · 'BILL'→und · 'KOSPI 지수가…'→kor)
 *
 * 다만 franc 는 '전체가 무슨 언어인가'만 본다. 한국어 문장 속 가나 몇 글자 같은 부분 혼입은
 * kor 로 판정하므로, 스크립트 누출 검사를 함께 쓴다. 두 신호를 결합한다.
 */
import { franc } from 'franc';

// 로케일 → franc 의 ISO 639-3 코드
const ISO3: Record<string, string> = { ko: 'kor', ja: 'jpn', 'zh-CN': 'cmn', 'zh-TW': 'cmn', en: 'eng',
  es: 'spa', fr: 'fra', de: 'deu', pt: 'por', ru: 'rus', ar: 'arb', hi: 'hin',
  id: 'ind', th: 'tha', tr: 'tur', vi: 'vie' };

// 대상 언어에 섞이면 안 되는 스크립트(부분 혼입 감지용). franc 로는 안 잡힌다.
const FOREIGN_SCRIPT: Record<string, RegExp> = {
  ko: /[ぁ-ゖァ-ヺ]/,          // 한국어에 가나
  ja: /[가-힣]/,                        // 일본어에 한글
  'zh-CN': /[가-힣ぁ-ゖァ-ヺ]/,
  'zh-TW': /[가-힣ぁ-ゖァ-ヺ]/,
};

/** franc 판정. 판정 불가면 null. */
export function detect(text: string | null | undefined, minLength = 10): string | null {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const d = franc(t, { minLength });
  return d === 'und' ? null : d;
}

/**
 * 이 텍스트가 '대상 언어로 번역되지 않은' 상태인가.
 *   · 판정 불가(und: 티커·숫자·너무 짧음) → false. 모르는 것을 단정하지 않는다.
 *   · 감지 언어가 대상과 다르면 → true.
 *   · 감지는 맞아도 이질 스크립트가 섞여 있으면 → true (부분 혼입).
 */
export function isUntranslated(text: string | null | undefined, locale: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  const target = ISO3[locale];
  if (!target) return false;                    // 모르는 로케일은 판정하지 않는다

  const foreign = FOREIGN_SCRIPT[locale];
  if (foreign && foreign.test(t)) return true;  // 부분 혼입 — 감지기와 무관하게 미번역

  const got = detect(t);
  if (!got) return false;                       // und — 판정 불가
  return got !== target;
}
