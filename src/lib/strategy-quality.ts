/**
 * strategy-quality.ts — AI 보고서 콘텐츠 품질 게이트 공유 모듈
 *
 * route.ts 와 verify-metrics/route.ts 양쪽에서 동일한 로직을 사용해야 하므로
 * 중앙화. 한쪽만 패치되는 drift 방지.
 */

/** 현재 코드에 존재하는 provider source 접두어 목록.
 *  ai-providers.ts 의 callXxx() 함수 반환값과 동기화 유지. */
export const ALLOWED_AI_SOURCES = [
  'GROQ-',           // callGroq → 'GROQ-llama-3.3-70b-versatile' 등
  'claude-haiku',    // callClaude → 'claude-haiku-4-5'
  'claude-sonnet',   // callClaude (미래 sonnet 경로)
  'gemini-2.0-flash',// callGemini
  'vllm-local',      // callVLLM (2026-06-15 Ollama/EXAONE→vLLM Qwen3.6-27B)
  'EXAONE-3.5',      // callVLLM (legacy — 기존 저장 데이터 호환 유지)
  'qwen-2.5-72b',    // callQwen (OpenRouter 성공 시 고정 레이블 — 실제 모델과 무관)
  'deepseek',        // OpenRouter DeepSeek 계열
  'openrouter',      // OpenRouter generic
] as const;

export const FALLBACK_SOURCES = ['fallback', '데이터 기반'] as const;

/** source 문자열이 현재 코드의 provider 체인에서 나온 것인지 확인.
 *  unknown → 구버전 Vercel 배포 의심. */
export function isKnownSource(source: string | undefined | null): boolean {
  if (!source) return true; // source 필드 없으면 판단 불가 — 낙관적 허용
  const s = source;
  return (
    ALLOWED_AI_SOURCES.some(a => s.includes(a)) ||
    FALLBACK_SOURCES.some(f => s.includes(f))
  );
}

/**
 * 텍스트가 소형 AI 모델의 garbage 출력인지 판단.
 *
 * @param text   검사할 텍스트
 * @param minLen 최소 의미 있는 길이 (필드마다 다름). 기본 15.
 */
export function isGarbage(text: string | undefined | null, minLen = 15): boolean {
  if (!text || text.trim().length === 0) return false; // 빈 값은 별도 처리
  const t = text.trim();

  // Pattern 0: 최소 의미 있는 분석 길이 미달 ("AI+AI+AI"=8자, "bullish"=7자 등)
  if (t.length < minLen) return true;

  // Pattern 1: "X+Y+Z" 3개 이상 세그먼트 (공백 포함) — 프롬프트 에코 목록 형식
  if (/^[^\n+]+(\+[^\n+]+){2,}$/.test(t)) return true;

  // Pattern 1b: 2세그먼트 + 구분 + 80자 미만 — "100일선 돌파+MACD 긍정적 교차" 형식
  // 숫자%·소수점·달러 패턴은 정상 데이터이므로 제외
  if (t.length < 80 && /^[^\n+]{3,}\+[^\n+]{3,}$/.test(t) && !/\d+%|\d+\.\d+|\$\d/.test(t)) return true;

  // Pattern 2: "/" "|" "→" 구분 반복 (Pattern 1 미탐지 보완)
  if (/^[^\n/|→]+([/|→][^\n/|→]+){2,}$/.test(t) && t.length < 80) return true;

  // Pattern 3: 단일 토큰 55% 초과 반복 (4개 이상 토큰) — "AI AI AI AI AI" 패턴
  const tokens = t.split(/[\s,+|/·→]+/).filter(w => w.length > 1);
  if (tokens.length >= 4) {
    const freq = new Map<string, number>();
    for (const tok of tokens) freq.set(tok.toLowerCase(), (freq.get(tok.toLowerCase()) ?? 0) + 1);
    const maxFreq = Math.max(...Array.from(freq.values()));
    if (maxFreq / tokens.length > 0.55) return true;
  }

  return false;
}

/** isGarbage의 필드별 minLen 기본값 */
export const GARBAGE_MIN_LEN = {
  thesis:            25, // 투자 thesis는 문장이어야 함
  macroAnalysis:     30, // 거시 분석은 한 단락 이상
  technicalAnalysis: 15,
  fundamentalAnalysis: 15,
  narrative:         15,
} as const;
