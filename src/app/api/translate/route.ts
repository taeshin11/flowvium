import { logger, loggedRedisSet } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { callAI } from '@/lib/ai-providers';
import { isGarbage } from '@/lib/strategy-quality';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

// ── Redis cache (30-day TTL for translations) ─────────────────────────────────
const CACHE_TTL = 30 * 24 * 60 * 60;

function cacheKey(locale: string, text: string): string {
  // Use first 100 chars as key discriminator
  return `flowvium:tr:v1:${locale}:${text.substring(0, 100).replace(/\s+/g, ' ')}`;
}

const localeNames: Record<string, string> = {
  ko: 'Korean', ja: 'Japanese', 'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese', es: 'Spanish', fr: 'French',
  de: 'German', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic',
  hi: 'Hindi', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
  tr: 'Turkish',
};

// 2026-06-03: 자가호스팅 로컬 Ollama 우선 번역. cloud callAI 가 groq/gemini quota 소진으로
//   원문(영어) 그대로 반환 → 회사/Cascade/Explore 페이지 미번역. news-cascade 와 동일 root cause.
async function translateViaOllama(prompt: string): Promise<string | null> {
  try {
    const res = await fetch('http://localhost:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_TRANSLATE_MODEL || 'qwen3:8b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const d = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    let txt = d.choices?.[0]?.message?.content?.trim() || '';
    txt = txt.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return txt || null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { text, targetLocale } = await request.json() as { text: string; targetLocale: string };

    if (!text || !targetLocale || targetLocale === 'en') {
      return NextResponse.json({ translated: text });
    }

    // 1. Check Redis cache
    const redis = createRedis();
    const key = cacheKey(targetLocale, text);
    if (redis) {
      try {
        const cached = await redis.get<string>(key);
        if (cached) return NextResponse.json({ translated: cached, cached: true });
      } catch { /* non-fatal */ }
    }

    // 2. Translate via 통합 AI 체인 (vLLM → GROQ → Gemini)
    //    GROQ의 llama-3.3-70b는 다국어 번역에도 충분 — GEMINI 미설정 시에도 정상 동작.
    //    EXAONE 2.4B는 일반 번역엔 약해 skipVllm=true.
    const langName = localeNames[targetLocale] ?? targetLocale;
    const prompt = `Translate the following text to ${langName}. Return ONLY the translated text, no explanations, no quotes.\n\n${text}`;
    // 2026-06-03: 로컬 Ollama 우선 (cloud quota 무관). 실패/원문동일 시 cloud callAI fallback.
    let translated = '';
    let source = 'ollama';
    const ollamaTxt = await translateViaOllama(prompt);
    if (ollamaTxt && ollamaTxt.trim() !== text.trim()) {
      translated = ollamaTxt.trim();
    } else {
      const aiRes = await callAI(prompt, {
        maxTokens: 1024,
        temperature: 0.1,
        skipVllm: true,
        preferSmallModel: true, // 8b preserves 70b quota for strategy/daily-brief
        timeoutMs: 15000,
        tag: 'translate',
      });
      translated = aiRes.text.trim();
      source = aiRes.source;
    }

    // AI 체인이 모두 실패하면 원본 반환 (UI는 영문 원문 표시)
    if (!translated) {
      return NextResponse.json({ translated: text });
    }

    // Garbage check: 반복 토큰·최소 길이 미달이면 원문 반환, 캐시 안 함
    const minLen = Math.max(3, Math.min(8, text.length));
    if (isGarbage(translated, minLen)) {
      logger.warn('api.translate', 'garbage_detected', { targetLocale, sample: translated.slice(0, 80) });
      return NextResponse.json({ translated: text, source: 'garbage-fallback' });
    }

    // 3. Store in Redis (loggedRedisSet 사용 — CLAUDE.md 규칙)
    if (redis && translated) {
      try {
        await loggedRedisSet(redis, 'api.translate', key, translated, { ex: CACHE_TTL });
      } catch (e) {
        logger.error('translate', 'save_failed', { key, error: e });
      }
    }

    return NextResponse.json({ translated, source });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error';
    // Rate limit — return original text gracefully
    if (msg.includes('429') || msg.includes('quota')) {
      return NextResponse.json({ translated: '' });
    }
    logger.error('api.translate', 'unhandled_error', { error: msg });
    return NextResponse.json({ translated: '' });
  }
}
