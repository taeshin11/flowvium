/**
 * AI Provider Cascade — vLLM (local, free) → GROQ (cloud, free 14,400/day) → Gemini (paid fallback)
 *
 * 모든 AI 호출 지점에서 `callAI()` 를 사용하면 자동으로 체인 폴백.
 *
 * 체인 이유 (무료 우선):
 *   1. **vLLM** (로컬 진짜 무료): 사용자 PC의 EXAONE + cloudflared 터널. 비용 0원.
 *      터널 꺼져있거나 8s 타임아웃이면 즉시 GROQ로 폴백.
 *   2. **GROQ** (클라우드 무료 티어): 14,400건/일. llama-3.3-70b-versatile 우수.
 *      Vercel에서 항상 접근 가능. World Monitor(오픈소스 블룸버그)도 이 방식.
 *   3. **Gemini** (유료 최종 폴백): 앞 두 개 모두 실패 시에만. GEMINI_API_KEY 없으면 스킵.
 *
 * 품질 트레이드오프:
 *   - EXAONE-3.5-2.4B: max_model_len=1024 → 짧은 한국어 요약만. 로컬 GPU 속도.
 *   - GROQ llama-3.3-70b: 128k context, 다국어·분석 우수, 지연 500ms~1.5s
 *   - Gemini 2.5 flash: 1M context, 최고 품질
 *
 * 환경변수:
 *   VLLM_URL         — 선택. e.g. http://localhost:8000/v1 또는 https://tunnel.../v1
 *   GROQ_API_KEY     — 설정 시 vLLM 실패 후 호출. 없으면 스킵.
 *   GEMINI_API_KEY   — 선택. 둘 다 실패 시 최종 폴백. 없으면 빈 응답.
 *   AI_PREFER        — 선택. 'groq' 명시 시 vLLM 건너뛰고 GROQ부터.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from './logger';

export interface AICallResult {
  text: string;
  source: string;  // 'EXAONE-3.5' | 'GROQ-llama-3.3-70b' | 'Gemini 2.5' | 'fallback'
  durationMs: number;
  /** Per-provider attempt outcome — populated when chain fully fails, to aid diagnosis. */
  attempts?: Array<{ provider: 'vllm' | 'groq' | 'gemini'; ok: boolean; status?: number; error?: string; durationMs?: number }>;
}

export interface AICallOptions {
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** vLLM 전용 — EXAONE이 한국어 짧은 요약일 때만 빛을 발함. 긴 글로벌 분석은 GROQ부터 시도 권장. */
  skipVllm?: boolean;
  /** Timeout (ms) per provider. 기본 15s. */
  timeoutMs?: number;
  /** 요청 식별자. 로그 추적용. */
  tag?: string;
}

type ProviderAttempt = { provider: 'vllm' | 'groq' | 'gemini'; ok: boolean; status?: number; error?: string; durationMs?: number };

/** vLLM EXAONE 호출 */
async function callVLLM(prompt: string, opts: AICallOptions, diag?: ProviderAttempt[]): Promise<string | null> {
  const vllmUrl = process.env.VLLM_URL?.replace(/\s+/g, '').replace(/\\n/g, '');
  if (!vllmUrl) return null;

  const t0 = Date.now();
  const tag = opts.tag ?? 'ai';
  try {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
    // EXAONE 2.4B: max_model_len=1024 → 프롬프트도 잘라야 함
    messages.push({ role: 'user', content: prompt.slice(0, 2800) });

    const res = await fetch(`${vllmUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'LGAI-EXAONE/EXAONE-3.5-2.4B-Instruct',
        messages,
        max_tokens: Math.min(opts.maxTokens ?? 500, 500),
        temperature: opts.temperature ?? 0.65,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
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

/** GROQ 호출 — OpenAI-compatible API. 모델별 배수 다른 TPD 한도 활용:
 *    llama-3.3-70b-versatile : 100k TPD / 12k TPM / 1k RPD  (고품질, 소량)
 *    llama-3.1-8b-instant    : 500k TPD / 30k TPM / 14.4k RPD (저품질, 대량)
 *  70b 가 429 TPD 반환하면 자동 8b 폴백 — 품질 약간 하락하지만 AI 동작 지속. */
async function callGroqModel(key: string, model: string, prompt: string, opts: AICallOptions, diag?: ProviderAttempt[]): Promise<{ text: string | null; status: number | null; tpdExhausted: boolean }> {
  const t0 = Date.now();
  const tag = opts.tag ?? 'ai';
  try {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens ?? 1600,
        temperature: opts.temperature ?? 0.7,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const isTpd = res.status === 429 && errText.includes('tokens per day');
      if (res.status === 429) {
        logger.error(tag, 'groq_quota_exhausted', { model, status: 429, tpd: isTpd, body: errText.slice(0, 200), durationMs: Date.now() - t0 });
      } else {
        logger.warn(tag, 'groq_http_error', { model, status: res.status, body: errText.slice(0, 200), durationMs: Date.now() - t0 });
      }
      diag?.push({ provider: 'groq', ok: false, status: res.status, error: `[${model}] ${errText.slice(0, 200)}`, durationMs: Date.now() - t0 });
      return { text: null, status: res.status, tpdExhausted: isTpd };
    }
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    if (!text) {
      diag?.push({ provider: 'groq', ok: false, error: `[${model}] empty_text`, status: 200, durationMs: Date.now() - t0 });
      return { text: null, status: 200, tpdExhausted: false };
    }
    logger.info(tag, 'groq_ok', { model, textLen: text.length, durationMs: Date.now() - t0 });
    diag?.push({ provider: 'groq', ok: true, status: 200, durationMs: Date.now() - t0 });
    return { text, status: 200, tpdExhausted: false };
  } catch (err) {
    logger.warn(tag, 'groq_failed', { model, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 });
    diag?.push({ provider: 'groq', ok: false, error: `[${model}] ${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - t0 });
    return { text: null, status: null, tpdExhausted: false };
  }
}

async function callGroq(prompt: string, opts: AICallOptions, diag?: ProviderAttempt[]): Promise<string | null> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return null;

  // 1차: 고품질 70b (TPD 100k)
  const primary = await callGroqModel(key, 'llama-3.3-70b-versatile', prompt, opts, diag);
  if (primary.text) return primary.text;

  // 2차 폴백: 8b (TPD 500k) — 70b 가 TPD 소진 시에만
  if (primary.tpdExhausted) {
    const tag = opts.tag ?? 'ai';
    logger.info(tag, 'groq_tpd_fallback_8b', { note: '70b TPD exhausted, retrying with llama-3.1-8b-instant' });
    const fallback = await callGroqModel(key, 'llama-3.1-8b-instant', prompt, opts, diag);
    if (fallback.text) return fallback.text;
  }
  return null;
}

/** Gemini 호출 — 최종 유료 폴백 */
async function callGemini(prompt: string, opts: AICallOptions, diag?: ProviderAttempt[]): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const t0 = Date.now();
  const tag = opts.tag ?? 'ai';
  try {
    const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${prompt}` : prompt;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(fullPrompt);
    const text = result.response.text();
    logger.info(tag, 'gemini_ok', { textLen: text.length, durationMs: Date.now() - t0 });
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 429 / quota 관련은 error 레벨 (두 공짜 옵션 모두 털린 후 유료까지 빠꾸이므로 심각)
    if (msg.includes('429') || msg.includes('quota')) {
      logger.error(tag, 'gemini_quota_exhausted', { error: msg, durationMs: Date.now() - t0 });
    } else {
      logger.error(tag, 'gemini_failed', { error: msg, durationMs: Date.now() - t0 });
    }
    return null;
  }
}

/**
 * 통합 AI 호출. vLLM → GROQ → Gemini 체인을 순차 시도.
 * 모두 실패하면 { text: '', source: 'fallback' } 반환.
 */
export async function callAI(prompt: string, opts: AICallOptions = {}): Promise<AICallResult> {
  const start = Date.now();
  const preferGroq = process.env.AI_PREFER?.trim().toLowerCase() === 'groq';
  const skipVllm = opts.skipVllm || preferGroq;

  const attempts: ProviderAttempt[] = [];

  // 1. vLLM (로컬, 가장 저비용)
  if (!skipVllm) {
    const t = await callVLLM(prompt, opts, attempts);
    if (t) return { text: t, source: 'EXAONE-3.5', durationMs: Date.now() - start };
  }

  // 2. GROQ (무료 14,400/일)
  const g = await callGroq(prompt, opts, attempts);
  if (g) return { text: g, source: 'GROQ-llama-3.3-70b', durationMs: Date.now() - start };

  // 3. Gemini (유료 최종 폴백)
  const gm = await callGemini(prompt, opts, attempts);
  if (gm) return { text: gm, source: 'Gemini 2.5', durationMs: Date.now() - start };

  logger.error(opts.tag ?? 'ai', 'all_providers_failed', { durationMs: Date.now() - start, attempts });
  return { text: '', source: 'fallback', durationMs: Date.now() - start, attempts };
}
