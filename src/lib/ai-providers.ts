/**
 * AI Provider Cascade — vLLM → GROQ → Claude Haiku → Gemini
 *
 * 모든 AI 호출 지점에서 `callAI()` 를 사용하면 자동으로 체인 폴백.
 *
 * 체인 (무료 우선, 유료 폴백):
 *   1. **vLLM** (로컬 무료): EXAONE + cloudflared 터널. 8s 타임아웃 시 즉시 폴백.
 *   2. **GROQ** (무료 티어): llama-3.3-70b → llama-3.1-8b. TPD 100k/500k.
 *      TPD 소진 시 Redis key로 cross-instance guard → 즉시 다음 provider.
 *   3. **Claude Haiku 4.5** (유료, ~$0.003/호출): ANTHROPIC_API_KEY 설정 시 사용.
 *      GROQ TPD 소진 시 메인 fallback. JSON 구조 품질 최상.
 *   4. **Gemini 2.0 Flash** (유료 최종 폴백): GEMINI_API_KEY 없으면 스킵.
 *
 * 환경변수:
 *   VLLM_URL           — 선택. e.g. http://localhost:8000/v1 또는 https://tunnel.../v1
 *   GROQ_API_KEY       — 설정 시 vLLM 실패 후 호출. 없으면 스킵.
 *   ANTHROPIC_API_KEY  — 선택. GROQ 소진 시 Claude Haiku 4.5 사용.
 *   GEMINI_API_KEY     — 선택. 앞 전부 실패 시 최종 폴백.
 *   AI_PREFER          — 선택. 'groq' 명시 시 vLLM 건너뛰고 GROQ부터.
 *
 * Redis cross-instance TPD guard (2026-04-26):
 *   GROQ TPD 429 → Redis key 'flowvium:groq:tpd_exhausted_v1' TTL=seconds_until_midnight
 *   모든 Lambda 인스턴스가 이 키 체크 → TPD 소진 시 GROQ 호출 0회 → Claude/Gemini 직행.
 *   기존 module-level guard(groqTpdExhaustedUntil)는 warm instance 전용 보조 수단으로 유지.
 */
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Redis } from '@upstash/redis';
import { logger } from './logger';

// ── Redis lazy init for cross-instance TPD guard ─────────────────────────────
const GROQ_TPD_KEY = 'flowvium:groq:tpd_exhausted_v1';
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
  source: string;  // 'EXAONE-3.5' | 'GROQ-llama-3.3-70b-versatile' | 'GROQ-llama-3.1-8b-instant' | 'claude-haiku-4-5' | 'gemini-2.0-flash' | 'fallback'
  durationMs: number;
  /** Per-provider attempt outcome — populated when chain fully fails, to aid diagnosis. */
  attempts?: Array<{ provider: 'vllm' | 'groq' | 'claude' | 'gemini'; ok: boolean; status?: number; error?: string; durationMs?: number }>;
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

type ProviderAttempt = { provider: 'vllm' | 'groq' | 'claude' | 'gemini'; ok: boolean; status?: number; error?: string; durationMs?: number };

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
  if (!key) return null;

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

  // 1차: 고품질 70b (TPD 100k)
  const primary = await callGroqModel(key, 'llama-3.3-70b-versatile', prompt, opts, diag);
  if (primary.text) return { text: primary.text, model: 'llama-3.3-70b-versatile' };

  // 2차 폴백: 8b (TPD 500k, RPD 14.4k) — 70b 가 어떤 이유로든 429 시 즉시 시도
  if (primary.status === 429) {
    logger.info(tag, 'groq_429_fallback_8b', { note: '70b 429, retrying with llama-3.1-8b-instant' });
    const fallback = await callGroqModel(key, 'llama-3.1-8b-instant', prompt, opts, diag);
    if (fallback.text) return { text: fallback.text, model: 'llama-3.1-8b-instant' };

    // Both TPD-exhausted → write Redis guard + sync module guard
    if (fallback.status === 429 && fallback.tpdExhausted) {
      const ttl = secondsUntilUtcMidnight();
      const nextMidnight = new Date(Date.now() + ttl * 1000).toISOString();
      groqTpdExhaustedUntil = Date.now() + ttl * 1000;
      logger.error(tag, 'groq_all_tpd_exhausted', { resetsAt: nextMidnight, ttlS: ttl });
      try {
        const guardRedis = getGuardRedis();
        if (guardRedis) await guardRedis.set(GROQ_TPD_KEY, nextMidnight, { ex: ttl });
      } catch { /* non-fatal */ }
    }
  }
  return null;
}

/** Claude Haiku 4.5 — GROQ TPD 소진 시 주 유료 폴백. JSON 품질 최상, 비용 ~$0.003/call. */
async function callClaude(prompt: string, opts: AICallOptions, diag?: ProviderAttempt[]): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const t0 = Date.now();
  const tag = opts.tag ?? 'ai';
  try {
    const client = new Anthropic({ apiKey });
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: prompt },
    ];
    const createParams = {
      model: 'claude-haiku-4-5-20251001' as const,
      max_tokens: opts.maxTokens ?? 1600,
      temperature: opts.temperature ?? 0.7,
      stream: false as const,
      messages,
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
    };
    const response = await Promise.race([
      client.messages.create(createParams),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('claude_timeout')), opts.timeoutMs ?? 30000)),
    ]);
    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    if (!text) {
      diag?.push({ provider: 'claude', ok: false, error: 'empty_text', durationMs: Date.now() - t0 });
      return null;
    }
    logger.info(tag, 'claude_ok', { textLen: text.length, durationMs: Date.now() - t0 });
    diag?.push({ provider: 'claude', ok: true, status: 200, durationMs: Date.now() - t0 });
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(tag, 'claude_failed', { error: msg.slice(0, 200), durationMs: Date.now() - t0 });
    diag?.push({ provider: 'claude', ok: false, error: msg.slice(0, 200), durationMs: Date.now() - t0 });
    return null;
  }
}

/** Gemini 호출 — 최종 유료 폴백 */
async function callGemini(prompt: string, opts: AICallOptions, diag?: ProviderAttempt[]): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const t0 = Date.now();
  const tag = opts.tag ?? 'ai';

  // Skip when quota is exhausted within this Lambda instance
  if (geminiQuotaExhaustedUntil > Date.now()) {
    const remainsMs = geminiQuotaExhaustedUntil - Date.now();
    logger.info(tag, 'gemini_quota_skip', { remainsMs: Math.round(remainsMs / 1000) });
    diag?.push({ provider: 'gemini', ok: false, error: `gemini_quota_exhausted — skipped (resets in ${Math.round(remainsMs / 60000)}m)`, durationMs: 0 });
    return null;
  }

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
      const now = new Date();
      const nextMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      geminiQuotaExhaustedUntil = nextMidnight.getTime();
      logger.error(tag, 'gemini_quota_exhausted', { error: msg.slice(0, 200), durationMs: Date.now() - t0, resetsAt: nextMidnight.toISOString() });
    } else {
      logger.warn(tag, 'gemini_failed', { error: msg.slice(0, 200), durationMs: Date.now() - t0, is503 });
    }
    diag?.push({ provider: 'gemini', ok: false, error: msg.slice(0, 200), durationMs: Date.now() - t0 });
    return null;
  }
}

/**
 * 통합 AI 호출. vLLM → GROQ → Claude Haiku 4.5 → Gemini 체인을 순차 시도.
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
  const g = await callGroq(prompt, opts, attempts);
  if (g) return { text: g.text, source: `GROQ-${g.model}`, durationMs: Date.now() - start };

  // 3. Claude Haiku 4.5 (유료 — GROQ 소진 시 메인 폴백, ~$0.003/call)
  const cl = await callClaude(prompt, opts, attempts);
  if (cl) return { text: cl, source: 'claude-haiku-4-5', durationMs: Date.now() - start };

  // 4. Gemini 2.0 Flash (유료 최종 폴백)
  const gm = await callGemini(prompt, opts, attempts);
  if (gm) return { text: gm, source: 'gemini-2.0-flash', durationMs: Date.now() - start };

  logger.error(opts.tag ?? 'ai', 'all_providers_failed', { durationMs: Date.now() - start, attempts });
  return { text: '', source: 'fallback', durationMs: Date.now() - start, attempts };
}
