/**
 * Blog translation with permanent Redis caching.
 * Translates once per locale/slug, never calls Gemini again for the same content.
 *
 * Strategy:
 *   1. Split content on ## headings into sections (each fits in one Gemini call)
 *   2. Check Redis for every section in parallel — if ALL hit, return immediately (0 Gemini calls)
 *   3. Translate missing sections in parallel (minimum Gemini calls)
 *   4. Store each section in Redis with 180-day TTL
 */

import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from './logger';
import { callAI } from './ai-providers';
import { localChatNoBleed } from './llm-local';

const BLOG_CACHE_TTL = 180 * 24 * 60 * 60; // 180 days

const localeNames: Record<string, string> = {
  ko: 'Korean', ja: 'Japanese', 'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese', es: 'Spanish', fr: 'French',
  de: 'German', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic',
  hi: 'Hindi', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
  tr: 'Turkish',
};

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** Split content into sections on ## / ### headings, keeping heading with its body. */
function splitSections(content: string): string[] {
  const lines = content.split('\n');
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if ((line.startsWith('## ') || line.startsWith('### ')) && current.length > 0) {
      const joined = current.join('\n').trim();
      if (joined) sections.push(joined);
      current = [line];
    } else {
      current.push(line);
    }
  }
  const last = current.join('\n').trim();
  if (last) sections.push(last);

  return sections;
}

/**
 * @param plain true 면 *평문 한 줄* 필드(제목·메타설명)다. 마크다운을 넣으면 안 된다.
 *   2026-08-22 실측 회귀(내가 만든 것): 본문 섹션과 같은 프롬프트("Preserve all markdown
 *   formatting (##, ###, ...)")를 제목에도 써서, 로컬 모델이 제목을 `## 2026 완전 반도체 공급망 지도`
 *   로 감쌌다. /ko/blog 화면에 `## ` 접두가 22줄 그대로 보였다.
 *   필드의 계약이 다르면 프롬프트도 달라야 한다.
 */
async function callBlogTranslateAI(text: string, langName: string, locale: string, plain = false): Promise<string> {
  // 2026-08-22 정정: 이 주석은 "통합 AI 체인 (vLLM → GROQ → Gemini)" 이라고 *주장* 했는데
  //   정작 아래 호출이 `skipVllm: true` 라 로컬을 건너뛰고 곧장 클라우드로 갔다.
  //   자가호스팅이라 클라우드 쿼터는 상시 소진 가정이고(CLAUDE.md), 실측으로도
  //   ko 블로그 캐시가 0/8 적중이었다 — 즉 이 경로는 사실상 한 번도 성공한 적이 없다.
  //   그래서 /ko/blog 목록의 제목·요약이 전부 영문이었다.
  //   CLAUDE.md 규칙: 번역 소비처는 **전부** 로컬 우선, cloud 는 fallback.
  //   GPU 포화 시 localChatNoBleed 가 null 을 돌려주므로 자동으로 클라우드로 넘어간다.
  const prompt = plain
    ? `Translate the following short text to ${langName}. It is a plain title/description — return it as ONE single line of plain text. Do NOT add markdown (no #, ##, *, -, backticks), no quotes, no explanations.\n\n${text}`
    : `Translate the following text to ${langName}. Preserve all markdown formatting (##, ###, numbered lists, etc). Return ONLY the translated text, no explanations.\n\n${text}`;
  const local = await localChatNoBleed(prompt, locale, { temperature: 0.1, maxTokens: 2048, timeoutMs: 25000 });
  if (local && local.trim()) return local.trim();
  const r = await callAI(
    prompt,
    {
      maxTokens: 2048,
      temperature: 0.1,
      skipVllm: true,
      timeoutMs: 25000,
      tag: 'blog-translate',
    },
  );
  return r.text.trim() || text;
}

async function translateSection(
  redis: Redis | null,
  locale: string,
  slug: string,
  idx: number,
  text: string,
  langName: string,
  plain = false,
): Promise<string> {
  const key = `flowvium:blog:v2:${locale}:${slug}:${idx}`;

  // 1. Try Redis
  if (redis) {
    try {
      const cached = await redis.get<string>(key);
      if (cached) return cached;
    } catch { /* non-fatal */ }
  }

  // 2. Call AI cascade
  let translated = text;
  try {
    translated = await callBlogTranslateAI(text, langName, locale, plain);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    // 2026-08-22: 종전엔 429/quota 를 *로그 없이* 삼키고 원문을 돌려줬다. 캐시는
    //   `translated !== text` 일 때만 쓰므로 아무 흔적도 남지 않는다 —
    //   실측으로 ko 캐시 0/8, 관련 로그 0건이었다. 매 방문마다 조용히 실패하고 있었다.
    //   실패는 보여야 고칠 수 있다. 원문 반환(graceful degradation)은 그대로 두되 기록은 남긴다.
    logger.warn('lib.blog-translate',
      (msg.includes('429') || msg.includes('quota')) ? 'quota_exhausted' : 'ai_call_failed',
      { key, locale, error: msg.slice(0, 120) });
    return text;
  }

  // 평문 필드의 계약을 강제한다. 모델이 지시를 어겨 `## …` 로 감싸는 경우가 있고(실측),
  //   그대로 캐시에 넣으면 180일 동안 화면에 마크다운 기호가 남는다.
  //   증상을 가리는 게 아니라 *필드 계약*(제목은 평문 한 줄)을 지키는 것이다.
  if (plain && translated) {
    const cleaned = translated.replace(/^\s*#{1,6}\s*/, '').split('\n')[0].trim();
    if (cleaned !== translated) {
      logger.warn('lib.blog-translate', 'plain_field_had_markdown', { key, sample: translated.slice(0, 60) });
      translated = cleaned;
    }
  }

  // 3. Store in Redis
  if (redis && translated && translated !== text) {
    await loggedRedisSet(redis, 'lib.blog-translate', key, translated, { ex: BLOG_CACHE_TTL });
  }

  return translated;
}

export interface TranslatedPost {
  title: string;
  metaDescription: string;
  content: string;
}

/**
 * Translate a blog post's title, metaDescription, and content for the given locale.
 * Returns original English strings if locale === 'en' or translation fails.
 * All translated sections are cached in Redis — subsequent calls are instant.
 */
export async function translateBlogPost(
  locale: string,
  slug: string,
  title: string,
  metaDescription: string,
  content: string,
): Promise<TranslatedPost> {
  if (locale === 'en') return { title, metaDescription, content };

  const langName = localeNames[locale];
  if (!langName) return { title, metaDescription, content };

  const redis = createRedis();
  const sections = splitSections(content);

  // Translate title, metaDescription, and all content sections in parallel
  const [translatedTitle, translatedMeta, ...translatedSections] = await Promise.all([
    translateSection(redis, locale, slug, 9000, title, langName, true),
    translateSection(redis, locale, slug, 9001, metaDescription, langName, true),
    ...sections.map((section, idx) =>
      translateSection(redis, locale, slug, idx, section, langName)
    ),
  ]);

  return {
    title: translatedTitle,
    metaDescription: translatedMeta,
    content: translatedSections.join('\n\n'),
  };
}

/**
 * Translate just title + metaDescription for blog list cards.
 * Very cheap — 2 short strings per post per locale.
 */
export async function translateBlogSummary(
  locale: string,
  slug: string,
  title: string,
  metaDescription: string,
): Promise<{ title: string; metaDescription: string }> {
  if (locale === 'en') return { title, metaDescription };

  const langName = localeNames[locale];
  if (!langName) return { title, metaDescription };

  const redis = createRedis();
  const [translatedTitle, translatedMeta] = await Promise.all([
    translateSection(redis, locale, slug, 9000, title, langName, true),
    translateSection(redis, locale, slug, 9001, metaDescription, langName, true),
  ]);

  return { title: translatedTitle, metaDescription: translatedMeta };
}
