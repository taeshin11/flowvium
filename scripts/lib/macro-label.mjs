/**
 * macro-label.mjs — 거시지표 카드의 표시 라벨을 로케일에 맞게 만든다.
 *
 * 배경(2026-08-20 홈 눈검증): 한국어 화면에 "hawkish (prev 224K/wk)" 가 영문으로 나왔다.
 *   src/app/api/latest-updates/route.ts 에 뒤집힌 폴백이 두 군데 있었다:
 *       `${ind.name ?? ind.nameKo}` · `${ind.rateImpact ?? ind.rateImpactKo}`
 *   ?? 는 앞이 null 일 때만 넘어가는데 영문 필드는 항상 값이 있다 —
 *   한국어 필드가 API 에 이미 있는데도 영원히 쓰이지 않았다. "(prev …)"·"↑beat"·"↓miss" 도 하드코딩.
 *
 *   rateImpact 는 자유 문장이 아니라 닫힌 enum 이다. enum 을 LLM 런타임 번역에 태우면
 *   값이 흔들린다 — 실측으로 4B 가 "hawkish"를 "호각적"으로 오역했고 한국어라서 게이트도 통과했다.
 *   닫힌 집합은 매핑으로 처리한다. 모르는 값은 창작하지 않고 원값을 남긴다.
 */

// 닫힌 enum 매핑. API 가 *Ko 필드를 줄 때는 그쪽이 우선(데이터가 코드보다 최신일 수 있다).
const IMPACT = {
  ko: { hawkish: '매파적', dovish: '비둘기파적', neutral: '중립' },
};
const SURPRISE = {
  ko: { beat: ' ↑예상상회', miss: ' ↓예상하회' },
  en: { beat: ' ↑beat', miss: ' ↓miss' },
};
const PREV_LABEL = { ko: '직전', en: 'prev' };

const langOf = (locale) => String(locale ?? 'en').split('-')[0];

/**
 * @returns {{headline:string, sub:string}}
 */
export function buildMacroLabels(ind = {}, locale = 'en') {
  const lang = langOf(locale);
  const isKo = lang === 'ko';

  const name = (isKo ? (ind.nameKo || ind.name) : (ind.name || ind.nameKo)) ?? '';
  const impactRaw = ind.rateImpact ?? '';
  // *Ko 필드라고 항상 한국어인 건 아니다. 실측(2026-08-20): macro-indicators 의 rateImpactKo 13종이
  // 전부 영문이었다("hawkish (tightening pressure)"). 필드명을 믿으면 영문이 그대로 화면에 나간다.
  // 실제로 목표 문자가 들어 있을 때만 그 값을 쓰고, 아니면 enum 매핑으로 내린다.
  const koLooksKorean = typeof ind.rateImpactKo === 'string' && /[가-힣]/.test(ind.rateImpactKo);
  const impact = isKo
    ? (koLooksKorean ? ind.rateImpactKo : (IMPACT.ko[impactRaw] || impactRaw))   // 미지 enum 은 원값 유지(창작 금지)
    : impactRaw;

  const surprise = (SURPRISE[isKo ? 'ko' : 'en'] ?? SURPRISE.en)[ind.surprise] ?? '';
  const unit = ind.unit ?? '';
  const actual = ind.actual ?? '';
  const prevLabel = PREV_LABEL[isKo ? 'ko' : 'en'];
  const changeStr = ind.previous != null ? ` (${prevLabel} ${ind.previous}${unit})` : '';

  return {
    headline: `${name} ${actual}${unit}${surprise}`.trim(),
    sub: `${impact}${changeStr}`.trim(),
  };
}
