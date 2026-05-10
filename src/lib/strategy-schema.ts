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
).refine(
  // stopLoss 가 entry 보다 비싸면 비합리 (NVDA $500 손절 같은 케이스)
  (p: { entryZone: string; stopLoss: string }) => {
    const entry = parseFirstPrice(p.entryZone);
    const stop = parseFirstPrice(p.stopLoss);
    if (entry == null || stop == null || entry <= 0) return true;
    return stop < entry * 1.05; // 5% 이내 마진 허용 (range upper 이하)
  },
  { message: 'stopLoss must be lower than entry (stop > entry is irrational)' },
).refine(
  // rationale 의 50MA 값과 진입가 비교 — 50% 이상 차이면 hallucination 가능성
  (p: { ticker: string; entryZone: string; rationale: string }) => {
    const ma50Match = p.rationale.match(/50MA[^$₩\d]*[$₩]?([\d,]+\.?\d*)/);
    if (!ma50Match) return true;
    const ma50 = parseFloat(ma50Match[1].replace(/,/g, ''));
    const entry = parseFirstPrice(p.entryZone);
    if (!ma50 || !entry || ma50 <= 0) return true;
    const ratio = entry / ma50;
    return ratio > 0.5 && ratio < 2.0; // entry 가 50MA 의 0.5x ~ 2x 범위
  },
  { message: 'entry too far from rationale 50MA — likely price hallucination' },
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
 * Harness 가 적용한 자동 교정 항목 추적용 audit 결과.
 * /admin/logs 또는 reports/*.json 에 보존되어 결함 패턴 통계 가능.
 */
export interface HarnessAudit {
  /** 9 카테고리 카운트 — schema_validation_failed 와 별개 */
  fixes: {
    krNameMismatch: string[];        // ['000660.KS:삼성전자→SK하이닉스']
    rationaleDedup: string[];        // ['MSFT:|A|A removed']
    insiderFilingsType: string[];    // ['CRWV: array→15']
    sectorAllocSum: { from: number; to: number } | null;
    portfolioAllocSum: { from: number; to: number } | null;
    buyLowConfidence: string[];      // ['NVDA:buy→watch (low confidence)']
    stopLossDeep: string[];          // ['NVDA:stopLoss 45% deep']
    targetBullInverted: string[];    // ['NVDA:targetBull < target']
    stopLossAboveEntry: string[];    // ['NVDA:stop=$500 > entry=$206']
    entryFar50MA: string[];          // ['ASML:entry=$350 vs 50MA=$1402']
    companyChangeName: string[];     // ['000660.KS:"Samsung"→"SK하이닉스"']
    unrealistic52WRange: string[];   // ['000660.KS:52주 8.9x — split/data error 의심']
    stopRationaleMismatch: string[]; // ['MU:portfolio=$687 vs rationale=$201']
  };
  /** Zod schema 검증 결과 — preValidateFix 후에도 통과 못 한 issue */
  schemaErrors: string[];
  /** harness 자체가 동작했음을 보증 */
  appliedAt: string;
  /** 0 = 깨끗, N>0 = N 결함 자동 교정됨 */
  totalFixes: number;
}

export function emptyAudit(): HarnessAudit {
  return {
    fixes: {
      krNameMismatch: [],
      rationaleDedup: [],
      insiderFilingsType: [],
      sectorAllocSum: null,
      portfolioAllocSum: null,
      buyLowConfidence: [],
      stopLossDeep: [],
      targetBullInverted: [],
      stopLossAboveEntry: [],
      entryFar50MA: [],
      companyChangeName: [],
      unrealistic52WRange: [],
      stopRationaleMismatch: [],
    },
    schemaErrors: [],
    appliedAt: new Date().toISOString(),
    totalFixes: 0,
  };
}

function countAudit(a: HarnessAudit): number {
  const f = a.fixes;
  return (
    f.krNameMismatch.length +
    f.rationaleDedup.length +
    f.insiderFilingsType.length +
    (f.sectorAllocSum ? 1 : 0) +
    (f.portfolioAllocSum ? 1 : 0) +
    f.buyLowConfidence.length +
    f.stopLossDeep.length +
    f.targetBullInverted.length +
    f.stopLossAboveEntry.length +
    f.entryFar50MA.length +
    f.companyChangeName.length +
    f.unrealistic52WRange.length +
    f.stopRationaleMismatch.length
  );
}

/**
 * 52주 범위가 10x 이상이면 split / 통화 / 데이터 오류 의심 → action=watch 강등.
 * 임계치 5x → 10x: SK하이닉스 5/9-5/10 케이스 (실제 1년 8.7x 상승, AI 슈퍼사이클)
 * 가 false positive 였음. 진짜 split 미반영은 보통 100x+ 또는 통화 단위 오류.
 */
export function detect52WUnrealistic<T extends {
  portfolio: Array<{ ticker: string; rationale?: string; action?: string; critiqueNote?: string }>;
}>(s: T, audit?: HarnessAudit): T {
  for (const p of s.portfolio) {
    const m52 = p.rationale?.match(/52주[^$₩\d]*[$₩]?([\d,.]+)\s*-\s*[$₩]?([\d,.]+)/);
    if (!m52) continue;
    const lo = parseFloat(m52[1].replace(/,/g, ''));
    const hi = parseFloat(m52[2].replace(/,/g, ''));
    if (lo <= 0 || !isFinite(hi)) continue;
    const ratio = hi / lo;
    if (ratio < 10) continue;
    if (audit) audit.fixes.unrealistic52WRange.push(`${p.ticker}:${m52[1]}-${m52[2]} (${ratio.toFixed(1)}x)`);
    p.action = 'watch';
    p.critiqueNote = (p.critiqueNote ? p.critiqueNote + ' | ' : '') +
      `52주 범위 비현실(${ratio.toFixed(1)}x) — split/통화/데이터 오류 의심, 진입 보류`;
  }
  return s;
}

/**
 * stopLossRationale 의 가격이 portfolio.stopLoss 와 차이 — 경고만 기록 (자동 교정 X).
 *
 * 이전 자동 교정 시도 false positive: rationale 에는 200MA, 52주 저점 등
 * stopLoss 가 아닌 참고가격이 자주 등장. SK하이닉스: portfolio=₩1.55M, rationale=₩649K(200MA).
 * 후처리 enrichStopLoss 가 entry × 0.93 으로 portfolio.stopLoss 를 잘 만드므로,
 * portfolio.stopLoss 를 신뢰하고 mismatch 만 audit 에 기록.
 */
export function detectStopRationaleMismatch<T extends {
  portfolio: Array<{ ticker: string; stopLoss: string }>;
  stopLossRationale?: Array<{ ticker: string; rationale: string }>;
}>(s: T, audit?: HarnessAudit): T {
  if (!audit || !s.stopLossRationale) return s;
  for (const sr of s.stopLossRationale) {
    const p = s.portfolio.find(x => x.ticker === sr.ticker);
    if (!p) continue;
    const stopP = parseFirstPrice(p.stopLoss);
    if (!stopP) continue;
    const matches = sr.rationale?.match(/[$₩][\d,.]+/g) || [];
    const vals = matches.map(m => parseFloat(m.replace(/[$₩,]/g, ''))).filter(v => v > 0);
    const inconsistent = vals.find(v => v < stopP * 0.5 || v > stopP * 2);
    if (!inconsistent) continue;
    audit.fixes.stopRationaleMismatch.push(`${sr.ticker}:portfolio=${stopP} vs rationale=${inconsistent} (검증 필요)`);
  }
  return s;
}

/**
 * sectorAllocation pct 합산을 100 으로 강제 정규화 (5 초과 차이 시).
 */
export function normalizeSectorAllocation<T extends { sectorAllocation: Array<{ pct: number }> }>(s: T, audit?: HarnessAudit): T {
  if (!s.sectorAllocation?.length) return s;
  const sum = s.sectorAllocation.reduce((a, x) => a + (x.pct ?? 0), 0);
  if (sum <= 0) return s;
  if (Math.abs(sum - 100) <= 2) return s;
  const scale = 100 / sum;
  s.sectorAllocation.forEach(x => { x.pct = Math.round((x.pct ?? 0) * scale); });
  const drift = 100 - s.sectorAllocation.reduce((a, x) => a + x.pct, 0);
  if (drift !== 0 && s.sectorAllocation.length > 0) s.sectorAllocation[0].pct += drift;
  if (audit) audit.fixes.sectorAllocSum = { from: sum, to: 100 };
  return s;
}

/**
 * portfolio allocation 합산 정규화 — schema 가 100±5 요구하므로 사전 교정.
 */
export function normalizePortfolioAllocation<T extends { portfolio: Array<{ allocation: number }> }>(s: T, audit?: HarnessAudit): T {
  if (!s.portfolio?.length) return s;
  const sum = s.portfolio.reduce((a, x) => a + (x.allocation ?? 0), 0);
  if (sum <= 0) return s;
  if (Math.abs(sum - 100) <= 2) return s;
  const scale = 100 / sum;
  s.portfolio.forEach(x => { x.allocation = Math.round((x.allocation ?? 0) * scale); });
  const drift = 100 - s.portfolio.reduce((a, x) => a + x.allocation, 0);
  if (drift !== 0 && s.portfolio.length > 0) s.portfolio[0].allocation += drift;
  if (audit) audit.fixes.portfolioAllocSum = { from: sum, to: 100 };
  return s;
}

/**
 * rationale " | A | A " 동일 substring 중복 검출 → 한쪽만 유지.
 */
export function dedupRationale(rationale: string): { result: string; dedupped: boolean } {
  if (!rationale.includes(' | ')) return { result: rationale, dedupped: false };
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
  const result = unique.join(' | ');
  return { result, dedupped: result !== rationale };
}

/**
 * KR_NAMES 매핑이 있는 티커는 name 강제 교정.
 */
export function fixKoreaTickerNames<T extends { portfolio: Array<{ ticker: string; name: string }> }>(s: T, audit?: HarnessAudit): T {
  for (const p of s.portfolio) {
    const expected = KR_NAMES[p.ticker.toUpperCase()];
    if (expected && p.name !== expected) {
      if (audit) audit.fixes.krNameMismatch.push(`${p.ticker}:"${p.name}"→"${expected}"`);
      p.name = expected;
    }
  }
  return s;
}

/**
 * filings 배열 [15] → 15 강제.
 */
export function fixInsiderFilings<T extends { insiderSignals?: Array<{ ticker?: string; filings: unknown }> }>(s: T, audit?: HarnessAudit): T {
  if (!s.insiderSignals) return s;
  for (const sig of s.insiderSignals) {
    if (Array.isArray(sig.filings)) {
      const before = JSON.stringify(sig.filings);
      sig.filings = (sig.filings as unknown[])[0] ?? 0;
      if (audit) audit.fixes.insiderFilingsType.push(`${sig.ticker ?? '?'}:array${before}→${sig.filings}`);
    }
    if (typeof sig.filings === 'string') {
      const before = sig.filings;
      const n = parseInt(sig.filings, 10);
      sig.filings = Number.isFinite(n) ? n : 0;
      if (audit) audit.fixes.insiderFilingsType.push(`${sig.ticker ?? '?'}:string"${before}"→${sig.filings}`);
    }
  }
  return s;
}

/**
 * action=buy + confidence=low 모순 시 action='watch' 강등.
 */
export function fixBuyLowConfidence<T extends { portfolio: Array<{ ticker: string; action?: string; confidence?: string }> }>(s: T, audit?: HarnessAudit): T {
  for (const p of s.portfolio) {
    if (p.action === 'buy' && p.confidence === 'low') {
      if (audit) audit.fixes.buyLowConfidence.push(`${p.ticker}:buy+low→watch`);
      p.action = 'watch';
    }
  }
  return s;
}

/**
 * portfolio.rationale dedup 일괄 적용.
 */
export function dedupPortfolioRationales<T extends { portfolio: Array<{ ticker: string; rationale: string }> }>(s: T, audit?: HarnessAudit): T {
  for (const p of s.portfolio) {
    if (!p.rationale) continue;
    const { result, dedupped } = dedupRationale(p.rationale);
    if (dedupped) {
      if (audit) audit.fixes.rationaleDedup.push(`${p.ticker}`);
      p.rationale = result;
    }
  }
  return s;
}

/**
 * companyChanges.name 도 KR_NAMES 매핑 강제 (portfolio 외 경로 결함).
 */
export function fixCompanyChangeNames<T extends { companyChanges?: Array<{ ticker: string; name: string }> }>(s: T, audit?: HarnessAudit): T {
  if (!s.companyChanges) return s;
  for (const c of s.companyChanges) {
    const expected = KR_NAMES[c.ticker?.toUpperCase()];
    if (expected && c.name !== expected) {
      if (audit) audit.fixes.companyChangeName.push(`${c.ticker}:"${c.name}"→"${expected}"`);
      c.name = expected;
    }
  }
  return s;
}

/**
 * stopLoss 가 entry 보다 비싸면 검출 (자동 교정은 안 함 — 경고만).
 * NVDA stopLoss=$500 + entryZone=$200 같은 비합리 케이스.
 */
export function detectStopAboveEntry<T extends { portfolio: Array<{ ticker: string; entryZone: string; stopLoss: string }> }>(s: T, audit?: HarnessAudit): T {
  if (!audit) return s;
  for (const p of s.portfolio) {
    const entry = parseFirstPrice(p.entryZone);
    const stop = parseFirstPrice(p.stopLoss);
    if (entry == null || stop == null || entry <= 0) continue;
    if (stop >= entry * 1.05) {
      audit.fixes.stopLossAboveEntry.push(`${p.ticker}:stop=${stop} >= entry=${entry}`);
    }
  }
  return s;
}

/**
 * rationale 의 50MA 값과 진입가 비교 — 50% 이상 차이면 가격 hallucination.
 * 자동 교정: entry/stop/target 을 50MA 기반으로 재계산 + action='watch' 강등.
 * ASML 50MA $1402 + entry $350 같은 케이스.
 */
export function fixEntryFar50MA<T extends {
  portfolio: Array<{
    ticker: string; entryZone: string; rationale: string;
    stopLoss: string; target: string; targetBull?: string;
    action?: string; critiqueNote?: string;
  }>;
}>(s: T, audit?: HarnessAudit): T {
  for (const p of s.portfolio) {
    const ma50Match = p.rationale?.match(/50MA[^$₩\d]*([$₩])?([\d,]+\.?\d*)/);
    if (!ma50Match) continue;
    const currencySym = ma50Match[1] ?? '$';
    const ma50 = parseFloat(ma50Match[2].replace(/,/g, ''));
    const entry = parseFirstPrice(p.entryZone);
    if (!ma50 || !entry || ma50 <= 0) continue;
    const ratio = entry / ma50;
    if (ratio > 0.5 && ratio < 2.0) continue;

    // 가격 hallucination 자동 교정 — 50MA 기반 재계산
    const fmt = currencySym === '₩'
      ? (n: number) => `₩${Math.round(n / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      : (n: number) => `$${n.toFixed(2)}`;

    const newEntryLow = ma50 * 0.97;
    const newEntryHigh = ma50 * 1.00;
    const newStop = ma50 * 0.92;
    const newTarget = ma50 * 1.15;
    const newBull = ma50 * 1.30;

    if (audit) audit.fixes.entryFar50MA.push(
      `${p.ticker}:entry=${entry}→${fmt(newEntryLow)}-${fmt(newEntryHigh)} (was ${ratio.toFixed(2)}x of 50MA=${ma50})`,
    );

    p.entryZone = `${fmt(newEntryLow)}-${fmt(newEntryHigh)}`;
    p.stopLoss = fmt(newStop);
    p.target = fmt(newTarget);
    p.targetBull = fmt(newBull);
    p.action = 'watch';
    p.critiqueNote = (p.critiqueNote ? p.critiqueNote + ' | ' : '') +
      `가격 hallucination 의심 — 50MA(${fmt(ma50)}) 기반 재계산, 진입 전 재검토 필요`;
  }
  return s;
}

/**
 * 후처리 파이프라인 — schema 검증 전 자동 교정 가능한 항목 처리.
 * audit 결과는 logger / Redis / report 메타필드에 기록 가능.
 */
export function preValidateFix<T extends {
  portfolio: Array<{
    ticker: string; name: string; rationale: string;
    action?: string; confidence?: string; allocation: number;
    entryZone: string; stopLoss: string;
    target: string; targetBull?: string; critiqueNote?: string;
  }>;
  sectorAllocation: Array<{ pct: number }>;
  insiderSignals?: Array<{ ticker?: string; filings: unknown }>;
  companyChanges?: Array<{ ticker: string; name: string }>;
  stopLossRationale?: Array<{ ticker: string; rationale: string }>;
}>(s: T, audit: HarnessAudit = emptyAudit()): { strategy: T; audit: HarnessAudit } {
  fixKoreaTickerNames(s, audit);
  fixCompanyChangeNames(s, audit);
  fixInsiderFilings(s, audit);
  dedupPortfolioRationales(s, audit);
  normalizeSectorAllocation(s, audit);
  normalizePortfolioAllocation(s, audit);
  fixBuyLowConfidence(s, audit);
  detectStopAboveEntry(s, audit);
  fixEntryFar50MA(s, audit);
  detect52WUnrealistic(s, audit);
  detectStopRationaleMismatch(s, audit);
  audit.totalFixes = countAudit(audit);
  return { strategy: s, audit };
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
