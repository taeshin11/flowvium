// scripts/lib/chat-verify.mjs 의 TS 선언 — src(judge-chat)에서 챗 답변 검증·교정 단일 소스 재사용용.
//   (narrative-fix.d.mts / buy-sell-engine.d.ts 패턴 — 공유 .mjs 모듈에 최소 타입만.)
export interface ChatDefect { type: string; detail?: string }
export interface ChatGrounding {
  tickers?: Array<{ ticker: string; name?: string; price: number | null; rsi?: number | null; fiscalYear?: string | null }>;
  usedFiling?: boolean;
  expectedAction?: { action: string; verdict: string; net: number } | null;
  [k: string]: unknown;
}
export function checkChatDefects(question: string, answer: string, grounding?: ChatGrounding, locale?: string): ChatDefect[];
export function sanitizeAnswer(text: string, grounding?: ChatGrounding, locale?: string): string;
export const DEFECT_LESSON: Record<string, string>;
