import { logger, loggedRedisSet} from '@/lib/logger';
import { callAI } from '@/lib/ai-providers';
import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

// ── Redis cache (7-day TTL) ───────────────────────────────────────────────────
const CACHE_TTL = 7 * 24 * 60 * 60; // seconds

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function cacheKey(ticker: string, type: string): string {
  return `flowvium:ai:v1:${type}:${ticker.toUpperCase()}`;
}

// ── POST — main analysis endpoint ─────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const { prompt, type, ticker } = await request.json() as {
      prompt: string;
      type?: string;
      ticker?: string;
    };

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // 1. Redis cache check — avoids Gemini call if result already exists
    const redis = createRedis();
    if (redis && ticker && type) {
      try {
        const cached = await redis.get<string>(cacheKey(ticker, type));
        if (cached) {
          return NextResponse.json({ analysis: cached, cached: true });
        }
      } catch {
        // Redis failure is non-fatal
      }
    }

    // 2. 통합 cascade: vLLM → GROQ → Gemini (자세한 순서는 ai-providers.ts)
    const systemPrompt = `You are Flowvium AI, an expert macro and supply chain investment analyst.
You understand hidden structural forces: regulatory capture, Cantillon effect, dark pools, revolving door,
military-industrial complex, sovereign wealth, crisis-as-wealth-transfer.
Analysis type: ${type || 'general'}`;

    const { text, source, attempts } = await callAI(prompt, {
      systemPrompt,
      maxTokens: 1600,
      temperature: 0.7,
      tag: 'api.ai',
      timeoutMs: 30000,
    });

    if (!text) {
      // 체인 전체 실패 — attempts[] 에서 구체 원인 추출해 사용자에 명시
      const groq = attempts?.find((a) => a.provider === 'groq');
      let reason = 'AI analysis is currently unavailable.';
      if (groq?.status === 429 && typeof groq.error === 'string') {
        if (groq.error.includes('tokens per day')) {
          reason = 'AI 일일 토큰 한도 소진 (GROQ 100k/일). UTC 00:00 리셋 예정.';
        } else if (groq.error.includes('tokens per minute')) {
          reason = 'AI 분당 토큰 한도 일시 초과. 1분 내 재시도 가능.';
        } else {
          reason = 'AI 요청 한도 초과.';
        }
      } else if (!attempts?.length) {
        reason = 'No AI provider configured (VLLM_URL / GROQ_API_KEY / GEMINI_API_KEY 모두 미설정).';
      }
      return NextResponse.json({ analysis: reason, exhausted: true });
    }
    const analysis = text;
    logger.info('api.ai', 'analysis_source', { source, ticker, type });

    // 3. Store result in Redis (non-fatal if fails)
    if (redis && ticker && type) {
      await loggedRedisSet(redis, 'api.ai', cacheKey(ticker, type), analysis, { ex: CACHE_TTL });
    }

    return NextResponse.json({ analysis, cached: false });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('429') || message.includes('quota')) {
      logger.warn('api.ai', 'rate_limited', { message });
      return NextResponse.json({
        analysis: 'AI analysis is temporarily rate-limited. Please try again in a few moments.',
      });
    }

    logger.error('api.ai', 'analysis_failed', { error: message });
    return NextResponse.json({
      analysis: 'AI analysis encountered an error. Please try again later.',
    });
  }
}

// ── DELETE — cache invalidation (admin) ──────────────────────────────────────

export async function DELETE(request: Request) {
  if (request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { ticker, type } = await request.json() as { ticker: string; type?: string };
  const redis = createRedis();
  if (!redis || !ticker) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  const key = cacheKey(ticker, type ?? 'general');
  await redis.del(key);
  return NextResponse.json({ deleted: key });
}
