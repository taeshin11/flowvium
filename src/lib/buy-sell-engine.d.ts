/** 매수/매도 룰 평가기 단일 소스 (buy-sell-engine.mjs 타입). 챗·보고서 공유. */
export interface RuleCondition { type: string; [k: string]: unknown }
export interface Rule { id: string; score: number; category?: string; condition: RuleCondition; description?: string; urgency?: string }

/** 평가기 ctx — 호출자가 자기 데이터로 채움. 없는 필드의 룰은 자동 skip. 모든 필드 optional. */
export interface EngineCtx {
  price?: number | null; change1d?: number | null;
  sma50?: number | null; sma200?: number | null; high20d?: number | null; high52w?: number | null; low52w?: number | null;
  rsi?: number | null; volPct?: number | null;
  roe?: number | null; opMargin?: number | null; opMarginExpand?: number | null; opMarginDecline?: number | null;
  peRatio?: number | null; pbRatio?: number | null; sectorPe?: number | null; revenueGrowth?: number | null; revenueYoY?: number | null;
  peg?: number | null; earningsYield?: number | null; roic?: number | null;
  ocf?: number | null; netIncome?: number | null; financingCF?: number | null; debtRatio?: number | null; resaleRatio?: number | null; // forensic(2026-06-19)
  macroRiskLevel?: string | null; vix?: number | null; fgScore?: number | null;
  sectorStance?: string | null; regionStance?: string | null; sector?: string | null; consolidationWeeks?: number | null;
  newsPosRatio?: number | null; newsArticleCount?: number | null;
  // sell 전용(포트폴리오 맥락) — 챗 일반질의엔 보통 없음
  stop?: number | null; target?: number | null; heldDays?: number | null; pnl?: number | null;
  insiderSells?: number | null; insiderBuys?: number | null; insiderSellToBuyRatio?: number | null;
  optionsCallPrem?: number | null; optionsPutPrem?: number | null; contractLoss?: { conviction?: number } | null;
  [k: string]: unknown;
}

export interface RuleHit { id: string; score: number; desc: string; category?: string; urgency?: string; reason: string }
export interface ScoreResult { score: number; hits: RuleHit[] }

export function evaluateBuyRule(rule: Rule, ctx: EngineCtx): string | null;
export function evaluateSellRule(rule: Rule, ctx: EngineCtx): string | null;
export function loadBuyRules(): Rule[];
export function loadSellRules(): Rule[];
export function scoreBuy(ctx: EngineCtx, rules?: Rule[]): ScoreResult;
export function scoreSell(ctx: EngineCtx, rules?: Rule[]): ScoreResult;
export interface Verdict { verdict: string; action: string; lean: string; net: number; coverage?: number; coverageCapped?: boolean; reason?: string }
export function adjudicate(buyScore: number, sellScore: number, opts?: { hardSell?: boolean; coverage?: number }): Verdict;
export function hasHardSell(sellHits: Array<{ id: string }>): boolean;
