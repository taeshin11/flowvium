import { isUntranslated } from '@/lib/lang-detect';
import { logger, loggedRedisSet } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { lookupMemory } from '@/lib/translation-memory';
import { hasScriptSplice } from '@/lib/script-splice';
import { llmTimeoutMs } from '@/lib/ai-providers';
import type { Redis } from '@upstash/redis';
import { callAI } from '@/lib/ai-providers';
import { isGarbage } from '@/lib/strategy-quality';
import { localChatNoBleed } from '@/lib/llm-local';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

// ── Redis cache (30-day TTL for translations) ─────────────────────────────────
const CACHE_TTL = 30 * 24 * 60 * 60;

function cacheKey(locale: string, text: string): string {
  // 2026-06-14 (ChatGPT D0-8 차용): 앞 100자 discriminator → 긴 문단이 앞부분만 같으면 다른 번역인데
  //   같은 키 충돌(서로 다른 종목 rationale 가 같은 도입부면 한쪽 번역이 다른쪽에 적용). 전체 텍스트
  //   sha256 해시로 교체 (v1→v2, 기존 캐시 자연 재생성).
  const hash = createHash('sha256').update(text).digest('base64url').slice(0, 24);
  return `flowvium:tr:v2:${locale}:${hash}`;
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

    // 2026-06-12: en 무조건 skip → 한글 미포함 시만 skip. 보고서가 ko 로컬 발간 단일 진실이
    //   되면서 en 사용자도 한국어 원문(rationale 등)을 번역해 봐야 함.
    if (!text || !targetLocale || (targetLocale === 'en' && !/[가-힣]/.test(text))) {
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

    // 0. 확정 번역 사전 (2026-08-20 신설)
    //    웹 레인은 4B 라 금융 용어를 틀린다("Short squeeze candidate" → "단축 압력 후보").
    //    반복 용어는 27B 품질로 미리 확정해 두고 여기서 먼저 조회한다 — GPU 를 아예 안 건드린다.
    //    Redis 앞에 두는 이유: Redis 는 30일 TTL 이라 만료되면 다시 4B 로 가고, 그때 품질이 내려앉는다.
    const memo = lookupMemory(text, targetLocale);
    if (memo) return NextResponse.json({ translated: memo, source: 'memory' });

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
    // 2026-08-20: timeoutMs 60s 고정은 maxTokens 2048 에 구조적으로 부족했다(실측 ~10 tok/s → 필요 ~235s).
    //   생성 도중 끊기면 상위에서 '번역 실패'로 보이지만 원인은 모델이 아니라 타임아웃이다.
    //   저장소에 이미 있는 파생식을 쓴다(src/lib/ai-providers.ts llmTimeoutMs).
    const TRANSLATE_MAX_TOKENS = 2048;
    const ollamaTxt = await localChatNoBleed(prompt, targetLocale, {
      maxTokens: TRANSLATE_MAX_TOKENS,
      timeoutMs: llmTimeoutMs(TRANSLATE_MAX_TOKENS),
    });
    // 2026-08-20: 성공 판정을 '바뀌었는가'(대리지표)에서 '대상 언어인가'(결과)로 바꾼다.
    //   종전 `ollamaTxt !== text` 는 모델이 짧은 명사 나열을 그대로 되돌려줄 때 '실패'로 보고
    //   cloud 로 넘겼는데, 자가호스팅이라 키가 revoked 여서 원문(영문)이 그대로 사용자에게 나갔다
    //   (실측: "Industrial conglomerates, machinery, aerospace, and transportation.").
    //   반대로 원문이 이미 대상 언어면 '동일 출력'이 정답인데도 실패로 봤다.
    //   lang-detect 는 판정 불가(티커·숫자)를 und 로 돌려주므로 오탐도 함께 줄어든다.
    //   같은 원칙을 translation-gate.mjs 에도 적용했다 — 이 저장소에 반복되는 교훈이다.
    const localOk = !!ollamaTxt && !isUntranslated(ollamaTxt.trim(), targetLocale);
    if (localOk) {
      translated = ollamaTxt!.trim();
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

    // 2026-06-14 모지바케 가드 (NVDA "H100/H200 GPUs"→"¶4◇¦��c◆" 사건): 로컬 모델이 영숫자
    //   제품코드 토큰 번역 시 깨진 바이트(U+FFFD `�`) 또는 기호 blob 을 출력 — 기존 garbage/echo/
    //   mixed 가드가 못 잡음. 원문에 없는 치환문자/기호 밀집 검출 시 원문 fallback(캐시 금지).
    //   U+FFFD(치환문자)는 즉시 깨짐. + 정상 번역에 안 나오는 제어/기하도형/딩벳 기호(¶¦◇◆ 등)
    //   2개 이상이면 모지바케. (ES5 타깃이라 \p{L}/u 플래그 불가 → BMP 코드유닛 범위 직접 매칭.)
    const replacementCount = (translated.match(/�/g) ?? []).length;
    const brokenSymbols = (translated.match(/[¦¶─-➿]/g) ?? []).length;
    if (replacementCount > 0 || brokenSymbols >= 2) {
      logger.warn('api.translate', 'mojibake_detected', { targetLocale, replacementCount, brokenSymbols, sample: translated.slice(0, 80) });
      return NextResponse.json({ translated: text, source: 'mojibake-fallback' });
    }

    // 2026-08-20: 음차 중단("케urig 드피퍼", "산업 컨glomerate") 검출.
    //   기존 mixed/mojibake 가드는 이 서명을 못 잡는다 — 목표 문자가 우세하고 '미번역'도 아니기 때문.
    //   캐시에 들어가면 30일간 깨진 번역이 고착되므로 저장 전에 막고 원문으로 돌린다.
    if (translated && hasScriptSplice(translated, targetLocale)) {
      logger.warn('api.translate', 'script_splice_detected', { targetLocale, sample: translated.slice(0, 80) });
      return NextResponse.json({ translated: text, source: 'splice-fallback' });
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
