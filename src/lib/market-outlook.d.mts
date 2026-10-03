/** market-outlook.mjs 타입 — 맨 위 시장 전망을 결정론 판정에서. */
export type Stance = 'bullish' | 'neutral' | 'bearish';
export function verdictStance(v: string | undefined | null): Stance | null;
export function outlookStance(mv: { verdict?: string; krVerdict?: { verdict?: string } } | null | undefined): Stance | null;
