/**
 * market-outlook.mjs — 보고서 맨 위 시장 전망(stance)을 결정론 종합 판단(marketVerdict)에서 만든다. 2026-10-03.
 * 종전 맨 위는 LLM stance 라 바로 아래 '미국·거시 종합 판단' 과 40개 중 38개가 어긋났다 — scripts/lib/market-outlook.test.mjs
 */
const MAP = { buy_dip: 'bullish', accumulate: 'bullish', neutral_ready: 'neutral', neutral: 'neutral', wait: 'bearish', defensive: 'bearish' };

/** @param {string} v marketVerdict.verdict 값 @returns {'bullish'|'neutral'|'bearish'|null} */
export const verdictStance = (v) => MAP[v] ?? null;

/** 미국·한국 판정이 같은 쪽이면 그 쪽, 다르면 중립. 판정이 없으면 null. */
export function outlookStance(mv) {
  const us = verdictStance(mv?.verdict);
  if (!us) return null;
  const kr = verdictStance(mv?.krVerdict?.verdict);
  return !kr || kr === us ? us : 'neutral';
}
