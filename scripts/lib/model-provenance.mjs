/**
 * model-provenance.mjs — 보고서에 **실제로 누가 썼는지** 적는다. (2026-09-23 신설)
 *
 * 왜 (2026-09-23 실측):
 *   noon 회차를 REPORT_VIA_AGY=1 로 돌렸다. LLM 호출 18건이 agy 로 갔다.
 *   (⚠ 같은 날 정정: 처음엔 "로컬 0건" 이라고 적었는데 틀렸다. `[llm-gate]` 는 동시성 관문이
 *    **대기할 때만** 찍히는 줄이라 호출이 있어도 0 으로 보인다. 실제 표지는 `[vLLM:<label>]` 이고,
 *    그것으로 다시 세니 noon 은 로컬 2건(opportunity 266.9초 · fact-check:ADBE 12.8초)이었다.
 *    그래서 아래 '섞인 회차' 처리가 이론이 아니라 **첫 회차부터 실제로 필요했다**.)
 *   그런데 reports/report-2026-09-23-noon-ko.json 의 model 은 'Qwen3.8-27B-8bit',
 *   source 는 'local-Qwen3.8-27B-8bit' 였다 — Qwen 이 한 글자도 쓰지 않은 보고서다.
 *
 *   runtimeModel 은 callVLLMOnce 안에서만 채워진다. vLLM 을 한 번도 안 부르면 null 로 남고
 *   `runtimeModel ?? modelArg` 가 기본 인자(Qwen)를 집는다.
 *
 * 왜 사소하지 않은가:
 *   이 컬럼은 db.mjs:37 이 명시한 **모델별 결함률 추적**의 기준이다. 틀리면 agy 가 낸 결함이
 *   전부 Qwen 앞으로 달린다 — 그런데 agy 를 넓힐지 말지를 바로 그 숫자로 정한다.
 *   같은 고장이 2026-08-20 에도 있었다('local-default_model' 노출, served-model.mjs 머리말).
 *   그때는 라벨을 해석하는 쪽을 고쳤고, 이번엔 **라벨을 고르는 쪽**이 문제다.
 *
 * 섞인 회차는 한쪽에 달지 않는다:
 *   폴백이 살아 있어 한 회차가 agy 12 + 로컬 6 일 수 있다. 그걸 다수결로 한쪽에 몰면
 *   결함률이 조용히 오염된다. 그래서 model 을 'mixed' 로 따로 묶고 내역은 source 에 남긴다 —
 *   집계에서 빼기 쉽고, 뺐다는 것이 눈에 보인다.
 */

/**
 * @param {{agyCalls?:number, localCalls?:number, agyModel?:string|null, localModel?:string|null}} o
 * @returns {{source:string, model:string}}
 */
export function reportProvenance({ agyCalls = 0, localCalls = 0, agyModel = null, localModel = null } = {}) {
  const a = Number(agyCalls) || 0;
  const l = Number(localCalls) || 0;
  const am = String(agyModel ?? '').trim();
  const lm = String(localModel ?? '').trim() || 'unknown';

  // agy 가 돌았다는데 모델명이 없으면 **모른다고 적는다.** 그럴듯한 기본값을 넣으면
  //   오늘 고친 고장이 이름만 바꿔 되돌아온다.
  // 2026-09-23 (사장님 지시): agy 경유라는 것은 **경로**지 저자가 아니다. 저자는 모델이다.
  //   그래서 source 에 'agy-' 를 덧붙이지 않고 모델 이름을 그대로 쓴다.
  //   섞인 회차만 내역이 필요해서 접두사를 남긴다.
  if (a > 0 && l === 0) return { source: am || 'unknown', model: am || 'unknown' };
  if (a > 0 && l > 0) return { source: `mixed-${am || 'unknown'}+local${l}(${lm})`, model: 'mixed' };
  return { source: `local-${lm}`, model: lm };
}
