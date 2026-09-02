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

/**
 * "느린데 살아 있는" 서버를 사망으로 읽지 않기 위한 상한(ms).
 *
 * 실측(2026-08-31, 이 기계, 전부 `max_tokens:1` 짜리 "ping"):
 *   12:30 보고서 종료 직후  114.6s → 1.09s → 1.09s   (연속 3회, 105배 차이)
 *   12:43 (유휴 5분)         34.8s
 *   12:48 (유휴 5분)          1.38s
 *   12:58 (유휴 10분)         1.38s
 *   대조 :8001 4B            1.86s → 0.12s
 *
 * **원인은 아직 규명되지 않았다.** 처음에 "유휴 중 가중치가 스왑아웃되고 첫 요청이
 * 페이지인 비용을 문다" 고 적었으나 이어진 측정이 그걸 반증했다:
 *   · 유휴 10분·20분에도 1.38s 다 — 유휴 시간과 상관이 없다
 *   · 느린 구간에도 `Pages wired down` 이 29.5GB 로 그대로였다 — 가중치가 통째로
 *     내려간 것이 아니다. 모델 메모리는 Metal 상주라 wired 로 잡혀 있다
 *   · 느렸던 두 번(12:30 · 12:43)은 각각 보고서 종료 직후와 auto-monitor+dart-corpcodes
 *     동시 실행 구간이다 — 다른 활동과 겹친다
 * 남은 후보: 활성화 메모리 할당 경합, 압축메모리 해제 비용, GPU 스케줄 경합.
 * 어느 것도 측정하지 않았으므로 이름 붙이지 않는다.
 *
 * 다만 **판정에 필요한 사실은 이미 충분하다**: 같은 요청이 1.4s ~ 115s 사이를 오가고,
 * 두 번째 질문에는 항상 1s 대로 답한다. 그러니 상한 하나로 사망을 판정하면 안 된다.
 * 실측 최대(114.6s)에 여유를 더해 180s. 코드에 박지 않고 인자로 덮을 수 있다.
 */
export const DEFAULT_COLD_TIMEOUT_MS = 180_000;

/**
 * 빠르게 한 번, 실패하면 길게 한 번 더 묻는다. 두 번 다 안 되면 사망이다.
 *
 * 왜 재시도가 여기서는 "증상 덮기" 가 아닌가 — 두 실패의 *관측된 거동* 이 다르기 때문이다.
 *   느린 경우는 첫 요청이 비용을 치르고 끝난다. 두 번째는 실측 1.09~1.38s 다.
 *   생성 스레드 사망은 몇 번을 물어도 안 나온다(08-28~08-31 3일간 그랬다).
 *   그래서 두 번째 질문이 둘을 실제로 가른다. 같은 실패를 그냥 다시 시도해 덮는 것과 다르다.
 *   (느림의 *원인* 은 아직 모른다. 위 상수 주석 참조 — 모르는 것을 아는 것처럼 쓰지 않는다.)
 *
 * 그리고 짧은 상한 하나로 가는 쪽이 오히려 위험하다: 클라이언트가 abort 해도 mlx_lm 은
 * 그 요청을 계속 처리한다. 끊긴 프로브가 서버 큐에 일감을 남기고 다음 프로브가 그 뒤에 선다
 * (실측: 20s 프로브 직후의 90s 프로브가 97.4s 에 타임아웃). 짧게 끊을수록 나빠진다.
 *
 * @param {{url:string, timeoutMs?:number, coldTimeoutMs?:number, fetchImpl?:Function}} opt
 * @returns {Promise<{ok:boolean, cold:boolean, stage?:string, detail:string, ms:number, model?:string}>}
 */
export async function probeWithColdRetry(opt) {
  const { coldTimeoutMs = DEFAULT_COLD_TIMEOUT_MS, ...rest } = opt || {};
  const first = await probeGeneration(rest);
  if (first.ok) return { ...first, cold: false };

  // 목록(GET /v1/models)조차 안 되면 느림의 문제가 아니다 — 포트가 닫혔거나 프로세스가 없다.
  // 그 경우 길게 기다려봐야 같은 결과이므로 바로 판정한다.
  if (first.stage === 'models') return { ...first, cold: false };

  const second = await probeGeneration({ ...rest, timeoutMs: coldTimeoutMs });
  if (second.ok) {
    return {
      ...second,
      cold: true,
      detail: `${second.detail} — 첫 시도(${(first.ms / 1000).toFixed(1)}s 상한)는 실패했으나 재시도로 통과. `
            + `느린 것이지 죽은 것이 아니다 (원인 미규명 — 이 기계에서 같은 ping 이 1.4s~115s 를 오간다)`,
    };
  }
  return {
    ...second,
    cold: false,
    detail: `${second.detail} — 재시도(${(coldTimeoutMs / 1000).toFixed(0)}s 상한)까지 실패했다. 느린 것이 아니라 사망으로 본다`,
  };
}

/**
 * 서버가 *서빙을 시작할 때까지* 기다린다. 재기동 직후 전용이다.
 *
 * 왜 probeWithColdRetry 로 안 되는가 (2026-09-02 실측 사고):
 *   그 함수는 stage==='models' 면 재시도 없이 즉시 사망 판정한다. 평상시엔 옳다 —
 *   포트가 닫혔으면 느린 게 아니라 죽은 것이다.
 *   그런데 막 kickstart 한 직후엔 포트가 안 열린 게 **정상**이다(실측: 프로세스 시작에서
 *   `Starting httpd` 까지 1.1~2s). 그 규칙을 그대로 적용해서 :8001 복구가 실제로 성공했는데도
 *   "재기동 후에도 불합격" 으로 보고하고 중단했다. 유튜브가 37시간 멈춘 사건을 고치는 중에
 *   복구 자체는 됐으면서 안 됐다고 말한 것이다.
 *   상태가 다르면 판정도 달라야 한다 — 그래서 경로를 나눈다.
 *
 * @param {{url:string, timeoutMs?:number, intervalMs?:number, fetchImpl?:Function}} opt
 * @returns {Promise<{ok:boolean, ms:number, tries:number, detail:string}>}
 */
export async function waitUntilServing(opt) {
  const { url, timeoutMs = 120_000, intervalMs = 1_000, fetchImpl = fetch } = opt || {};
  const base = String(url || '').replace(/\/+$/, '');
  const t0 = Date.now();
  let tries = 0;
  let last = '';
  // 상한을 두는 이유: 영영 안 뜨는 경우 크론이 여기서 영구히 멈추면 그게 더 큰 사고다.
  while (Date.now() - t0 < timeoutMs) {
    tries++;
    try {
      const r = await fetchImpl(`${base}/models`, { signal: AbortSignal.timeout(8_000) });
      if (r?.ok) return { ok: true, ms: Date.now() - t0, tries, detail: `${tries}회 만에 서빙 시작` };
      last = `HTTP ${r?.status}`;
    } catch (e) { last = describe(e); }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return { ok: false, ms: Date.now() - t0, tries, detail: `${(timeoutMs / 1000).toFixed(0)}s 안에 서빙을 시작하지 않았다 (${last})` };
}
