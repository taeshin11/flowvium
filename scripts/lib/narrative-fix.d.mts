// scripts/lib/narrative-fix.mjs 의 TS 선언 — src(judge-chat 등)에서 문자열 sanitizer 재사용용.
//   (buy-sell-engine.d.ts 패턴 — 공유 .mjs 모듈에 최소 타입만.)
export function sanitizeText(s: string, locale?: string): string;
export function sanitizeReport(report: unknown, locale?: string): { nFix: number };
export function fixDuplicateCentralBankEvents(report: unknown): { nFix: number };
export function correctNarrative(report: unknown, opts?: Record<string, unknown>): { nFix: number; realBp: number | null };
export function fetchIndexChangeMap(): Promise<Record<string, number>>;
