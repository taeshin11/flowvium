/**
 * src/lib/llm-local.ts — 로컬 Ollama 단일 진입점 (2026-06-07 모델 통일).
 *
 * 배경(사용자): "모델이 다 같아야 — 보고서에 쓰는 모델로". 종전 번역/추출은 /v1 OpenAI-compat +
 *   exaone3.5 였고 보고서는 /api/chat 네이티브 + qwen3:8b(think:false). 모델 2개 = GPU 모델스왑
 *   경합. 단일 qwen3:8b 로 통일 — 보고서와 동일 네이티브 호출(think:false 라야 thinking 안 샘).
 *
 * + 중국어 bleeding 하네스: qwen(중국계)이 타언어 출력에 한자 누출 → hasChineseBleed 로 감지.
 */
const OLLAMA_CHAT = 'http://localhost:11434/api/chat';
export const LOCAL_MODEL = process.env.OLLAMA_TRANSLATE_MODEL || 'qwen3:8b';

export async function localChat(
  prompt: string,
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  try {
    const res = await fetch(OLLAMA_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LOCAL_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        think: false, // qwen3 thinking 비활성 — 네이티브 API 만 지원(/v1 미지원이라 종전 실패).
        options: { temperature: opts.temperature ?? 0.1, num_predict: opts.maxTokens ?? 2048 },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { message?: { content?: string } };
    const t = (d.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return t || null;
  } catch {
    return null;
  }
}

// ── 중국어 bleeding 하네스 ───────────────────────────────────────────────────────
const HAN = /[一-鿿]/;          // CJK 한자(중국어/일본어 한자/한국 한자 공통)
const HANGUL = /[가-힣]/;
const KANA = /[぀-ヿ]/;
/**
 * 출력에 target locale 에 부적절한 CJK 가 샜는지(qwen 중국어 누출) 감지.
 *   ko: 한자 2개+ (현대 한국어 뉴스는 한글 — 한자 누출=bleed; 소수 고유명사 허용 위해 임계 2)
 *   ja: 한글 출현 (일본어 한자/가나는 정상)
 *   zh-CN/zh-TW: 정상(false)
 *   기타(Latin/Cyrillic/Arabic/…): CJK 아무거나 = bleed
 */
export function hasChineseBleed(text: string, locale: string): boolean {
  if (!text) return false;
  if (locale === 'zh-CN' || locale === 'zh-TW' || locale === 'en') {
    // en 도 보통 CJK 없어야 하나 ticker/회사명 한자 드묾 — han 2개+ 만 bleed.
    if (locale === 'en') return (text.match(HAN_G) || []).length >= 2 || HANGUL.test(text) || KANA.test(text);
    return false;
  }
  if (locale === 'ja') return HANGUL.test(text);
  if (locale === 'ko') return (text.match(HAN_G) || []).length >= 2;
  return HAN.test(text) || HANGUL.test(text) || KANA.test(text);
}
const HAN_G = /[一-鿿]/g;
