/**
 * AI Provider — 로컬 vLLM 전용 (self-hosted "flowvium-local").
 *
 * 모든 AI 호출 지점에서 `callAI()` 를 사용. 예전 클라우드 cascade
 * (GROQ / OpenRouter / Gemini / Claude) 는 자가호스팅 전환 + 키 revoke 로 전부 제거됨.
 * 이제 로컬 vLLM 만 시도하고, 실패 시 빈 결과({ source: 'fallback' }) 를 반환한다.
 * (번역 등 skipVllm 경로는 빈 결과로 호출측의 로컬 Ollama 폴백을 유도.)
 *
 * 환경변수:
 *   VLLM_URL  — 선택. e.g. http://127.0.0.1:8000/v1 또는 https://tunnel.../v1
 */
import { logger } from './logger';

// 2026-07-02: LLM 타임아웃 단일소스 — finance 모델 실측 ~10 tok/s 라 고정 타임아웃은 장문에서 항상
//   timeout → silent fallback (flow-analysis/judge-chat/invest-critic 사건). 프리필 30s + 100ms/tok, 상한 300s.
//   회귀가드: scripts/check-llm-routing.mjs [2].
export const llmTimeoutMs = (maxTokens: number) => Math.min(300_000, 30_000 + maxTokens * 100);

export interface AICallResult {
  text: string;
  source: string;  // 'vllm-local' | 'fallback'
  durationMs: number;
  /** Per-provider attempt outcome — populated when the call fails, to aid diagnosis. */
  attempts?: Array<{ provider: 'vllm' | 'groq' | 'qwen' | 'gemini' | 'claude'; ok: boolean; status?: number; error?: string; durationMs?: number }>;
}

export interface AICallOptions {
  /** @deprecated 클라우드 제거로 무의미 — 호출측 호환용으로 accepted-but-ignored. */
  skipGroq?: boolean;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** true 시 로컬 vLLM 을 건너뛰고 즉시 빈 결과 반환 → 호출측 로컬 Ollama 폴백 유도(번역 경로 전용). */
  skipVllm?: boolean;
  /** @deprecated 클라우드 제거로 무의미 — 호출측 호환용으로 accepted-but-ignored. */
  preferSmallModel?: boolean;
  /** Timeout (ms). 기본 30s. */
  timeoutMs?: number;
  /** 요청 식별자. 로그 추적용. */
  tag?: string;
  /** 2026-07-05 (AISVI 노드 차용): 구조화 추출은 자유텍스트 파싱 대신 json_schema 강제 — vLLM 이 스키마를
   *  정확히 따름(실측). OpenAI 형식 {type:'json_schema', json_schema:{name, schema}}. vLLM 경로에만 전달. */
  responseFormat?: { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown> } };
}

type ProviderAttempt = { provider: 'vllm' | 'groq' | 'qwen' | 'gemini' | 'claude'; ok: boolean; status?: number; error?: string; durationMs?: number };

/** vLLM (flowvium-local) 호출 */
async function callVLLM(prompt: string, opts: AICallOptions, diag?: ProviderAttempt[]): Promise<string | null> {
  // 2026-08-22: preferSmallModel 이 선언만 되어 있고 라우팅에 안 쓰였다.
  //   그래서 "작은 모델로 충분하다" 고 명시한 호출까지 27B(:8000, 보고서 전용,
  //   --prompt-concurrency 1)로 갔다. 실측: /api/company-news 가 KR 종목마다 정확히 30.1초
  //   (callAI 기본 상한 30s 에 걸려 local_only_fallback). 같은 요약을 웹 레인(:8001, 4B)에
  //   직접 시키면 2.5초다. 선언만 있고 동작하지 않는 옵션은 호출부를 속인다.
  //   레인 선택은 llm-local.ts 와 같은 환경변수를 쓴다 — 두 곳이 다른 데를 보면 안 된다.
  const clean = (u?: string) => u?.replace(/\s+/g, '').replace(/\\n/g, '');
  const webLane = clean(process.env.LOCAL_LLM_URL);
  const vllmUrl = (opts.preferSmallModel && webLane) || clean(process.env.VLLM_URL);
  if (!vllmUrl) {
    diag?.push({ provider: 'vllm', ok: false, error: 'VLLM_URL not configured', durationMs: 0 });
    return null;
  }

  const laneModel = (opts.preferSmallModel && webLane)
    ? (process.env.LOCAL_LLM_MODEL || process.env.VLLM_MODEL)
    : process.env.VLLM_MODEL;
  const t0 = Date.now();
  const tag = opts.tag ?? 'ai';
  try {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
    // 2026-06-15 Ollama/EXAONE→vLLM Qwen3.6-27B: 큰 컨텍스트라 EXAONE 시절 2800자 절단 제거.
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(`${vllmUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 2026-08-22: 레인에 맞는 모델명을 쓴다. 폴백은 mlx 가 실제로 받는 값이어야 한다 —
        //   종전 폴백 'flowvium-local' 은 옛 Ollama 별칭이고 mlx 는 404 로 거부한다
        //   (scripts/lib/llm-config.mjs 가 그 사고를 기록해 두었다). OLLAMA_TRANSLATE_MODEL 이
        //   설정돼 있어 가려져 있었을 뿐, 그 변수가 비면 전 호출이 404 가 된다.
        model: laneModel || process.env.OLLAMA_TRANSLATE_MODEL || 'default_model',
        messages,
        max_tokens: opts.maxTokens ?? 1600,
        temperature: opts.temperature ?? 0.65,
        // 2026-07-06 UI eval 실증: deep 장문에서 같은 문장 65회 degenerate loop — Qwen 계열 표준 완화값.
        repetition_penalty: 1.05,
        chat_template_kwargs: { enable_thinking: false },
        ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
    });
    if (!res.ok) {
      logger.warn(tag, 'vllm_http_error', { status: res.status, durationMs: Date.now() - t0 });
      diag?.push({ provider: 'vllm', ok: false, status: res.status, durationMs: Date.now() - t0 });
      return null;
    }
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    if (!text) { diag?.push({ provider: 'vllm', ok: false, error: 'empty_text', durationMs: Date.now() - t0 }); return null; }
    logger.info(tag, 'vllm_ok', { textLen: text.length, durationMs: Date.now() - t0 });
    diag?.push({ provider: 'vllm', ok: true, durationMs: Date.now() - t0 });
    return text;
  } catch (err) {
    logger.warn(tag, 'vllm_failed', { error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 });
    diag?.push({ provider: 'vllm', ok: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 });
    return null;
  }
}

/**
 * 통합 AI 호출 — 로컬 vLLM 전용.
 * vLLM 성공 시 { source: 'vllm-local' }, 실패 시 { text: '', source: 'fallback' } 반환.
 * (번역 등 skipVllm 경로는 빈 결과로 호출측의 로컬 Ollama 폴백을 유도.)
 */
export async function callAI(prompt: string, opts: AICallOptions = {}): Promise<AICallResult> {
  const start = Date.now();
  const attempts: ProviderAttempt[] = [];

  if (!opts.skipVllm) {
    const t = await callVLLM(prompt, opts, attempts);
    if (t) return { text: t, source: 'vllm-local', durationMs: Date.now() - start };
  }

  // 로컬 전용 — 실패 시 빈 결과로 호출측 로컬 폴백 유도.
  logger.info(opts.tag ?? 'ai', 'local_only_fallback', { durationMs: Date.now() - start });
  return { text: '', source: 'fallback', durationMs: Date.now() - start, attempts };
}
