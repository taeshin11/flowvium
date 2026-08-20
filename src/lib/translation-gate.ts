/**
 * translation-gate.mjs — 번역 성공 판정. '결과'로 판정하고 '변화'로 판정하지 않는다.
 *
 * 종전(news-cascade/route.ts translationSucceeded)은 두 기준을 썼다:
 *   ① 앞 5건 중 제목이 하나라도 바뀌었는가  ② 전체 제목의 70% 이상이 대상 스크립트인가
 * ①이 문제였다. 한국어 소스 기사는 제목이 이미 한국어라 바뀔 이유가 없는데,
 * 앞 5건이 모두 한국어 기사면 '안 바뀜 = 실패'로 단정해 번역 결과 전체를 폐기했다
 * (2026-08-20 실측: 번역본이 Redis 에 한국어로 캐시돼 있는데 source=cached-en 서빙).
 * '변화'는 노력의 대리지표이지 결과가 아니다. ②처럼 결과를 직접 재면 된다.
 *
 * 새 기준: 번역이 필요했던 필드(제목·요약) 중 대상 언어인 비율이 임계 이상인가.
 *   · 번역이 필요한 필드가 없으면 성공(할 일이 없었다).
 *   · 임계는 설정 가능. 기본 0.7 로 종전 partial-캐시 차단 의도를 보존한다.
 */
const SCRIPT: Record<string, RegExp> = {
  ko: /[가-힣]/,
  ja: /[ぁ-ゖァ-ヺ一-鿿]/,
  'zh-CN': /[一-龥]/,
  'zh-TW': /[一-龥]/,
};
const THRESHOLD = Number(process.env.TRANSLATION_COVERAGE_MIN ?? 0.7);
// 티커·숫자처럼 정상적으로 대상문자가 없는 짧은 필드는 판정에서 뺀다.
const MIN_WORDY = Number(process.env.TRANSLATION_MIN_WORDY ?? 12);
const wordyLen = (t: unknown) => String(t ?? '').replace(/[^A-Za-zÀ-ɏͰ-ϿЀ-ӿ一-鿿぀-ヿ가-힯]/g, '').length;

type Art = { title?: string | null; summary?: string | null };
export function translationSucceeded(orig: Art[], trans: Art[], locale: string): boolean {
  if (locale === 'en') return true;
  const re = SCRIPT[locale];
  if (!re) return true;                       // 대상 스크립트를 모르면 판정하지 않는다

  let needed = 0, inTarget = 0;
  const consider = (origText: unknown, trText: unknown) => {
    if (wordyLen(origText) < MIN_WORDY) return;   // 판정 대상 아님
    if (re.test(String(origText ?? ''))) return;  // 원문이 이미 대상 언어 → 번역 불필요
    needed++;
    if (re.test(String(trText ?? ''))) inTarget++;
  };
  for (let i = 0; i < trans.length; i++) {
    consider(orig[i]?.title, trans[i]?.title);
    consider(orig[i]?.summary, trans[i]?.summary);
  }
  if (needed === 0) return true;              // 번역이 필요한 필드가 없었다
  return inTarget / needed >= THRESHOLD;
}
