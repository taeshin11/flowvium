/**
 * strategy-schema.ts — InvestmentStrategy 출력 검증
 *
 * 로컬 모델(qwen3:8b 등) 약한 출력에서도 결함이 통과하지 않도록 가드.
 * 검증 실패 시 LLM 재호출 (max 1회) 또는 fallback strategy 사용.
 */
import { z } from 'zod';

// 한국 주요 종목 티커→이름 매핑 (route.ts 와 동일)
export const KR_NAMES: Record<string, string> = {
  '005930.KS': '삼성전자',
  '000660.KS': 'SK하이닉스',
  '373220.KS': 'LG에너지솔루션',
  '005380.KS': '현대차',
  '035420.KS': 'NAVER',
  '035720.KS': '카카오',
  '207940.KS': '삼성바이오로직스',
  '051910.KS': 'LG화학',
  '005490.KS': 'POSCO홀딩스',
  '000270.KS': '기아',
};

// 진입가 / 손절가 1차 가격 추출 (route.ts parseFirstPrice 와 동등)
function parseFirstPrice(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = s.replace(/[₩$,\s]/g, '').match(/\d+(\.\d+)?/);
  const n = m ? parseFloat(m[0]) : NaN;
  return Number.isNaN(n) ? null : n;
}

// 한국 종목명 hallucination 검사: 티커가 KR_NAMES 에 있으면 name 일치 강제
function isKoreaTickerNameMismatch(ticker: string, name: string): boolean {
  const expected = KR_NAMES[ticker];
  if (!expected) return false;
  return name !== expected;
}

const PortfolioItemSchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9.^]+$/i, 'invalid ticker chars'),
  name: z.string().min(1),
  sector: z.string().min(1),
  rationale: z.string().min(1),
  allocation: z.number().min(1).max(40),
  entryZone: z.string().min(1),
  entryRationale: z.string().optional(),
  stopLoss: z.string().min(1),
  target: z.string().min(1),
  targetBull: z.string().optional(),
  targetRationale: z.string().optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  action: z.enum(['buy', 'hold', 'watch']).optional(),
  currentPrice: z.number().optional(),
  catalysts: z.array(z.string()).optional(),
  fundamentalBasis: z.string().optional(),
  technicalBasis: z.string().optional(),
  riskNote: z.string().optional(),
  critiqueNote: z.string().optional(),
  market: z.string().optional(),
  mtfNote: z.string().optional(),
}).refine(
  (p: { ticker: string; name: string }) => !isKoreaTickerNameMismatch(p.ticker.toUpperCase(), p.name),
  { message: 'Korean ticker name mismatch (e.g., 000660.KS must be "SK하이닉스")' },
).refine(
  (p: { entryZone: string; stopLoss: string }) => {
    const entry = parseFirstPrice(p.entryZone);
    const stop = parseFirstPrice(p.stopLoss);
    if (entry == null || stop == null) return true;
    if (entry <= 0) return true;
    const gapPct = (entry - stop) / entry;
    return gapPct <= 0.20; // stopLoss 가 entry 대비 -20% 이내
  },
  { message: 'stopLoss too deep (>20% from entry)' },
).refine(
  (p: { target?: string; targetBull?: string }) => {
    if (!p.targetBull || !p.target) return true;
    const t = parseFirstPrice(p.target);
    const tb = parseFirstPrice(p.targetBull);
    if (t == null || tb == null) return true;
    return tb >= t; // bull 시나리오는 base 이상이어야 함
  },
  { message: 'targetBull must be >= target (bull case >= base case)' },
).refine(
  (p: { action?: string; confidence?: string }) => !(p.action === 'buy' && p.confidence === 'low'),
  { message: 'action=buy with confidence=low is contradictory — downgrade to watch' },
);

const SectorAllocationSchema = z.object({
  sector: z.string(),
  pct: z.number(),
  stance: z.enum(['overweight', 'neutral', 'underweight']),
  reason: z.string(),
});

const InsiderSignalSchema = z.object({
  ticker: z.string(),
  filings: z.number().int().nonnegative(), // 배열 [15] 거부 → number 강제
  dateRange: z.string().optional(),
  significance: z.string(),
  pattern: z.string(),
});

const CrisisSignalSchema = z.object({
  type: z.enum(['insider_selling', 'earnings_miss', 'bb_overextended', 'institutional_exit', 'guidance_cut', 'macro_risk']),
  ticker: z.string(),
  signal: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  action: z.string(),
  evidence: z.string(),
});

export const InvestmentStrategySchema = z.object({
  stance: z.enum(['bullish', 'neutral', 'bearish']),
  thesis: z.string().min(5),
  portfolio: z.array(PortfolioItemSchema).min(5),
  sectorAllocation: z.array(SectorAllocationSchema),
  riskEvents: z.array(z.object({
    date: z.string(),
    event: z.string(),
    impact: z.enum(['high', 'medium', 'low']),
    watchFor: z.string(),
  })),
  macroAnalysis: z.string(),
  technicalAnalysis: z.string(),
  fundamentalAnalysis: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  shortSqueeze: z.array(z.object({
    ticker: z.string(),
    score: z.number(),
    timing: z.string(),
    risk: z.string(),
  })).optional(),
  insiderSignals: z.array(InsiderSignalSchema).optional(),
  crisisSignals: z.array(CrisisSignalSchema).optional(),
  generatedAt: z.string(),
  source: z.string(),
}).passthrough() // 그 외 알려진 optional 필드는 그대로 통과
  .refine(
    (s: { sectorAllocation: Array<{ pct: number }> }) => {
      const sum = s.sectorAllocation.reduce((acc: number, x: { pct: number }) => acc + (x.pct ?? 0), 0);
      return s.sectorAllocation.length === 0 || Math.abs(sum - 100) <= 5;
    },
    { message: 'sectorAllocation pct sum must be 100±5' },
  ).refine(
    (s: { portfolio: Array<{ allocation: number }> }) => {
      const sum = s.portfolio.reduce((acc: number, x: { allocation: number }) => acc + (x.allocation ?? 0), 0);
      return Math.abs(sum - 100) <= 5;
    },
    { message: 'portfolio.allocation sum must be 100±5' },
  );

export type ValidatedStrategy = z.infer<typeof InvestmentStrategySchema>;

/**
 * sectorAllocation pct 합산을 100 으로 강제 정규화 (5 초과 차이 시).
 */
export function normalizeSectorAllocation<T extends { sectorAllocation: Array<{ pct: number }> }>(s: T): T {
  if (!s.sectorAllocation?.length) return s;
  const sum = s.sectorAllocation.reduce((a, x) => a + (x.pct ?? 0), 0);
  if (sum <= 0) return s;
  if (Math.abs(sum - 100) <= 2) return s;
  const scale = 100 / sum;
  s.sectorAllocation.forEach(x => { x.pct = Math.round((x.pct ?? 0) * scale); });
  const drift = 100 - s.sectorAllocation.reduce((a, x) => a + x.pct, 0);
  if (drift !== 0 && s.sectorAllocation.length > 0) s.sectorAllocation[0].pct += drift;
  return s;
}

/**
 * rationale " | A | A " 동일 substring 중복 검출 → 한쪽만 유지.
 */
export function dedupRationale(rationale: string): string {
  if (!rationale.includes(' | ')) return rationale;
  const parts = rationale.split(' | ').map(s => s.trim());
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase().replace(/[^\w가-힣]+/g, '').slice(0, 60);
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }
  return unique.join(' | ');
}

/**
 * KR_NAMES 매핑이 있는 티커는 name 강제 교정.
 */
export function fixKoreaTickerNames<T extends { portfolio: Array<{ ticker: string; name: string }> }>(s: T): T {
  for (const p of s.portfolio) {
    const expected = KR_NAMES[p.ticker.toUpperCase()];
    if (expected && p.name !== expected) p.name = expected;
  }
  return s;
}

/**
 * filings 배열 [15] → 15 강제.
 */
export function fixInsiderFilings<T extends { insiderSignals?: Array<{ filings: unknown }> }>(s: T): T {
  if (!s.insiderSignals) return s;
  for (const sig of s.insiderSignals) {
    if (Array.isArray(sig.filings)) {
      sig.filings = (sig.filings as unknown[])[0] ?? 0;
    }
    if (typeof sig.filings === 'string') {
      const n = parseInt(sig.filings, 10);
      sig.filings = Number.isFinite(n) ? n : 0;
    }
  }
  return s;
}

/**
 * 모든 portfolio.rationale 에 dedupRationale 적용.
 */
export function dedupPortfolioRationales<T extends { portfolio: Array<{ rationale: string }> }>(s: T): T {
  for (const p of s.portfolio) {
    if (p.rationale) p.rationale = dedupRationale(p.rationale);
  }
  return s;
}

/**
 * action=buy + confidence=low 모순 시 action='watch' 강등.
 */
export function fixBuyLowConfidence<T extends { portfolio: Array<{ action?: string; confidence?: string }> }>(s: T): T {
  for (const p of s.portfolio) {
    if (p.action === 'buy' && p.confidence === 'low') {
      p.action = 'watch';
    }
  }
  return s;
}

/**
 * 후처리 파이프라인 — schema 검증 전 자동 교정 가능한 항목 처리.
 */
export function preValidateFix<T extends {
  portfolio: Array<{ ticker: string; name: string; rationale: string; action?: string; confidence?: string }>;
  sectorAllocation: Array<{ pct: number }>;
  insiderSignals?: Array<{ filings: unknown }>;
}>(s: T): T {
  fixKoreaTickerNames(s);
  fixInsiderFilings(s);
  dedupPortfolioRationales(s);
  normalizeSectorAllocation(s);
  fixBuyLowConfidence(s);
  return s;
}

/**
 * Zod 검증 결과를 사람이 읽을 수 있는 에러 목록으로.
 */
export function validateStrategy(strategy: unknown): { ok: true; data: ValidatedStrategy } | { ok: false; errors: string[] } {
  const r = InvestmentStrategySchema.safeParse(strategy);
  if (r.success) return { ok: true, data: r.data };
  const errors = r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
  return { ok: false, errors };
}
