#!/usr/bin/env node
/**
 * served-model.test.mjs — /v1/models 응답에서 *실제 적재된* 모델을 골라내는지 검증.
 *
 * 배경(2026-08-20): 발간 페이지 /ko/report 에 "local-default_model" 이 노출됐다.
 *   generate-report-local.mjs:1258 이
 *       const served = data.find(m => m.id === (servedModel || model)) || data[0];
 *       const root   = served?.root || servedModel || model;
 *   로 실제 모델명을 구하는데, mlx_lm 서버는
 *     · 채팅 응답의 model 을 항상 'default_model' 로 되돌려주고 (실측)
 *     · /v1/models 에 root 필드를 주지 않으며
 *     · 적재본뿐 아니라 HF 캐시에 있는 모델 전부를 나열한다 (실측: :8000 과 :8001 의 [0..2] 가 동일)
 *   → find 실패 → data[0] = 'baidu/Unlimited-OCR' → root 없음 → 'default_model' 이 그대로 기록된다.
 *
 *   부수 피해: db.mjs:37 이 model 컬럼을 "per-model 결함률 추적"용이라고 명시하는데
 *   모든 보고서가 같은 값으로 기록돼 추적이 무력화돼 있었다.
 *
 * 적재본 식별 근거(실측): 목록에서 *절대경로인 항목만* 기동 인자(--model)와 일치하고 포트마다 다르다.
 *   :8000 → …/models--mlx-community--Qwen3.8-27B-8bit/snapshots/815b83c0…
 *   :8001 → …/models--mlx-community--Qwen3.5-4B-4bit/snapshots/0e7ffd5c6…
 *   나머지 항목은 두 포트가 동일한 캐시 스캔 결과라 적재본을 가리키지 않는다.
 */
import { resolveServedModelId, servedModelBasename } from './served-model.mjs';

let fail = 0;
const eq = (got, want, m) => {
  if (got === want) { console.log(`  PASS  ${m}`); return; }
  console.log(`  FAIL  ${m}\n          got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`); fail++;
};

// 실측 payload (2026-08-20, :8000)
const MLX_8000 = { object: 'list', data: [
  { id: 'baidu/Unlimited-OCR', object: 'model', created: 1787230386 },
  { id: 'mlx-community/Qwen3.5-4B-4bit', object: 'model', created: 1787230386 },
  { id: 'mlx-community/Qwen3.8-27B-8bit', object: 'model', created: 1787230386 },
  { id: '/Users/spinai-mini/.cache/huggingface/hub/models--mlx-community--Qwen3.8-27B-8bit/snapshots/815b83c0df8ffd1d1b5244cf75fd6ef14fca9ef9', object: 'model', created: 1787230386 },
]};
const MLX_8001 = { object: 'list', data: [
  { id: 'baidu/Unlimited-OCR', object: 'model', created: 1787230386 },
  { id: 'mlx-community/Qwen3.5-4B-4bit', object: 'model', created: 1787230386 },
  { id: 'mlx-community/Qwen3.8-27B-8bit', object: 'model', created: 1787230386 },
  { id: '/Users/spinai-mini/.cache/huggingface/hub/models--mlx-community--Qwen3.5-4B-4bit/snapshots/0e7ffd5c6', object: 'model', created: 1787230386 },
]};

// ① 에코가 쓸모없을 때(default_model) 적재본을 경로에서 찾아낸다.
eq(resolveServedModelId(MLX_8000, { servedModel: 'default_model' }), 'mlx-community/Qwen3.8-27B-8bit',
   ':8000 — 27B 적재본 식별');
eq(resolveServedModelId(MLX_8001, { servedModel: 'default_model' }), 'mlx-community/Qwen3.5-4B-4bit',
   ':8001 — 4B 적재본 식별 (같은 캐시 목록에서 다른 답)');

// ② data[0] 로 흘러가지 않는다 — 종전 버그의 정확한 재현 방지.
eq(resolveServedModelId(MLX_8000, { servedModel: 'default_model' }) === 'baidu/Unlimited-OCR', false,
   '캐시 첫 항목(OCR)으로 폴백하지 않는다');

// ③ 서버가 진짜 id 를 에코하면 그걸 신뢰한다 (vLLM 등 정상 서버).
eq(resolveServedModelId(MLX_8000, { servedModel: 'mlx-community/Qwen3.5-4B-4bit' }), 'mlx-community/Qwen3.5-4B-4bit',
   '유효한 에코는 그대로 신뢰');

// ④ 근거가 없으면 만들어내지 않는다 — fallback 을 돌려주고 끝낸다.
eq(resolveServedModelId({ data: [{ id: 'a/b' }, { id: 'c/d' }] }, { servedModel: 'default_model', fallback: 'unknown' }),
   'unknown', '절대경로 항목이 없고 에코도 무효면 fallback');
eq(resolveServedModelId({ data: [] }, { fallback: null }), null, '빈 목록이면 null');
eq(resolveServedModelId(null, { fallback: 'x' }), 'x', '응답 자체가 없으면 fallback');

// ⑤ db 의 model 컬럼은 org 접두 없는 순수 모델명 (db.mjs:37 "prefix 없는 순수 모델명")
eq(servedModelBasename('mlx-community/Qwen3.8-27B-8bit'), 'Qwen3.8-27B-8bit', 'basename 추출');
eq(servedModelBasename(null), null, 'null 은 null 로');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
