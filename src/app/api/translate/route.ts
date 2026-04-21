import { logger, loggedRedisSet } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { callAI } from '@/lib/ai-providers';

// ── Redis cache (30-day TTL for translations) ─────────────────────────────────
const CACHE_TTL = 30 * 24 * 60 * 60;

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

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
    const aiRes = await callAI(
      `Translate the following text to ${langName}. Return ONLY the translated text, no explanations, no quotes.\n\n${text}`,
      {
        maxTokens: 1024,
        temperature: 0.1,
        skipVllm: true,
        timeoutMs: 15000,
        tag: 'translate',
      },
    );
    const translated = aiRes.text.trim();

    // AI 체인이 모두 실패하면 원본 반환 (UI는 영문 원문 표시)
    if (!translated) {
      return NextResponse.json({ translated: text });
    }

    // 3. Store in Redis (loggedRedisSet 사용 — CLAUDE.md 규칙)
    if (redis && translated) {
      try {
        await loggedRedisSet(redis, 'api.translate', key, translated, { ex: CACHE_TTL });
      } catch (e) {
        logger.error('translate', 'save_failed', { key, error: e });
      }
    }

    return NextResponse.json({ translated, source: aiRes.source });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error';
    // Rate limit — return original text gracefully
    if (msg.includes('429') || msg.includes('quota')) {
      return NextResponse.json({ translated: '' });
    }
    console.error('translate error:', msg);
    return NextResponse.json({ translated: '' });
  }
}
