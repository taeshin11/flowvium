/**
 * report-source.mjs — "이 보고서를 **모델이 실제로 생성했나**" 한 곳에서 판정한다. (2026-09-23 신설)
 *
 * 왜:
 *   같은 질문을 두 군데가 각자 답하고 있었다.
 *     · src/app/api/investment-strategy/route.ts  rememberGood() — last-good 캐시에 넣을지
 *     · scripts/generate-report-local.mjs         업로드 검증 — 올라간 게 내 보고서가 맞는지
 *   둘 다 `source.startsWith('local-')` 로 물었다. 그런데 그건 **모델이 썼나**가 아니라
 *   **로컬 모델이 썼나**다. 2026-09-23 에 보고서를 agy 로 돌리면서 라벨을 'agy-…' 로 바꾸려다,
 *   바꾸는 순간 rememberGood 이 agy 회차를 전부 거른다는 것을 발견했다. 그러면 Upstash 가
 *   한 번 튈 때 generic(중립·분산ETF)이 서빙된다 — 2026-06-13 에 사용자가
 *   "리포트가 이상/원래 나오던게 안나와" 로 겪은 바로 그 사고다.
 *
 * 허용목록으로 둔다(차단목록이 아니라):
 *   거를 것은 generic·static-fallback 처럼 **내용 없는 대체물**이다. 차단목록으로 두면
 *   다음에 'static-fallback-v2' 같은 게 생겼을 때 조용히 통과해 캐시를 오염시킨다.
 *   모르는 값은 통과시키지 않는다 — 캐시에 안 들어가는 쪽이 잘못 들어가는 쪽보다 싸다.
 *
 * 접두사를 늘릴 때는 reportProvenance(model-provenance.mjs)가 내는 값과 맞춰라. 둘은 짝이다.
 */

/** 모델이 실제로 생성한 보고서의 source 접두사. reportProvenance 가 내는 값과 짝이다. */
export const GENERATED_SOURCE_PREFIXES = [
  'local-',   // 로컬 vLLM/Ollama (종전 유일한 경로)
  'vllm',     // 옛 라벨
  'gemini-',  // 2026-09-23: agy 경유. source 에 경로가 아니라 **모델 이름**을 적는다
  'mixed-',   // 2026-09-23: 한 회차에 agy + 로컬이 섞임
];

// ⚠ AGY_TEXT_MODEL 을 gemini 계열이 아닌 것으로 바꾸면 여기도 같이 늘려야 한다.
//   안 늘리면 그 회차는 last-good 캐시에 못 들어가고, Redis 가 튈 때 generic 이 서빙된다.
//   model-provenance.test.mjs [6] 이 지금 설정된 모델로 그 짝을 매번 확인한다.

/** 접두사가 없는, 그대로 허용하는 값. */
export const GENERATED_SOURCE_EXACT = ['cron'];

/** @param {unknown} src @returns {boolean} 모델이 생성한 보고서인가. */
export function isGeneratedSource(src) {
  const s = String(src ?? '').trim();
  if (!s) return false;
  if (GENERATED_SOURCE_EXACT.includes(s)) return true;
  // 접두사만 있고 뒤가 비면(예: 'agy-') 모델명을 모른다는 뜻이다 — 통과시키지 않는다.
  return GENERATED_SOURCE_PREFIXES.some((p) => s.startsWith(p) && s.length > p.length);
}
