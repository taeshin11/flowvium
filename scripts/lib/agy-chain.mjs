/**
 * agy-chain.mjs — **짧은 글**도 모델 사슬을 돈다. (2026-09-23 신설)
 *
 * 왜: 보고서는 agyReport 로 3단 사슬을 돌게 했는데 짧은 글 경로(agyText)는 그대로였다.
 *   27B 를 내린 뒤 번역 시드가 **한 건도 못 넣었다** — agy 가 빈 답을 내자
 *   죽은 27B 로 떨어졌기 때문이다(실측: "structured_output.text 비어 있음" → "fetch failed").
 *   같은 규율을 한 경로에만 적용하면 다른 경로로 샌다. 이 저장소가 오늘만 네 번 겪었다.
 *
 * 로컬로 떨어뜨리지 않는다:
 *   27B 는 내렸고, 4B 는 금융 용어를 틀린다("industrial conglomerate" → "산업 컨glomerate").
 *   그 틀림을 고치려고 만든 잡이 4B 로 떨어지면 뜻이 없다.
 *   못 하면 **null** 을 돌려준다 — 부르는 쪽이 건너뛰고 다음 회차에 다시 한다.
 *   틀린 번역이 사전에 박히는 것이 한 회차 거르는 것보다 나쁘다.
 */
import { agyText, agyLastWhy } from './agy.mjs';
import { AGY_MODEL_CHAIN } from './agy-report.mjs';

/** 보고서 사슬과 **같은 목록**을 쓴다(2026-09-25). 따로 적어 두면 한쪽만 바뀐다 — 실제로 두 곳에 같은 목록이 있었다. */
export const AGY_TEXT_CHAIN = process.env.AGY_TEXT_CHAIN
  ? process.env.AGY_TEXT_CHAIN.split(',').map((x) => x.trim()).filter(Boolean)
  : AGY_MODEL_CHAIN;

/**
 * @param {string} prompt
 * @param {{timeoutMs?:number, impl?:Function, onFallback?:(m:string,why:string)=>void}} opt
 * @returns {string|null} 다듬은 본문, 전부 실패하면 null
 */
export function agyTextChain(prompt, opt = {}) {
  const impl = opt.impl ?? agyText;
  for (let i = 0; i < AGY_TEXT_CHAIN.length; i++) {
    const model = AGY_TEXT_CHAIN[i];
    let out = null;
    try { out = impl(prompt, { model, timeoutMs: opt.timeoutMs }); }
    catch (e) { out = null; opt.onFallback?.(model, `예외 ${String(e?.message ?? e).slice(0, 60)}`); }
    // 공백만 온 것을 성공으로 세면 빈 번역이 사전에 박힌다.
    if (typeof out === 'string' && out.trim()) return out.trim();
    if (i < AGY_TEXT_CHAIN.length - 1) {
      opt.onFallback?.(model, (opt.impl ? '응답 없음' : agyLastWhy()) ?? '응답 없음');
    }
  }
  return null;
}
