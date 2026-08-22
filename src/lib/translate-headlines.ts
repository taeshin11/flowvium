/**
 * 공통 번역 helper — 영어 뉴스 헤드라인/요약을 16개 언어로 batch 번역.
 * news-cascade, company-news, insider-trades, earnings 등에서 재사용.
 *
 * AI provider 우선순위: 로컬 LLM → Groq → Gemini → Claude → fallback
 *
 * 2026-08-22 정정: 위 주석은 "Ollama (로컬) → ..." 라고 *주장* 했는데 코드는
 *   `skipVllm: true` 로 로컬을 건너뛰고 곧장 클라우드로 갔다. 주석이 코드보다 낙관적이었다.
 *   붙어 있던 근거("EXAONE 제외 — 다국어 약함")도 낡았다 — 현재 로컬은 Qwen3 이고
 *   news-cascade 가 같은 경로(localChat)로 16개 언어를 성공적으로 번역한다.
 *   CLAUDE.md 규칙: 번역 소비처는 **전부** 로컬 우선, cloud 는 fallback.
 *   GPU 포화 시 localChat 이 null 을 돌려주므로 자동으로 클라우드로 넘어간다.
 *
 * 캐시는 caller 가 Redis 로 처리. 이 모듈은 stateless.
 */
import { callAI } from '@/lib/ai-providers';
import { localChat } from '@/lib/llm-local';
import { logger } from '@/lib/logger';

export const LOCALE_NAMES: Record<string, string> = {
  ko: 'Korean (한국어)',
  ja: 'Japanese (日本語)',
  'zh-CN': 'Simplified Chinese (简体中文)',
  'zh-TW': 'Traditional Chinese (繁體中文)',
  es: 'Spanish (Español)',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
  pt: 'Portuguese (Português)',
  ru: 'Russian (Русский)',
  ar: 'Arabic (العربية)',
  hi: 'Hindi (हिन्दी)',
  id: 'Indonesian (Bahasa Indonesia)',
  th: 'Thai (ไทย)',
  tr: 'Turkish (Türkçe)',
  vi: 'Vietnamese (Tiếng Việt)',
};

export interface TranslatableItem {
  /** title 또는 headline */
  title?: string;
  /** summary, body, detail 등 부가 텍스트 */
  summary?: string;
}

/**
 * Batch 번역 — items 배열을 한 번의 LLM 호출로 처리.
 * locale='en' 이거나 미지원 locale 이면 원문 그대로 반환.
 * 실패 시 원문 반환 (UI 깨짐 방지).
 */
export async function translateItems<T extends TranslatableItem>(
  items: T[],
  locale: string,
  tag: string = 'translate-headlines',
): Promise<T[]> {
  if (locale === 'en' || !LOCALE_NAMES[locale] || !items.length) return items;
  const langName = LOCALE_NAMES[locale];

  const payload = items.map((it, i) => ({
    i,
    title: (it.title ?? '').slice(0, 200),
    summary: (it.summary ?? '').slice(0, 300),
  }));

  const prompt = `Translate the following financial news fields to ${langName}.
Keep ticker symbols (NVDA, AAPL, CRM, etc.), asset names (S&P500, Bonds), numbers/percentages, and proper nouns unchanged.
Tone: professional financial analyst.
Return STRICT JSON array — same length, same order, same shape:
[{ "i": <int>, "title": "<translated>", "summary": "<translated>" }, ...]
NO extra fields, NO commentary.

Input:
${JSON.stringify(payload, null, 2)}

Output (JSON array only):`;

  try {
    // 로컬 우선. GPU 포화면 localChat 이 null → 아래 클라우드로 넘어간다(스스로 조절된다).
    let text = await localChat(prompt, { temperature: 0.3, maxTokens: 6000, timeoutMs: 30000 });
    if (!text) {
      const r = await callAI(prompt, { tag, maxTokens: 6000, temperature: 0.3, skipVllm: true, timeoutMs: 30000 });
      text = r.text;
      if (!text) logger.warn(tag, 'translate_all_providers_empty', { locale, items: items.length });
    }
    const r = { text };
    if (!r.text) return items;
    const jsonMatch = r.text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!jsonMatch) return items;
    const translated = JSON.parse(jsonMatch[0]) as Array<{
      i: number; title?: string; summary?: string;
    }>;
    const byIdx = new Map(translated.map(t => [t.i, t]));
    return items.map((it, i) => {
      const t = byIdx.get(i);
      if (!t) return it;
      return {
        ...it,
        title: t.title?.trim() || it.title,
        summary: t.summary?.trim() || it.summary,
      };
    });
  } catch (e) {
    logger.warn(tag, 'translation_failed', { locale, error: String(e).slice(0, 100) });
    return items;
  }
}
