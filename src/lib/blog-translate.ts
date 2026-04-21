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

async function callBlogTranslateAI(text: string, langName: string): Promise<string> {
  // 통합 AI 체인 (vLLM → GROQ → Gemini). GROQ llama-3.3-70b는 다국어 번역에
  // 충분하고 마크다운 구조도 잘 보존함. GEMINI_API_KEY 없어도 동작.
  const r = await callAI(
    `Translate the following text to ${langName}. Preserve all markdown formatting (##, ###, numbered lists, etc). Return ONLY the translated text, no explanations.\n\n${text}`,
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
    translated = await callBlogTranslateAI(text, langName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('429') || msg.includes('quota')) return text;
    logger.warn('lib.blog-translate', 'ai_call_failed', { key, error: msg });
    return text;
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
    translateSection(redis, locale, slug, 9000, title, langName),
    translateSection(redis, locale, slug, 9001, metaDescription, langName),
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
    translateSection(redis, locale, slug, 9000, title, langName),
    translateSection(redis, locale, slug, 9001, metaDescription, langName),
  ]);

  return { title: translatedTitle, metaDescription: translatedMeta };
}
