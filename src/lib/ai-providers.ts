/**
 * AI Provider Cascade — vLLM → GROQ → Qwen → Gemini
 *
 * 모든 AI 호출 지점에서 `callAI()` 를 사용하면 자동으로 체인 폴백.
 *
 * 체인 (무료 우선, 유료 폴백):
 *   1. **vLLM** (로컬 무료): EXAONE + cloudflared 터널. 8s 타임아웃 시 즉시 폴백.
 *   2. **GROQ** (무료 티어): llama-3.3-70b → llama-3.1-8b. TPD 100k/500k.
 *      TPD 소진 시 Redis key로 cross-instance guard → 즉시 다음 provider.
 *   3. **OpenRouter cascade** (OPENROUTER_API_KEY): DeepSeek-V3 → GPT-OSS-120B → Qwen3-80B → ...
 *      DeepSeek-V3:free 우선 (87%+ JSON accuracy). OPENROUTER_API_KEY 없으면 스킵.
 *   4. **Gemini 2.0 Flash** (최종 폴백): GEMINI_API_KEY 없으면 스킵.
 *
 * 환경변수:
 *   VLLM_URL            — 선택. e.g. http://localhost:8000/v1 또는 https://tunnel.../v1
 *   GROQ_API_KEY        — 설정 시 vLLM 실패 후 호출. 없으면 스킵.
 *   OPENROUTER_API_KEY  — 선택. GROQ 소진 시 Qwen 2.5 72B 호출.
 *   GEMINI_API_KEY      — 선택. 앞 전부 실패 시 최종 폴백.
 *   AI_PREFER           — 선택. 'groq' 명시 시 vLLM 건너뛰고 GROQ부터.
 *
 * Redis cross-instance quota guard (2026-04-26):
 *   GROQ TPD 429 → Redis key 'flowvium:groq:tpd_exhausted_v1' TTL=seconds_until_midnight
 *   Gemini 429 → Redis key 'flowvium:gemini:quota_exhausted_v1' TTL=seconds_until_midnight
 *   모든 Lambda 인스턴스가 이 키 체크 → 소진 시 해당 provider 호출 0회.
 *   기존 module-level guard는 warm instance 전용 보조 수단으로 유지.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from './logger';

// ── Redis lazy init for cross-instance quota guards ──────────────────────────
const GROQ_TPD_KEY = 'flowvium:groq:tpd_exhausted_v2'; // v2: bust stale guard from Apr 26
const GEMINI_QUOTA_KEY = 'flowvium:gemini:quota_exhausted_v2';
let _redis: Redis | null | undefined = undefined; // undefined = not yet initialised

function getGuardRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const nextMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(60, Math.floor((nextMidnight.getTime() - now.getTime()) / 1000));
}

export interface AICallResult {
  text: string;
  source: string;  // 'EXAONE-3.5' | 'GROQ-llama-3.3-70b-versatile' | 'GROQ-llama-3.1-8b-instant' | 'qwen-2.5-72b' | 'gemini-2.0-flash' | 'fallback'
  durationMs: number;
  /** Per-provider attempt outcome — populated when chain fully fails, to aid diagnosis. */
  attempts?: Array<{ provider: 'vllm' | 'groq' | 'qwen' | 'gemini' | 'claude'; ok: boolean; status?: number; error?: string; durationMs?: number }>;
}

export interface AICallOptions {
  /** Skip GROQ entirely — use when GROQ quota is low, go straight to Gemini */
  skipGroq?: boolean;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** vLLM 전용 — EXAONE이 한국어 짧은 요약일 때만 빛을 발함. 긴 글로벌 분석은 GROQ부터 시도 권장. */
  skipVllm?: boolean;
  /** true 시 GROQ 70b 건너뛰고 8b-instant 직행. 단순 요약(company-news 등) 전용.
   *  70b TPD 100k를 daily-brief·investment-strategy 등 고품질 라우트용으로 보존. */
  preferSmallModel?: boolean;
  /** Timeout (ms) per provider. 기본 15s. */
  timeoutMs?: number;
  /** 요청 식별자. 로그 추적용. */
  tag?: string;
}

type ProviderAttempt = { provider: 'vllm' | 'groq' | 'qwen' | 'gemini' | 'claude'; ok: boolean; status?: number; error?: string; durationMs?: number };

/** vLLM EXAONE 호출 */
async function callVLLM(prompt: string, opts: AICallOptions, diag?: ProviderAttempt[]): Promise<string | null> {
  const vllmUrl = process.env.VLLM_URL?.replace(/\s+/g, '').replace(/\\n/g, '');
  if (!vllmUrl) {
    diag?.push({ provider: 'vllm', ok: false, error: 'VLLM_URL not configured', durationMs: 0 });
    return null;
  }

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

// Module-level TPD guards — per-instance only, but prevents retry storms within a warm Lambda.
// Groq resets at UTC midnight. Gemini free-tier quota resets at midnight Pacific (UTC+0 ≈ good enough).
let groqTpdExhaustedUntil = 0;  // epoch ms; 0 = not exhausted
let geminiQuotaExhaustedUntil = 0;

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

async function callGroq(prompt: string, opts: AICallOptions, diag?: ProviderAttempt[]): Promise<{ text: string; model: string } | null> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    diag?.push({ provider: 'groq', ok: false, error: 'GROQ_API_KEY not configured', durationMs: 0 });
    return null;
  }

  const tag = opts.tag ?? 'ai';

  // Skip Groq entirely when both models are TPD-exhausted (resets at UTC midnight).
  // Two-layer guard: module-level (warm instance, free) + Redis (cross-instance, ~1ms).
  if (groqTpdExhaustedUntil > Date.now()) {
    const remainsMs = groqTpdExhaustedUntil - Date.now();
    logger.info(tag, 'groq_tpd_skip', { layer: 'module', remainsMs: Math.round(remainsMs / 1000) });
    diag?.push({ provider: 'groq', ok: false, error: `tpd_exhausted(module) resets in ${Math.round(remainsMs / 60000)}m`, durationMs: 0 });
    return null;
  }
  try {
    const guardRedis = getGuardRedis();
    if (guardRedis) {
      const ex = await guardRedis.exists(GROQ_TPD_KEY);
      if (ex) {
        logger.info(tag, 'groq_tpd_skip', { layer: 'redis', note: 'cross-instance TPD guard active' });
        diag?.push({ provider: 'groq', ok: false, error: 'tpd_exhausted(redis) — cross-instance guard', durationMs: 1 });
        groqTpdExhaustedUntil = Date.now() + secondsUntilUtcMidnight() * 1000; // sync module guard
        return null;
      }
    }
  } catch { /* non-fatal */ }

  // preferSmallModel=true → 8b 직행 (70b TPD 100k 보존)
  // 주의: 8b 소진이 70b까지 차단하지 않도록 글로벌 guard는 설정 안 함.
  if (opts.preferSmallModel) {
    logger.info(tag, 'groq_prefer_8b', { note: 'skipping 70b per preferSmallModel' });
    const small = await callGroqModel(key, 'llama-3.1-8b-instant', prompt, opts, diag);
    if (small.text) return { text: small.text, model: 'llama-3.1-8b-instant' };
    // 8b 소진 → 이 경로에서는 글로벌 GROQ guard 설정 안 함 (70b는 별도 quota)
    if (small.status === 429 && small.tpdExhausted) {
      logger.warn(tag, 'groq_8b_tpd_exhausted', { note: 'preferSmallModel path; 70b still available' });
    }
    return null;
  }

  // 1차: 고품질 70b (TPD 100k)
  const primary = await callGroqModel(key, 'llama-3.3-70b-versatile', prompt, opts, diag);
  if (primary.text) return { text: primary.text, model: 'llama-3.3-70b-versatile' };

  // 2차 폴백: 8b (TPD 500k, RPD 14.4k) — 70b HTTP 오류(429/500/503) 시 즉시 시도.
  // status === null = 네트워크 타임아웃 → 8b도 같은 이유로 느릴 것이므로 스킵.
  if (primary.status !== null && primary.status !== 200) {
    logger.info(tag, 'groq_http_fallback_8b', { note: `70b status=${primary.status}, retrying with llama-3.1-8b-instant` });
    const fallback = await callGroqModel(key, 'llama-3.1-8b-instant', prompt, opts, diag);
    if (fallback.text) return { text: fallback.text, model: 'llama-3.1-8b-instant' };

    // Both TPD-exhausted → write Redis guard + sync module guard
    // Only when 70b was ALSO TPD-exhausted (not just a transient 500/503)
    if (fallback.status === 429 && fallback.tpdExhausted && primary.tpdExhausted) {
      const ttl = secondsUntilUtcMidnight();
      const nextMidnight = new Date(Date.now() + ttl * 1000).toISOString();
      groqTpdExhaustedUntil = Date.now() + ttl * 1000;
      logger.error(tag, 'groq_all_tpd_exhausted', { resetsAt: nextMidnight, ttlS: ttl });
      await loggedRedisSet(getGuardRedis(), tag, GROQ_TPD_KEY, nextMidnight, { ex: ttl });
    }
  }
  return null;
}

/** OpenRouter free-tier cascade — GROQ 소진 후 2차 폴백.
 *  OPENROUTER_API_KEY 없으면 스킵. 순서대로 시도 → 첫 성공 반환. */
async function callQwen(prompt: string, opts: AICallOptions, diag?: ProviderAttempt[]): Promise<{ text: string; model: string } | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    diag?.push({ provider: 'qwen', ok: false, error: 'OPENROUTER_API_KEY not configured', durationMs: 0 });
    return null;
  }

  const tag = opts.tag ?? 'ai';
  // 품질 기반 우선순위 (2026-05 벤치마크 기준, JSON accuracy 내림차순)
  const FREE_MODELS = [
    // Tier 1: 87-93% JSON accuracy, instruction following 최상급
    'deepseek/deepseek-v3:free',             // DeepSeek-V3 — RL 최적화, 87%+ JSON
    'openai/gpt-oss-120b:free',              // GPT-class 120B
    // Tier 2: 70-80B급, MMLU 85-86%
    'qwen/qwen3-next-80b-a3b-instruct:free', // Qwen3 80B — 한국어 우수
    'nvidia/nemotron-3-super-120b-a12b:free',// NVIDIA 120B
    // Tier 3: 26-31B급
    'google/gemma-4-31b-it:free',            // Gemma 4 31B — structured output 강점
    'nvidia/nemotron-3-nano-30b-a3b:free',   // NVIDIA 30B
    'google/gemma-4-26b-a4b-it:free',        // Gemma 4 26B
    'openrouter/free',                        // OpenRouter 자동선택
    // 레거시 fallback
    'qwen/qwen-2.5-72b-instruct:free',
    'meta-llama/llama-3.1-8b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
  ];
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  // 90초 Lambda 한도 내 완료를 위해 총 20s, 모델당 12s로 제한
  const cascadeStart = Date.now();
  const MAX_TOTAL_OPENROUTER_MS = 20000; // 50000 → 20000 (90s Lambda 예산 내)
  const PER_MODEL_TIMEOUT_MS = 12000;    // 모델당 최대 12s

  for (const model of FREE_MODELS) {
    if (Date.now() - cascadeStart > MAX_TOTAL_OPENROUTER_MS) {
      logger.warn(tag, 'openrouter_cascade_timeout', { elapsed: Date.now() - cascadeStart });
      break;
    }
    const t0 = Date.now();
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://flowvium.net',
          'X-Title': 'FlowVium',
        },
        body: JSON.stringify({ model, messages, max_tokens: opts.maxTokens ?? 1600, temperature: opts.temperature ?? 0.7 }),
        signal: AbortSignal.timeout(Math.min(opts.timeoutMs ?? PER_MODEL_TIMEOUT_MS, PER_MODEL_TIMEOUT_MS)),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        logger.warn(tag, 'openrouter_http_error', { model, status: res.status, body: errText.slice(0, 100), durationMs: Date.now() - t0 });
        diag?.push({ provider: 'qwen', ok: false, status: res.status, error: `[${model}] ${errText.slice(0, 100)}`, durationMs: Date.now() - t0 });
        continue;
      }
      const data = await res.json();
      const text: string = data.choices?.[0]?.message?.content ?? '';
      if (!text) {
        diag?.push({ provider: 'qwen', ok: false, error: `[${model}] empty_text`, durationMs: Date.now() - t0 });
        continue;
      }
      logger.info(tag, 'openrouter_ok', { model, textLen: text.length, durationMs: Date.now() - t0 });
      diag?.push({ provider: 'qwen', ok: true, durationMs: Date.now() - t0 });
      return { text, model };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(tag, 'openrouter_failed', { model, error: msg.slice(0, 100), durationMs: Date.now() - t0 });
      diag?.push({ provider: 'qwen', ok: false, error: `[${model}] ${msg.slice(0, 100)}`, durationMs: Date.now() - t0 });
    }
  }
  return null;
}

/** Gemini 호출 — 최종 유료 폴백 */
async function callGemini(prompt: string, opts: AICallOptions, diag?: ProviderAttempt[]): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    diag?.push({ provider: 'gemini', ok: false, error: 'GEMINI_API_KEY not configured', durationMs: 0 });
    return null;
  }

  const t0 = Date.now();
  const tag = opts.tag ?? 'ai';

  // Skip when quota is exhausted — two-layer guard (module + Redis cross-instance)
  if (geminiQuotaExhaustedUntil > Date.now()) {
    const remainsMs = geminiQuotaExhaustedUntil - Date.now();
    logger.info(tag, 'gemini_quota_skip', { layer: 'module', remainsMs: Math.round(remainsMs / 1000) });
    diag?.push({ provider: 'gemini', ok: false, error: `gemini_quota_exhausted — skipped (resets in ${Math.round(remainsMs / 60000)}m)`, durationMs: 0 });
    return null;
  }
  try {
    const guardRedis = getGuardRedis();
    if (guardRedis) {
      const ex = await guardRedis.exists(GEMINI_QUOTA_KEY);
      if (ex) {
        const ttl = secondsUntilUtcMidnight();
        geminiQuotaExhaustedUntil = Date.now() + ttl * 1000; // sync module guard
        logger.info(tag, 'gemini_quota_skip', { layer: 'redis', note: 'cross-instance guard active' });
        diag?.push({ provider: 'gemini', ok: false, error: `gemini_quota_exhausted — skipped (resets in ${Math.round(ttl / 60)}m)`, durationMs: 1 });
        return null;
      }
    }
  } catch { /* non-fatal */ }

  const timeoutMs = opts.timeoutMs ?? 30000;
  try {
    const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${prompt}` : prompt;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    // Promise.race gives Gemini a hard timeout (SDK has no native AbortSignal support in v0.24)
    const result = await Promise.race([
      model.generateContent(fullPrompt),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('gemini_timeout')), timeoutMs)),
    ]);
    const text = result.response.text();
    if (!text) {
      diag?.push({ provider: 'gemini', ok: false, error: 'empty_text', durationMs: Date.now() - t0 });
      return null;
    }
    logger.info(tag, 'gemini_ok', { textLen: text.length, durationMs: Date.now() - t0 });
    diag?.push({ provider: 'gemini', ok: true, durationMs: Date.now() - t0 });
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
    const is503 = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand');
    if (isQuota) {
      const ttl = secondsUntilUtcMidnight();
      const resetsAt = new Date(Date.now() + ttl * 1000).toISOString();
      geminiQuotaExhaustedUntil = Date.now() + ttl * 1000;
      logger.error(tag, 'gemini_quota_exhausted', { error: msg.slice(0, 200), durationMs: Date.now() - t0, resetsAt });
      await loggedRedisSet(getGuardRedis(), tag, GEMINI_QUOTA_KEY, resetsAt, { ex: ttl });
    } else {
      logger.warn(tag, 'gemini_failed', { error: msg.slice(0, 200), durationMs: Date.now() - t0, is503 });
    }
    diag?.push({ provider: 'gemini', ok: false, error: msg.slice(0, 200), durationMs: Date.now() - t0 });
    return null;
  }
}

/** Anthropic Claude API 호출 (claude-haiku-4-5: 빠름+저렴, claude-sonnet-4-6: 고품질) */
async function callClaude(prompt: string, opts: AICallOptions, diag?: ProviderAttempt[]): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    diag?.push({ provider: 'claude', ok: false, error: 'ANTHROPIC_API_KEY not configured', durationMs: 0 });
    return null;
  }
  const t0 = Date.now();
  const tag = opts.tag ?? 'ai';
  const model = 'claude-haiku-4-5-20251001';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1600,
        temperature: opts.temperature ?? 0.6,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 40000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.warn(tag, 'claude_http_error', { status: res.status, body: errText.slice(0, 200), durationMs: Date.now() - t0 });
      diag?.push({ provider: 'claude', ok: false, status: res.status, durationMs: Date.now() - t0 });
      return null;
    }
    const data = await res.json() as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text ?? '';
    if (!text) { diag?.push({ provider: 'claude', ok: false, error: 'empty', durationMs: Date.now() - t0 }); return null; }
    logger.info(tag, 'claude_ok', { model, textLen: text.length, durationMs: Date.now() - t0 });
    diag?.push({ provider: 'claude', ok: true, durationMs: Date.now() - t0 });
    return text;
  } catch (err) {
    logger.warn(tag, 'claude_failed', { error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 });
    diag?.push({ provider: 'claude', ok: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 });
    return null;
  }
}

/**
 * 통합 AI 호출.
 * GROQ → Claude(Anthropic) → OpenRouter → Gemini 순서.
 * Claude가 있으면 OpenRouter/Gemini보다 먼저 시도 — 품질이 압도적으로 좋음.
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

  // 2. GROQ (무료 티어 — TPD 소진 시 Redis guard로 즉시 스킵)
  if (!opts.skipGroq) {
    const g = await callGroq(prompt, opts, attempts);
    if (g) return { text: g.text, source: `GROQ-${g.model}`, durationMs: Date.now() - start };
  }

  // 3. Claude (Anthropic) — GROQ 소진 시 최우선 고품질 폴백
  //    ANTHROPIC_API_KEY 설정 시 자동 활성화. GPT급 instruction following.
  const cl = await callClaude(prompt, opts, attempts);
  if (cl) return { text: cl, source: 'claude-haiku-4-5', durationMs: Date.now() - start };

  // 4. OpenRouter cascade (DeepSeek-V3 → GPT-OSS → Qwen3)
  const qw = await callQwen(prompt, opts, attempts);
  if (qw) {
    // 실제 성공 모델명을 source에 포함 — isKnownSource() 통과 보장을 위해 prefix 사용
    // deepseek/* → 'deepseek/…' (matches 'deepseek'), others → 'openrouter/…' (matches 'openrouter')
    const mLabel = qw.model.split('/').pop()?.replace(':free', '') ?? 'free';
    const src = qw.model.includes('deepseek') ? `deepseek/${mLabel}` : `openrouter/${mLabel}`;
    return { text: qw.text, source: src, durationMs: Date.now() - start };
  }

  // 5. Gemini 2.0 Flash (최종 폴백)
  const gm = await callGemini(prompt, opts, attempts);
  if (gm) return { text: gm, source: 'gemini-2.0-flash', durationMs: Date.now() - start };

  logger.error(opts.tag ?? 'ai', 'all_providers_failed', { durationMs: Date.now() - start, attempts });
  return { text: '', source: 'fallback', durationMs: Date.now() - start, attempts };
}
