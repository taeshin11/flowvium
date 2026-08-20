/**
 * served-model.mjs — /v1/models 응답에서 *실제 적재된* 모델 id 를 해석한다.
 *
 * 왜 필요한가(2026-08-20 실측):
 *   mlx_lm 서버는 채팅 응답의 model 필드를 요청값과 무관하게 'default_model' 로 되돌려준다.
 *   그래서 응답 에코로 모델을 식별하던 경로가 무의미해졌고, 발간 페이지에 'local-default_model' 이
 *   그대로 노출됐으며 db 의 per-model 결함률 추적(db.mjs:37)도 전 보고서가 같은 값이 돼 죽어 있었다.
 *
 * 식별 근거:
 *   mlx_lm 의 /v1/models 는 적재본만이 아니라 HF 캐시 전체를 나열한다. 다만 *적재본만* 절대경로
 *   형태로 함께 실린다 — 기동 인자 `--model <경로>` 가 그대로 들어가기 때문이다.
 *   실측으로 :8000(27B) 과 :8001(4B) 이 [0..2] 는 동일하고 마지막 경로 항목만 서로 달랐다.
 *   따라서 "절대경로인 항목" 이 적재본을 가리킨다 — 순서나 첫 항목에 기대지 않는다.
 *
 * 이 모듈은 요청 파라미터를 바꾸지 않는다. 요청은 계속 서버가 받는 별칭으로 보낸다 —
 * 명시적 id 로 보내면 서버 구현에 따라 *다른 모델을 적재*할 여지가 있고, 그건 식별 문제를
 * 고치자고 GPU 상태를 바꾸는 셈이라 위험 대비 이득이 없다. 여기서는 '무엇이 떠 있는지'만 읽는다.
 */

/** HF 캐시 경로 → 저장소 id.  …/models--mlx-community--Qwen3.8-27B-8bit/snapshots/<sha> */
function repoIdFromCachePath(p) {
  const m = String(p).match(/models--([^/\\]+)[/\\]snapshots[/\\]/);
  if (!m) return null;
  return m[1].replace(/--/g, '/');
}

/**
 * @param {any} list          /v1/models 응답(객체) 또는 data 배열
 * @param {{servedModel?: string|null, fallback?: any}} opt
 *        servedModel — 응답이 에코한 모델명. 목록에 실제로 있으면 그대로 신뢰한다.
 * @returns {string|null} 적재 모델 id. 근거가 없으면 fallback(기본 null).
 */
export function resolveServedModelId(list, opt = {}) {
  const { servedModel = null, fallback = null } = opt;
  const data = Array.isArray(list) ? list : (list && typeof list === 'object' ? list.data : null);
  const ids = (Array.isArray(data) ? data : [])
    .map((m) => (typeof m === 'string' ? m : m?.id))
    .filter((s) => typeof s === 'string' && s);
  if (!ids.length) return fallback;

  // ① 서버가 목록에 있는 진짜 id 를 에코했다면 그것이 가장 직접적인 근거다.
  if (servedModel && ids.includes(servedModel)) return servedModel;

  // ② 절대경로 항목 = 기동 인자로 적재된 본체.
  const loaded = ids.find((id) => id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(id));
  if (loaded) return repoIdFromCachePath(loaded) ?? loaded.split(/[\\/]/).filter(Boolean).pop();

  // ③ 근거가 없으면 추측하지 않는다. 목록의 첫 항목을 집는 것이 종전 버그였다.
  return fallback;
}

/** db.mjs 의 model 컬럼 규약: org 접두 없는 순수 모델명. */
export function servedModelBasename(id) {
  if (typeof id !== 'string' || !id) return null;
  return id.split(/[\\/]/).filter(Boolean).pop() ?? null;
}
