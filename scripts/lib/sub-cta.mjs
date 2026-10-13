/**
 * sub-cta.mjs — 끝에 '이유 있는 구독 권유' 한 줄. 2026-09-27 A/B(편마다 절반)로 시작.
 * 2026-10-13 A/B 종료 — 모든 편에 넣는다. 3일 지표 87편: 1천회당 구독 1.71 vs 1.14(79 vs 54명).
 *   근거는 sub-cta.test.mjs [1], 표는 scripts/channel-performance.mjs 산출물(logs/channel-performance/).
 *   seed 인자는 호출부 호환을 위해 남긴다.
 */
export const SUB_CTA_LINE = '이런 뉴스, 매일 40초로 정리해 드립니다. 구독해 두세요.';
export const subCtaFor = (_seed) => true;

/** 마지막 내용 장면(isOutro 아님)의 대사 끝에 붙인다. 이미 있으면 그대로. 새 배열을 돌려준다. */
export function withSubCta(scenes) {
  const out = scenes.map((s) => ({ ...s }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].isOutro) continue;
    if (!String(out[i].say ?? '').includes(SUB_CTA_LINE)) out[i].say = `${String(out[i].say ?? '').trim()} ${SUB_CTA_LINE}`.trim();
    break;
  }
  return out;
}
