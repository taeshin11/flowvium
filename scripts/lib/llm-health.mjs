/**
 * llm-health.mjs — LLM 백엔드가 *진짜로 생성할 수 있는지* 를 묻는다.
 *
 * 왜 필요한가 (2026-08-31, 실측된 3일 정지 사건의 근본원인):
 *   run-report.sh:72 의 기동 게이트는 `GET /v1/models` 가 200 이면 "LLM 정상" 이라고
 *   찍고 통과시켰다. 그런데 mlx_lm.server 는 ThreadingHTTPServer 다 — 요청마다 스레드가
 *   따로 뜬다. 그래서 **생성 워커가 죽어도 /v1/models 는 계속 200 을 준다.**
 *
 *   실제로 일어난 일:
 *     2026-08-28 10:44:58  마지막 성공 POST /v1/chat/completions 200
 *     직후                  RuntimeError: [METAL] Command buffer execution failed:
 *                           Insufficient Memory (kIOGPUCommandBufferCallbackErrorOutOfMemory)
 *                           → 생성 스레드 사망. HTTP 서버는 생존.
 *     2026-08-28 ~ 08-31   /v1/models 는 내내 200 (23ms). 게이트는 매번 "LLM 정상" 통과.
 *                           그 뒤 각 섹션이 3600s AbortSignal 을 다 태우고 빈 문자열 반환.
 *                           1런당 4시간+ 정지, 보고서 0건, 파이프라인 락이 물려 video·warm·
 *                           segments 잡까지 전부 "보고서 파이프라인 실행 중" 으로 skip.
 *     복구                  서버 재기동 1회로 즉시 정상 (무응답 → 13.9s 200).
 *
 *   즉 **liveness 를 잘못 정의한 것**이 원인이다. 타임아웃을 줄이거나 재시도를 붙이는 건
 *   증상 덮기다 — 죽은 서버에 4시간 대신 40분을 쓰는 것뿐이다. 게이트가 물어야 할 질문은
 *   "포트가 살아있나" 가 아니라 "토큰이 나오나" 다.
 *
 * 왜 max_tokens 를 1 로 두나:
 *   이 프로브는 보고서 생성 직전에 돈다. 같은 단일 GPU 를 쓰므로 프로브 자체가 무거우면
 *   본 작업의 예산을 먹는다. 생성 경로가 살아있는지는 토큰 1개면 증명된다.
 *
 * 모델 id 를 왜 인자로 안 받나:
 *   mlx_lm 의 /v1/models 는 적재본이 아니라 HF 캐시 전체를 나열한다. 코드에 모델명을 박으면
 *   서버 기동 인자가 바뀔 때 프로브가 404 를 받고 "죽었다" 고 오판한다. served-model.mjs 가
 *   이미 *적재본만 절대경로로 나온다* 는 규약으로 해석해 주므로 그것을 쓴다.
 */
import { resolveServedModelId } from './served-model.mjs';

/** 프로브가 스스로 매달리지 않도록 하는 상한. 환경에서 조정 가능(코드에 정책을 박지 않는다). */
export const DEFAULT_PROBE_TIMEOUT_MS = 90_000;

/**
 * @typedef {object} ProbeResult
 * @property {boolean} ok            생성이 실제로 되는가
 * @property {'models'|'model-id'|'generate'|'ready'} stage  어디까지 갔나
 * @property {string}  detail        사람이 읽을 근거
 * @property {number}  ms            소요
 * @property {string|null} model     해석된 적재 모델 id
 */

/**
 * LLM 이 토큰을 내놓는지 확인한다. 포트 생존이 아니라 생성 능력을 판정한다.
 * @param {{url: string, timeoutMs?: number, fetchImpl?: typeof fetch}} opt
 *        url — OpenAI 호환 베이스 (예: http://127.0.0.1:8000/v1)
 * @returns {Promise<ProbeResult>}
 */
export async function probeGeneration(opt) {
  const { url, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, fetchImpl = fetch } = opt || {};
  const base = String(url || '').replace(/\/+$/, '');
  const t0 = Date.now();
  const since = () => Date.now() - t0;

  if (!base) return { ok: false, stage: 'models', detail: 'url 미지정', ms: 0, model: null };

  // ① 목록 — 여기까지는 종전 게이트와 같다. 이것만으로 통과시킨 것이 사건의 원인이었다.
  let list;
  try {
    const r = await fetchImpl(`${base}/models`, { signal: AbortSignal.timeout(Math.min(15_000, timeoutMs)) });
    if (!r.ok) return { ok: false, stage: 'models', detail: `HTTP ${r.status}`, ms: since(), model: null };
    list = await r.json();
  } catch (e) {
    return { ok: false, stage: 'models', detail: describe(e), ms: since(), model: null };
  }

  // ② 적재본 해석 — 근거가 없으면 추측하지 않는다(served-model 규약).
  const model = resolveServedModelId(list);
  if (!model) {
    return { ok: false, stage: 'model-id', detail: '적재 모델을 목록에서 특정할 수 없음', ms: since(), model: null };
  }

  // ③ 진짜 질문 — 토큰이 나오나.
  try {
    const r = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, temperature: 0 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return { ok: false, stage: 'generate', detail: `HTTP ${r.status}`, ms: since(), model };
    const j = await r.json();
    if (!Array.isArray(j?.choices) || j.choices.length === 0) {
      return { ok: false, stage: 'generate', detail: 'choices 없음 — 생성 경로 이상', ms: since(), model };
    }
    return { ok: true, stage: 'ready', detail: `생성 확인 ${(since() / 1000).toFixed(1)}s`, ms: since(), model };
  } catch (e) {
    return { ok: false, stage: 'generate', detail: describe(e), ms: since(), model };
  }
}

/** AbortSignal.timeout 은 TimeoutError 를 던진다 — 무응답과 거부를 구분해서 적는다. */
function describe(e) {
  const name = e?.name || '';
  if (name === 'TimeoutError' || name === 'AbortError') return '무응답(타임아웃) — 생성 스레드 사망 의심';
  const code = e?.cause?.code || e?.code;
  return code ? `${name || 'Error'}: ${code}` : String(e?.message || e).slice(0, 120);
}
