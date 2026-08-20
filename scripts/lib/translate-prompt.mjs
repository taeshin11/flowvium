/**
 * translate-prompt.mjs — 번역 프롬프트 조립. 원문 문맥을 함께 넘긴다.
 *
 * 왜: 뉴스 요약은 왕복 번역을 거친다. 한국어 기사 → cascade AI 가 영어 요약 생성
 * (CASCADE_SYSTEM_PROMPT 가 'Use English exclusively') → 다시 한국어 번역.
 * 이 과정에서 고유명사가 뭉개진다 — 코스피가 'Korean Composite' 가 되고,
 * 다시 번역하면 '네이셔널컴포지트'가 된다. 번역기는 그게 코스피인지 알 방법이 없다.
 *
 * 실험(2026-08-20, 같은 문장·같은 기계):
 *   4B  현재 프롬프트    "한국 합성 지수는…"            오역        1초
 *   4B  원제목 문맥 추가  "코스피의 3일 상승은 닛케이…"   정확 ✅     1초
 *   27B 현재 프롬프트    "한국 증시의 3일 연속 상승을…"   '코스피' 아님 42초
 * → 문맥을 주는 것이 모델을 키우는 것보다 정확하고 빠르다. 모델 크기 문제가 아니었다.
 *
 * 문맥이 없거나 본문과 같으면 종전과 동일한 단순 프롬프트를 쓴다(회귀 없음).
 */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function buildTranslatePrompt({ text, langName, context }) {
  const base = `Translate to ${langName}. Return ONLY the translation — no quotes, no notes, no original text.\n\n${text}`;
  const ctx = norm(context);
  if (!ctx || ctx === norm(text)) return base;
  return `Translate to ${langName}. Return ONLY the translation — no quotes, no notes.

This text summarizes a news article whose original headline was:
"${ctx}"
Use the same proper nouns, tickers and terminology as the headline when they refer to the same entities. Do not re-translate names that already appear in the headline.

Text:
${text}`;
}
