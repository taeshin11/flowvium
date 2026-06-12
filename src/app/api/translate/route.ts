import { logger, loggedRedisSet } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { callAI } from '@/lib/ai-providers';
import { isGarbage } from '@/lib/strategy-quality';
import { localChatNoBleed } from '@/lib/llm-local';

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


export async function POST(request: NextRequest) {
  try {
    const { text, targetLocale } = await request.json() as { text: string; targetLocale: string };

    if (!text || !targetLocale || targetLocale === 'en') {
      return NextResponse.json({ translated: text });
    }

    // 2026-06-12 GPU 폭주 사건: ko 보고서의 한국어 원문(engineReview 줄 등)이 ko→ko 로
    //   qwen 20s×N 왕복 — 보고서 발간(5회/일)마다 캐시 무효화돼 GPU 수십분 점유. 원문이
    //   이미 목표 언어(한글 실질 포함)면 결정론 검사로 LLM/Redis 전부 우회.
    if (targetLocale === 'ko') {
      const hangul = (text.match(/[가-힣]/g) ?? []).length;
      if (hangul >= 4) {
        return NextResponse.json({ translated: text, source: 'already-target' });
      }
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
    // localChatNoBleed: qwen3 네이티브 + bleed 감지 시 1회 재생성, 끝까지 누출이면 null → cloud fallback.
    const ollamaTxt = await localChatNoBleed(prompt, targetLocale, { maxTokens: 2048, timeoutMs: 60000 });
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

    // 2026-06-12 instruction-echo 가드 (ALLE "출력은 목표 언어만으로 하세요" 사건): 짧은 입력에서
    //   소형 모델이 프롬프트 지시문을 번역해 echo — 출력이 전부 한글이라 bleed 검사를 통과하고
    //   30d 캐시에 오염 저장됨. 지시문 조각 검출 또는 비정상 길이 팽창(4x+40) 시 원문 fallback.
    const ECHO_FRAGMENTS = /목표 언어|포함하지 마세요|外国|문자를 포함|Output ONLY|target language|foreign script|no explanations|번역만|Translate the following/i;
    if (ECHO_FRAGMENTS.test(translated) || translated.length > text.length * 4 + 40) {
      logger.warn('api.translate', 'instruction_echo_detected', { targetLocale, inLen: text.length, outLen: translated.length, sample: translated.slice(0, 80) });
      return NextResponse.json({ translated: text, source: 'echo-fallback' });
    }

    // 2026-06-12 혼종단어 가드 ("에타ching" 사건): 한글 음절 바로 뒤에 영문 소문자가 붙은 단어 =
    //   반쪽 번역(소형모델이 단어 중간에서 언어 전환). 오염 번역보다 원문이 낫다 — fallback + 캐시 금지.
    if (targetLocale === 'ko' && /[가-힣][a-z]/.test(translated)) {
      logger.warn('api.translate', 'mixed_word_detected', { targetLocale, sample: translated.slice(0, 80) });
      return NextResponse.json({ translated: text, source: 'mixed-fallback' });
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
