/**
 * sub-cta.mjs — 끝에 '이유 있는 구독 권유' 한 줄(A/B, 편마다 절반). 2026-09-27 신설.
 * 근거·설계는 sub-cta.test.mjs 머리말. 씨앗 % 4 < 2 → 넣는다(제목 방식 짝홀과 2×2 로 고르게).
 */
export const SUB_CTA_LINE = '이런 뉴스, 매일 40초로 정리해 드립니다. 구독해 두세요.';
export const subCtaFor = (seed) => (Math.abs(Math.trunc(Number(seed) || 0)) % 4) < 2;

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
