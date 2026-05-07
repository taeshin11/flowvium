import { logger, loggedRedisSet, loggedRedisLpushTrim } from '@/lib/logger';
import { memSetReport, memSetArray, memGetArray } from '@/lib/investment-strategy-memory';
import { isGarbage as isGarbageText, isKnownSource, GARBAGE_MIN_LEN } from '@/lib/strategy-quality';
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createRedis, gatherTabContext } from '@/lib/daily-brief';
import { callAI as callAIProvider } from '@/lib/ai-providers';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';
import {
  buildMacroPrompt, buildPortfolioPrompt, buildRegionalPrompt,
  buildOpportunityPrompt, buildRiskMgmtPrompt, buildNarrativePrompt,
  buildCritiquePrompt, applyCritique, buildCompanyChangesPrompt,
  buildStockDetailPrompt,
} from '@/lib/investment-prompts';
import type { CtxForPrompts, CritiqueInput, RiskMgmtInput, CompanyChangesInput, StockDetailInput } from '@/lib/investment-prompts';
import { logPortfolioPredictions, getRetrospectiveForS2, getRetrospectiveForS7 } from '@/lib/portfolio-retrospective';
import { executeReportTrades } from '@/lib/paper-trading';
import { FG, VIX, SPREADS, PORTFOLIO } from '@/lib/thresholds';
export const dynamic = 'force-dynamic';

const ERROR_LOG_KEY = 'flowvium:error-log:recent';
const ERROR_LOG_MAX = 200;

async function appendErrorLog(
  redis: Redis | null,
  type: string,
  details: Record<string, unknown>,
  locale: string,
  session: string,
): Promise<void> {
  if (!redis) return;
  const entry = JSON.stringify({ ts: new Date().toISOString(), locale, session, type, ...details });
  try {
    await redis.lpush(ERROR_LOG_KEY, entry);
    await redis.ltrim(ERROR_LOG_KEY, 0, ERROR_LOG_MAX - 1);
    await redis.expire(ERROR_LOG_KEY, 7 * 86400); // 7일
  } catch { /* non-fatal */ }
}


export const maxDuration = 300;

const CACHE_TTL = 24 * 60 * 60; // 24h Redis
// Bump this version whenever the report schema adds/removes required fields.
// Old stale caches with different schema are automatically invalidated on the next cron run.
const SCHEMA_VERSION = 8;
const staleKey = (locale = 'en') => `flowvium:investment-strategy:stale:v${SCHEMA_VERSION}:${locale}`;
// 24h CDN + 2h stale window; daily strategy doesn't need more frequent refresh
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=7200' };
const PRIORITY_LOCALES = new Set(['ko', 'en', 'ja', 'zh-CN', 'zh-TW']);

// Module-level memory cache — without Redis every cold start triggers a heavy AI call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let STRATEGY_MEMORY_CACHE: { data: any; expiresAt: number } | null = null;
const STRATEGY_MEMORY_TTL_MS = 23 * 60 * 60 * 1000; // 23h — survive most of the day within one Lambda instance

/** KST 세션 구분:
 *  morning   = 07:00–15:59 KST (미국장 마감 후 분석)
 *  afternoon = 16:00–21:59 KST (아시아장 마감, 유럽장 진행)
 *  evening   = 22:00–06:59 KST (미국장 개장 전후 분석)
 */
// Required fields for the current 7-section schema (v8+).
// ALL fields must be present (every, not some) — partial match lets old reports through.
const REQUIRED_SCHEMA_FIELDS: (keyof InvestmentStrategy)[] = ['marketNarrative', 'regionStances', 'shortSqueeze'];

function isSchemaCompatible(report: unknown): report is Record<string, unknown> {
  if (report == null || typeof report !== 'object' || Array.isArray(report)) return false;
  const r = report as Record<string, unknown>;
  // schemaVersion exact match is the primary guard; field presence is the fallback
  if (r.schemaVersion != null && r.schemaVersion !== SCHEMA_VERSION) return false;
  return REQUIRED_SCHEMA_FIELDS.every(f => {
    const v = r[f];
    if (Array.isArray(v)) return v.length > 0;
    if (v != null && typeof v === 'object') return Object.keys(v).length > 0;
    return v != null;
  });
}

// Wrap strategy before caching — injects schemaVersion + buildId for traceability.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? 'local';
function toCacheable(strategy: InvestmentStrategy): InvestmentStrategy & { schemaVersion: number; buildId: string } {
  return { ...strategy, schemaVersion: SCHEMA_VERSION, buildId: BUILD_ID };
}

function getKstSession(): 'morning' | 'afternoon' | 'evening' {
  const kstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (kstHour >= 7 && kstHour < 16) return 'morning';
  if (kstHour >= 16 && kstHour < 22) return 'afternoon';
  return 'evening';
}

function cacheKey(session?: string, locale = 'en'): string {
  const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const s = session ?? getKstSession();
  return `flowvium:investment-strategy:v${SCHEMA_VERSION}:${kstDate}:${s}:${locale}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PortfolioItem {
  ticker: string;
  name: string;
  sector: string;
  rationale: string;
  allocation: number;
  entryZone: string;
  entryRationale?: string;     // why this entry range (fundamental + technical)
  stopLoss: string;
  target: string;              // base case target
  targetBull?: string;         // bull case: breakout continuation target
  targetRationale?: string;    // fundamental-first, then technical
  confidence: 'high' | 'medium' | 'low';
  action?: 'buy' | 'hold' | 'watch';
  currentPrice?: number;
  // Detailed analysis — required for action: 'buy'
  catalysts?: string[];          // 2-3 specific catalysts with numbers
  fundamentalBasis?: string;     // EPS/PE/margin + institutional signal (≤120 chars)
  technicalBasis?: string;       // MA position, RSI, volume trend (≤80 chars)
  riskNote?: string;             // main downside risk to thesis (≤60 chars)
  critiqueNote?: string;         // post-hoc critique annotation (display only)
}

export interface SectorWeight {
  sector: string;
  pct: number;
  stance: 'overweight' | 'neutral' | 'underweight';
  reason: string;
}

export interface RiskEvent {
  date: string;
  event: string;
  impact: 'high' | 'medium' | 'low';
  watchFor: string;
}

export interface RegionStance {
  stance: 'bullish' | 'neutral' | 'bearish';
  thesis: string;
  /** e.g. "SPY -1.8% 1w, F&G 64, VIX 18" */
  keyData: string;
}

export interface InvestmentStrategy {
  stance: 'bullish' | 'neutral' | 'bearish';
  thesis: string;
  regionStances?: Record<string, RegionStance>;
  portfolio: PortfolioItem[];
  sectorAllocation: SectorWeight[];
  riskEvents: RiskEvent[];
  macroAnalysis: string;
  technicalAnalysis: string;
  fundamentalAnalysis: string;
  riskLevel: 'low' | 'medium' | 'high';
  // S4: 기회 신호
  shortSqueeze?: Array<{ ticker: string; score: number; timing: string; risk: string }>;
  insiderSignals?: Array<{ ticker: string; filings: number; dateRange?: string; significance: string; pattern: string }>;
  topOpportunity?: string;
  // S5: 리스크 관리
  stopLossRationale?: Array<{ ticker: string; rationale: string }>;
  hedgingSuggestion?: string;
  portfolioRiskNote?: string;
  // S6: 시장 내러티브
  marketNarrative?: { why: string; watch: string; story: string; hotThemes?: string[]; sessionNote: string };
  // S8: 기업 변화 모니터링
  companyChanges?: Array<{
    ticker: string;
    name: string;
    revenueYoY?: number;      // 최근 분기 YoY 성장률 %
    latestQuarter?: string;   // "Q4 FY2026"
    keyChange: string;        // AI 분석: 주요 변화 (≤80자)
    guidance?: string;        // raised/maintained/lowered/unknown
    sentiment: 'positive' | 'neutral' | 'negative';
  }>;
  generatedAt: string;
  dataAsOf?: string;
  source: string;
  cached?: boolean;
}

// ── Live price fetcher ────────────────────────────────────────────────────────
interface LivePrice {
  price: number;
  change1d: number | null;
  high52w: number;
  low52w: number;
}

async function fetchOnePrice(ticker: string): Promise<[string, LivePrice | null]> {
  // Try Yahoo v8 first
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
      {
        headers: YAHOO_HEADERS,
        // KS(Korean) tickers need longer timeout from US-hosted Vercel servers
        signal: AbortSignal.timeout(ticker.endsWith('.KS') ? 8000 : 4000),
        cache: 'no-store',
      }
    );
    if (res.ok) {
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (meta) {
        const price = meta.regularMarketPrice as number;
        const prev = meta.previousClose as number;
        const change1d = prev ? ((price - prev) / prev) * 100 : null;
        return [ticker, {
          price: Math.round(price * 100) / 100,
          change1d: change1d != null ? Math.round(change1d * 10) / 10 : null,
          high52w: meta.fiftyTwoWeekHigh ?? price * 1.3,
          low52w: meta.fiftyTwoWeekLow ?? price * 0.7,
        }];
      }
    }
  } catch { /* fall through to Finnhub */ }
  // Finnhub fallback — works from Vercel IPs where Yahoo is blocked
  const fhKey = process.env.FINNHUB_KEY?.trim();
  if (fhKey) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(fhKey)}`,
        { signal: AbortSignal.timeout(4000), cache: 'no-store' }
      );
      if (res.ok) {
        const d = await res.json() as { c?: number; d?: number; dp?: number; h?: number; l?: number; pc?: number };
        if (d.c && d.c > 0) {
          return [ticker, {
            price: Math.round(d.c * 100) / 100,
            change1d: d.dp != null ? Math.round(d.dp * 10) / 10 : null,
            high52w: d.h ? d.h * 1.1 : d.c * 1.3,
            low52w: d.l ? d.l * 0.9 : d.c * 0.7,
          }];
        }
      }
    } catch { /* non-fatal */ }
  }
  return [ticker, null];
}

const CANDIDATE_TICKERS = [
  // US 대형주
  'NVDA', 'MSFT', 'AAPL', 'META', 'GOOGL', 'AMZN', 'TSLA',
  'KLAC', 'AMD', 'JPM', 'V', 'UNH', 'XOM', 'GS', 'BAC',
  // US ETF
  'SPY', 'QQQ', 'GLD', 'TLT', 'USO', 'IWM', 'XLE', 'XLK', 'XLF', 'XLV',
  // 국가 ETF
  'EWY', 'EWJ', 'FXI', 'VGK', 'INDA', 'EWT', 'EWZ', 'EWA',
  // 기타 자산
  'BITO', 'SLV', 'DBA',
  // 🇰🇷 한국 주요 개별 종목 (KRW 가격, Yahoo .KS 형식)
  '005930.KS', // 삼성전자
  '000660.KS', // SK하이닉스
  '373220.KS', // LG에너지솔루션
  '005380.KS', // 현대차
  '035420.KS', // NAVER
  '035720.KS', // 카카오
  '207940.KS', // 삼성바이오로직스
  '051910.KS', // LG화학
  '005490.KS', // POSCO홀딩스
  '000270.KS', // 기아
];

async function getLivePrices(): Promise<Map<string, LivePrice>> {
  const map = new Map<string, LivePrice>();

  // 1. Yahoo v7 batch (US/global tickers — KS tickers often missing)
  try {
    const fields = 'regularMarketPrice,regularMarketChangePercent,fiftyTwoWeekHigh,fiftyTwoWeekLow';
    const res = await fetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(CANDIDATE_TICKERS.join(','))}&fields=${fields}`,
      { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000), cache: 'no-store' }
    );
    if (res.ok) {
      const data = await res.json();
      const quotes = (data?.quoteResponse?.result ?? []) as Array<Record<string, unknown>>;
      for (const q of quotes) {
        const price = q.regularMarketPrice as number | undefined;
        if (price == null) continue;
        const changePct = q.regularMarketChangePercent as number | undefined;
        map.set(q.symbol as string, {
          price: Math.round(price * 100) / 100,
          change1d: changePct != null ? Math.round(changePct * 10) / 10 : null,
          high52w: (q.fiftyTwoWeekHigh as number | undefined) ?? price * 1.3,
          low52w: (q.fiftyTwoWeekLow as number | undefined) ?? price * 0.7,
        });
      }
    }
  } catch { /* fall through */ }

  // 2. v8 개별 조회 — 배치에서 누락된 티커 (KS 등) + 배치 자체 실패 시
  const missing = CANDIDATE_TICKERS.filter(t => !map.has(t));
  if (missing.length > 0) {
    const results = await Promise.all(missing.map(fetchOnePrice));
    for (const [ticker, lp] of results) {
      if (lp) map.set(ticker, lp);
    }
  }

  return map;
}

const KR_NAMES: Record<string, string> = {
  '005930.KS': '삼성전자', '000660.KS': 'SK하이닉스', '373220.KS': 'LG에너지솔루션',
  '005380.KS': '현대차', '035420.KS': 'NAVER', '035720.KS': '카카오',
  '207940.KS': '삼성바이오로직스', '051910.KS': 'LG화학', '005490.KS': 'POSCO홀딩스', '000270.KS': '기아',
};

function pricesSection(prices: Map<string, LivePrice>): string {
  if (prices.size === 0) return '';
  const lines = Array.from(prices.entries()).map(([t, p]) => {
    const isKR = t.endsWith('.KS');
    const curr = isKR ? '₩' : '$';
    const name = KR_NAMES[t] ? ` (${KR_NAMES[t]})` : '';
    const priceStr = isKR ? Math.round(p.price).toLocaleString() : p.price.toFixed(2);
    return `${t}${name}: ${curr}${priceStr} (1d ${p.change1d != null ? `${p.change1d > 0 ? '+' : ''}${p.change1d}%` : 'N/A'})`;
  });
  return lines.join('\n');
}

// ── Sector PE summary helper ──────────────────────────────────────────────────
async function getSectorSummary(baseUrl: string): Promise<string> {
  try {
    const res = await fetch(`${baseUrl}/api/sector-pe`, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return '';
    const data = await res.json() as { sectors?: Array<{ ticker: string; name: string; trailingPE: number | null; ytdReturn: number | null; changePct: number | null }> };
    const entries = data.sectors ?? [];
    return entries.slice(0, 8).map(e => {
      const ytd = e.ytdReturn != null ? (e.ytdReturn * 100).toFixed(1) : 'N/A';
      return `${e.ticker}(${e.name}) P/E=${e.trailingPE?.toFixed(1) ?? 'N/A'} YTD=${ytd}% 1d=${e.changePct?.toFixed(2) ?? 'N/A'}%`;
    }).join(', ');
  } catch { return ''; }
}

// ── Company financials helper (S8 기업변화 섹션용) ────────────────────────────
async function getCompanyFinancialsSummary(baseUrl: string, tickers: string[]): Promise<string> {
  if (!tickers.length) return '';
  const results = await Promise.allSettled(
    tickers.slice(0, 8).map(async ticker => {
      try {
        const res = await fetch(`${baseUrl}/api/company-financials/${ticker}`, {
          signal: AbortSignal.timeout(5000), cache: 'no-store',
        });
        if (!res.ok) return null;
        const d = await res.json() as {
          ticker: string; quarterlyRevenue?: Array<{ label: string; revenueUSD: number; yoyPct: number | null }>;
          latestAnnual?: { operatingMarginPct?: number | null; roePct?: number | null };
        };
        const q = d.quarterlyRevenue?.[0];
        if (!q) return null;
        const rev = q.revenueUSD >= 1e9 ? `$${(q.revenueUSD/1e9).toFixed(1)}B` : `$${(q.revenueUSD/1e6).toFixed(0)}M`;
        const yoy = q.yoyPct != null ? `${q.yoyPct > 0 ? '+' : ''}${q.yoyPct.toFixed(1)}% YoY` : '';
        const margin = d.latestAnnual?.operatingMarginPct != null ? ` opMgn=${d.latestAnnual.operatingMarginPct.toFixed(1)}%` : '';
        return `${ticker}: ${q.label} ${rev} ${yoy}${margin}`;
      } catch { return null; }
    })
  );
  return results.filter(r => r.status === 'fulfilled' && r.value).map(r => (r as PromiseFulfilledResult<string>).value).join(' | ');
}

// ── Active cascade detector ───────────────────────────────────────────────────
// cascade 리더가 1주간 ±5% 이상 움직이면 "현재 활성" 신호로 판단, AI 프롬프트에 주입
async function getActiveCascadeSignals(baseUrl: string): Promise<string> {
  try {
    // cascade leaders + 주요 followers
    const LEADERS = ['NVDA','ASML','MSFT','TSM','LMT','ABBV','TSLA','WMT'];
    const res = await fetch(
      `${baseUrl}/api/batch-prices?tickers=${LEADERS.join(',')}`,
      { signal: AbortSignal.timeout(8000), cache: 'no-store' }
    );
    if (!res.ok) return '';
    const d = await res.json() as { prices?: Record<string, { price: number|null; changePct: number|null; ret1w?: number|null }> };
    const prices = d.prices ?? {};

    // cascade 패턴 임포트 (빌드 타임 static import OK — 패턴 자체는 분석 기준)
    const CASCADES: Array<{ leader: string; followers: string[]; sector: string }> = [
      { leader: 'NVDA', followers: ['MU','000660.KS','TSM','AMAT','LRCX','AMD'], sector: 'AI반도체' },
      { leader: 'ASML', followers: ['AMAT','LRCX','KLAC','TSM'], sector: '반도체장비' },
      { leader: 'MSFT', followers: ['NVDA','GOOGL','AMZN','ORCL'], sector: 'AI클라우드' },
      { leader: 'TSM', followers: ['NVDA','AMD','AVGO','QCOM'], sector: 'TSMC파운드리' },
      { leader: 'LMT', followers: ['RTX','NOC','BA','GE'], sector: '방산' },
      { leader: 'ABBV', followers: ['LLY','JNJ','PFE','MRK'], sector: '바이오파마' },
      { leader: 'TSLA', followers: ['RIVN','NIO','LI','LCID'], sector: 'EV' },
      { leader: 'WMT', followers: ['COST','HD','TGT','AMZN'], sector: '소비유통' },
    ];

    const active: string[] = [];
    for (const c of CASCADES) {
      const lp = prices[c.leader];
      const ret1w = lp?.ret1w ?? null;
      if (ret1w == null || Math.abs(ret1w) < 5) continue;
      const dir = ret1w > 0 ? '상승' : '하락';
      const sign = ret1w > 0 ? '+' : '';
      active.push(
        `[CASCADE ACTIVE] ${c.sector} ${c.leader} 1W ${sign}${ret1w.toFixed(1)}% → ` +
        `팔로워 주목: ${c.followers.slice(0,3).join(', ')} (공급망/경쟁 cascade 진행 가능)`
      );
    }

    return active.length ? active.join('\n') : '';
  } catch { return ''; }
}

// ── Earnings risk helper ──────────────────────────────────────────────────────
async function getUpcomingEarnings(baseUrl: string): Promise<string> {
  try {
    const res = await fetch(`${baseUrl}/api/earnings`, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return '';
    const data = await res.json() as { earnings?: Array<{ symbol: string; date: string; epsEstimate?: number | null }> };
    const items = (data.earnings ?? []).slice(0, 5);
    return items.map(e => `${e.symbol} ${e.date}`).join(', ');
  } catch { return ''; }
}

// ── VIX / volatility regime helper ───────────────────────────────────────────
async function getVixContext(baseUrl: string): Promise<string> {
  try {
    const res = await fetch(`${baseUrl}/api/volatility`, {
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!res.ok) return '';
    const data = await res.json() as { vix?: number | null; regime?: string | null; regimeLabel?: string | null };
    if (data.vix == null) return '';
    const parts = [`VIX=${data.vix.toFixed(2)}`];
    if (data.regime) parts.push(`regime=${data.regime}`);
    if (data.regimeLabel) parts.push(`(${data.regimeLabel})`);
    return parts.join(' ');
  } catch { return ''; }
}

// ── AI prompt ────────────────────────────────────────────────────────────────
const LOCALE_LANG: Record<string, string> = {
  ko: 'Korean', ja: 'Japanese', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
  es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian',
  ar: 'Arabic', hi: 'Hindi', id: 'Indonesian', th: 'Thai', tr: 'Turkish', vi: 'Vietnamese',
};

function buildInvestmentPrompt(ctx: ReturnType<typeof buildCtxSummary>, sectorPe: string, earnings: string, prices: Map<string, LivePrice>, vix: string, locale = 'en', session = 'morning'): string {
  const today = new Date().toISOString().slice(0, 10);
  const priceData = pricesSection(prices);
  const lang = LOCALE_LANG[locale];
  const langInstruction = lang ? `\nIMPORTANT: Write ALL text fields in ${lang} EXCEPT ticker symbols, numbers, and JSON keys.\n` : '';

  const sessionCtx = session === 'morning'
    ? '\n[Session: Morning KST — Post US-market close] Focus: US market result, overnight moves, set tone for Asia open.'
    : session === 'afternoon'
    ? '\n[Session: Afternoon KST — Post Asia-market close] Focus: Asia result, Europe opening direction, sector rotation signals.'
    : '\n[Session: Evening KST — Pre US-market open] Focus: Europe session result, futures positioning, pre-US setup.';

  return `You are a global quantitative strategist. Based on real-time multi-market data as of ${today}, provide investment strategy for the next 4 weeks.${langInstruction}${sessionCtx}

[Live Prices — use as basis for entryZone/stopLoss/target]
${priceData || 'No data'}

[Macro — US]
${ctx.macro}

[Market Sentiment — US]
${ctx.sentiment}

[Volatility — US VIX]
${vix || 'No data'}

[Capital Flows — Global Assets & Countries]
${ctx.flows}

[Korean Market — KOSPI/KOSDAQ flows]
${ctx.koreaFlow || 'No data'}

[Asset-Class Fear & Greed]
${ctx.assetFg || 'No data'}

[COT Positions]
${ctx.cot || 'No data'}

[Commodity Prices]
${ctx.commodity || 'No data'}

[Institutional Positions — 13F + Insider + 집중매매감지]
${ctx.institutional}
※ 집중매매감지 = 기간 내 5건 이상 내부자 신고 종목 (강한 확신 신호 → 포트폴리오 후보 고려)

[Sector Valuations — US SPDR ETFs]
${sectorPe || 'No data'}

[Bollinger Band 과매수 경고 — 실제 계산값]
${ctx.bbWarnings || '없음'}

[Short Squeeze Candidates — 숏커버 폭발 가능 종목]
${ctx.shorts}

[Upcoming Earnings]
${earnings || 'None'}

[News — 연준 발언·경제지표·13F 변화 포함]
${ctx.news}
※ [연준/중앙은행] 태그 = 금리 경로에 직접 영향. riskEvents와 thesis에 반드시 반영할 것.

Synthesize the above data and respond in the following JSON format only. Pure JSON, no markdown.

Key rules:
Key rules:
1. portfolio: 6-8 items — mix US stocks, US ETFs, and country ETFs (EWY=Korea, EWJ=Japan, FXI=China, VGK=Europe, INDA=India, EWT=Taiwan, EWZ=Brazil)
2. EACH portfolio item MUST have "market" field: country code (us/korea/japan/china/europe/india/taiwan/brazil/australia/global)
3. entryZone: derive from TECHNICAL + FUNDAMENTAL + GURU analysis.
   TECHNICAL: use MA/support levels from live prices context:
     - If RSI>70 (overbought): entry at 200MA level or 8-15% pullback from current
     - If RSI 50-70: entry near 50MA support level (not current price)
     - If RSI<50: entry near current (already at discount)
   FUNDAMENTAL: apply margin of safety based on valuation:
     - Growth stock (PEG 1.0-1.5): entry 10-15% below recent high
     - Value stock (P/E < sector): entry near current if P/E justified
   GURU: match entry logic to portfolio guru:
     - Lynch (PEG<1): enter at current, target = PEG*EPS*20
     - Druckenmiller: enter only after MA confirmation
     - Buffett/value: 20-30% discount to intrinsic value
   stopLoss: BELOW 200MA or -10% below entry, whichever is lower.
   target: earnings/catalyst driven, minimum +10% above current.
4. rationale (≤100 chars): MUST include ALL of these that apply:
   a) 4W return if available (e.g. "4주+25%")
   b) Overextension warning — use Bollinger Band data above + F&G:
      - If ticker appears in BB warnings with "20d2σ초과" → action="watch", add "BB 상단 이탈"
      - If ticker appears in BB warnings with "4d4σ극단초과" → action MUST be "watch", add "4일4σ극단 진입금지"
      - If F&G > 75 → add "극단탐욕 눌림목 대기"
      (4일 기준 4σ 도달은 통계적으로 극히 드문 과매수로 전문가들도 진입 금지 신호로 봄)
   c) Key reason (institutional signal, earnings beat, short squeeze)
   BAD: "KOSPI 상승세 지속" — no data, no risk assessment
   GOOD: "EWY 4주+25% + F&G 77 극단탐욕 → 눌림목 대기($112 이하 진입)"
   GOOD: "NVDA 13F 집중매집+AI 실적 서프라이즈, 52주고점 근접→단기조정 가능"
5. allocation: must sum to 100
6. action: "buy"=accumulate now, "hold"=keep if owned, "watch"=wait for entry
7. regionStances: cover ALL countries with capital flows data — us, korea, japan, china, europe, india, taiwan, brazil, australia, global
8. riskEvents: include BOTH US and international events (BOJ, ECB, Fed)
9. REQUIRED for action="buy" items: fill catalysts, fundamentalBasis, technicalBasis, riskNote, entryRationale, targetRationale
   - catalysts: array of 2-3 specific reasons with numbers (e.g., ["Blackwell GPU 출하 QoQ+40%", "내부자 집중매수 47건", "AI 데이터센터 capex $200B 전망"])
   - fundamentalBasis: ≤120 chars — EPS growth%, PEG or PE, margin trend, institutional signal
   - technicalBasis: ≤80 chars — MA position, RSI, volume trend (e.g., "200MA 위, RSI 55 중립권, 거래량 20일 평균 +18%")
   - riskNote: ≤60 chars — single biggest downside risk (e.g., "수출 규제 확대 시 매출 15% 하락 위험")
   - entryRationale: ≤80 chars — why this specific price zone
   - targetRationale: ≤80 chars — what triggers the target

{"stance":"bullish|neutral|bearish","thesis":"≤50 chars","regionStances":{"us":{"stance":"bullish","thesis":"≤40 chars","keyData":"SPY+0.1% 1w, F&G 64, VIX 18.0"},"korea":{"stance":"bullish","thesis":"≤40 chars","keyData":"EWY+1.2% 1w, F&G 77"},"japan":{"stance":"neutral","thesis":"≤40 chars","keyData":"EWJ-1.1% 1w"},"china":{"stance":"neutral","thesis":"≤40 chars","keyData":"FXI-1.7% 1w"},"europe":{"stance":"bearish","thesis":"≤40 chars","keyData":"VGK-2.3% 1w"},"india":{"stance":"neutral","thesis":"≤40 chars","keyData":"INDA-1.9% 1w"},"taiwan":{"stance":"bullish","thesis":"≤40 chars","keyData":"EWT+1.2% 1w"},"brazil":{"stance":"bearish","thesis":"≤40 chars","keyData":"EWZ-4.8% 1w"},"australia":{"stance":"neutral","thesis":"≤40 chars","keyData":"EWA-2.8% 1w"},"global":{"stance":"neutral","thesis":"≤40 chars","keyData":"Mixed signals"}},"portfolio":[{"ticker":"NVDA","name":"NVIDIA","sector":"Technology","market":"us","rationale":"≤100 chars with numbers","allocation":15,"entryZone":"$205-212","entryRationale":"200MA 지지+기관 매집 집중 구간","stopLoss":"$190","target":"$240","targetBull":"$275","targetRationale":"Blackwell 2Q 실적 확인+AI capex 가속 시 재평가","confidence":"high","action":"buy","catalysts":["Blackwell GPU 출하 QoQ+40%","내부자 집중매수 47건","AI 데이터센터 capex $200B"],"fundamentalBasis":"EPS YoY+102%, PEG 1.3, 영업이익률 55%, 기관 13F 47건 매집","technicalBasis":"200MA 위, RSI 55 중립권, 거래량 20일 평균 +18%","riskNote":"수출 규제 확대 시 매출 15% 하락 위험"}],"sectorAllocation":[{"sector":"Technology","pct":25,"stance":"overweight","reason":"≤40 chars"}],"riskEvents":[{"date":"2026-05-01","event":"NFP","impact":"high","watchFor":"≤50 chars"}],"macroAnalysis":"≤150 chars","technicalAnalysis":"≤120 chars","fundamentalAnalysis":"≤120 chars","riskLevel":"low|medium|high"}

FIELD CONTENT RULES (must be readable by non-expert investors):
- macroAnalysis: 거시지표 + 연준 발언이 시장에 미치는 영향을 평이한 한국어 문장으로.
  ※ 중요: 파월은 2026년 의장 임기 만료 후 이사(Governor)로 남아있음. "파월 의장"이 아닌 "파월 전 의장" 또는 "파월 이사"로 표기. 새 의장은 트럼프가 임명.
  예: "CPI 3.3%로 목표치 2% 초과 지속. 연준 위원 발언으로 장기금리 상승 압력."
- technicalAnalysis: VIX + 수익률 곡선만. "contango/backwardation" 같은 선물 용어 금지. 예: "VIX 18.8 저변동성 안정. 수익률 곡선 정상화."
- fundamentalAnalysis: 실적 서프라이즈 + 섹터 밸류에이션 + 기관/내부자 매수 시그널을 포함한 종합 판단. 예: "NVDA·MSFT AI 실적 서프라이즈 지속. 기관 13F 기술주 집중매집(CRWV 63건). 에너지·금융 저평가. 숏스퀴즈 위험종목(SMCI squeeze=48) 주의."
- thesis: 시장의 핵심 테마 1문장. 숏스퀴즈/내부자 매수/실적 등 주목할 시그널 포함.
- riskEvents.watchFor: 투자자가 구체적으로 무엇을 봐야 하는지 평이한 문장.

CRITICAL: portfolio의 rationale에는 반드시 아래 중 관련된 것을 언급할 것:
- 집중매매감지(내부자 X건 신고) 있으면 → "내부자 집중매수 X건"
- 숏스퀴즈 후보면 → "숏스퀴즈 위험(squeeze=N)"
- 실적 발표 임박이면 → "N일 내 실적 발표"
- 기관 13F 매집이면 → "기관 매집(기관명)"

portfolio 6-8 items with diverse markets, sectorAllocation 5 items, riskEvents 3-5 items. Pure JSON only.`;
}

interface CtxSummary {
  macro: string;
  sentiment: string;
  flows: string;
  cot: string;
  commodity: string;
  institutional: string;
  shorts: string;
  news: string;
  koreaFlow: string;
  assetFg: string;
  bbWarnings: string;
  credit: string;
  nport: string;
  optionsFlow: string;
  ownership: string;
  econCal: string;
}

function buildCtxSummary(ctx: Awaited<ReturnType<typeof gatherTabContext>>): CtxSummary {
  // Macro
  let macro = '';
  try {
    const m = ctx.macro as Record<string, unknown> | null;
    if (m) {
      const yc = m.yieldCurve as Record<string, unknown> | undefined;
      const inds = (m.indicators as Array<Record<string, unknown>>) ?? [];
      const cpi = inds.find(i => i.id === 'cpi');
      const gdp = inds.find(i => i.id === 'gdp');
      const spread = yc?.spread10y2y as number | undefined;
      const ig = inds.find(i => i.id === 'ig_spread');
      const hy = inds.find(i => i.id === 'hy_spread');
      // spread10y2y is in % (e.g. 0.51 = 51bp); multiply by 100 for basis point display
      const parts = [`YieldCurve=${yc?.inverted ? 'inverted' : 'normal'}(${spread != null ? Math.round(spread * 100) : '?'}bp)`];
      if (cpi?.actual != null) parts.push(`CPI=${cpi.actual}%`);
      if (gdp?.actual != null) {
        parts.push(`GDP=${gdp.actual}%`);
      } else if (gdp?.previous != null) {
        // Q1 2026 pending — show Q4 previous + upcoming release date for AI context
        const rel = gdp.releaseDate as string | undefined;
        parts.push(`GDP(prev Q4)=${gdp.previous}%${rel ? `→release ${rel}` : '→pending'}`);
      }
      if (ig?.actual != null) parts.push(`IG_OAS=${ig.actual}%`);
      if (hy?.actual != null) parts.push(`HY_OAS=${hy.actual}%`);
      macro = parts.join(' ');
    }
  } catch { /* ignore */ }

  // Sentiment — ctx.fearGreed is the US entry directly (score, level, label top-level)
  let sentiment = '';
  try {
    const fg = ctx.fearGreed as Record<string, unknown> | null;
    if (fg?.score != null) sentiment = `F&G(US)=${Math.round(fg.score as number)}(${fg.level ?? fg.label ?? ''})`;
    const fed = ctx.fedWatch as Record<string, unknown> | null;
    const meetings = (fed?.meetings as Array<Record<string, unknown>>) ?? [];
    if (meetings.length) {
      const next = meetings[0];
      sentiment += ` FOMC ${next.label} cut_prob=${next.probCut25}%`;
    }
  } catch { /* ignore */ }

  // Capital flows
  let flows = '';
  try {
    const cap = ctx.capital as Record<string, unknown> | null;
    const assets = (cap?.assets as Array<{ id?: string; label?: string; ticker?: string; ret1w?: number; ret4w?: number; ret13w?: number }>) ?? [];

    // Top inflows/outflows by 4w with direction signal
    const withDir = assets.filter(a => typeof a.ret4w === 'number' && typeof a.ret1w === 'number').map(a => {
      const isInflow = (a.ret4w ?? 0) >= 0;
      const signal = isInflow
        ? ((a.ret1w ?? 0) < 0 ? 'reversal↕' : (a.ret1w ?? 0) > (a.ret4w ?? 0) * 0.3 ? 'accel↑' : 'hold→')
        : ((a.ret1w ?? 0) > 0 ? 'reversal↕' : 'hold→');
      return { ...a, signal };
    });
    const topInflows = [...withDir].sort((a, b) => (b.ret4w ?? 0) - (a.ret4w ?? 0)).slice(0, 4)
      .map(a => `${a.label ?? a.ticker}:1w${(a.ret1w ?? 0) >= 0 ? '+' : ''}${(a.ret1w ?? 0).toFixed(1)}%/4w${(a.ret4w ?? 0) >= 0 ? '+' : ''}${(a.ret4w ?? 0).toFixed(1)}%(${a.signal})`);
    if (topInflows.length) flows = `Top inflows: ${topInflows.join(', ')}`;

    // 추세 전환 감지: 1w vs 13w 방향 불일치 (divergence signal)
    const divergent = assets.filter(a =>
      typeof a.ret1w === 'number' && typeof a.ret13w === 'number' &&
      Math.sign(a.ret1w) !== Math.sign(a.ret13w) &&
      Math.abs(a.ret1w) > 1.5 && Math.abs(a.ret13w) > 1.5
    ).slice(0, 3).map(a => `${a.label ?? a.ticker}(1w${(a.ret1w ?? 0) >= 0 ? '+' : ''}${(a.ret1w ?? 0).toFixed(1)}% vs 13w${(a.ret13w ?? 0) >= 0 ? '+' : ''}${(a.ret13w ?? 0).toFixed(1)}%=TREND_REVERSAL)`);
    if (divergent.length) flows += ` | TrendReversal: ${divergent.join(', ')}`;

    // Rotation pairs with momentum
    const flow = cap?.flow as Record<string, unknown> | null;
    const rots = (flow?.rotations1w as Array<{ from?: string; to?: string; magnitude?: number; momentum?: string }>) ?? [];
    if (rots.length) {
      const rotStr = rots.slice(0, 3).map(r => `${r.from}→${r.to}(${(r.magnitude ?? 0).toFixed(1)}%,${r.momentum})`).join(', ');
      flows += ` | Rotation: ${rotStr}`;
    }

    // Country flows with direction
    const cf = cap?.countryFlow as Record<string, unknown> | undefined;
    const countries = (cf?.countries as Array<{ id?: string; label?: string; ret1w?: number; ret4w?: number; ret13w?: number }>) ?? [];
    const topCtry = countries.filter(c => typeof c.ret4w === 'number').sort((a, b) => (b.ret4w ?? 0) - (a.ret4w ?? 0)).slice(0, 4).map(c => {
      const reversal = typeof c.ret1w === 'number' && typeof c.ret13w === 'number' && Math.sign(c.ret1w) !== Math.sign(c.ret13w) ? '↕' : '';
      return `${c.label}:4w${(c.ret4w ?? 0) >= 0 ? '+' : ''}${(c.ret4w ?? 0).toFixed(1)}%${reversal}`;
    });
    if (topCtry.length) flows += ` | Countries: ${topCtry.join(', ')}`;
  } catch { /* ignore */ }

  // Institutional
  let institutional = '';
  try {
    const sigs = ctx.signals ?? [];
    const buys = sigs.filter((s: { action?: string }) => s.action === 'accumulating' || s.action === 'new_position').slice(0, 5).map((s: { ticker?: string; institution?: string; estimatedValue?: string }) => `${s.ticker}(${s.institution} ${s.estimatedValue ?? ''})`);
    if (buys.length) institutional = `13F buys: ${buys.join(', ')}`;
    const insider = (ctx.insider as Array<Record<string, unknown>>) ?? [];
    if (insider.length) {
      const recent = insider.filter((i: Record<string, unknown>) => i.direction === 'buy').slice(0, 3).map((i: Record<string, unknown>) => `${i.ticker ?? '?'} ${i.officerTitle ?? 'insider'} $${Math.round(((i.transactionValueUsd as number) ?? 0) / 1000)}K`);
      if (recent.length) institutional += ` | Insider buys: ${recent.join(', ')}`;

      // Cluster detection: tickers with 5+ filings = unusually concentrated insider activity
      const clusterMap = new Map<string, { buys: number; sells: number; totalUsd: number; dates: string[] }>();
      for (const i of insider) {
        const t = i.ticker as string; if (!t) continue;
        const c = clusterMap.get(t) ?? { buys: 0, sells: 0, totalUsd: 0, dates: [] };
        if (i.direction === 'buy') c.buys++; else c.sells++;
        c.totalUsd += (i.transactionValueUsd as number) ?? 0;
        const d = (i.transactionDate ?? i.filingDate) as string | undefined;
        if (d) c.dates.push(d);
        clusterMap.set(t, c);
      }
      const hotTickers = Array.from(clusterMap.entries())
        .filter(([, c]) => c.buys + c.sells >= 5)
        .sort((a, b) => (b[1].buys + b[1].sells) - (a[1].buys + a[1].sells))
        .slice(0, 3)
        .map(([t, c]) => {
          const sorted = [...c.dates].sort();
          const dr = sorted.length > 1 ? `${sorted[0]}~${sorted[sorted.length - 1]}` : (sorted[0] ?? '');
          return `${t}(${c.buys}buy/${c.sells}sell $${Math.round(c.totalUsd / 1000)}K${dr ? ` ${dr}` : ''})`;
        });
      if (hotTickers.length) institutional += ` | 집중매매감지: ${hotTickers.join(', ')}`;
    }
  } catch { /* ignore */ }

  // COT positions
  let cot = '';
  try {
    const d = ctx.cot as { entries?: Array<Record<string, unknown>> } | null;
    if (d?.entries?.length) {
      cot = d.entries.slice(0, 5).map(e => {
        const net = e.netPosition as number;
        const wk = e.weeklyChange as number | null;
        const wkStr = wk != null ? `(${wk > 0 ? '+' : ''}${Math.round(wk / 1000)}k wk)` : '';
        return `${e.id}:${e.sentiment}${net > 0 ? '+' : ''}${Math.round(net / 1000)}k${wkStr}`;
      }).join(', ');
    }
  } catch { /* ignore */ }

  // Commodity curve
  let commodity = '';
  try {
    const d = ctx.commodity as { curves?: Array<Record<string, unknown>> } | null;
    if (d?.curves?.length) {
      commodity = d.curves
        .filter(c => Array.isArray(c.curve) && (c.curve as unknown[]).length > 0)
        .map(c => {
          const front = (c.curve as Array<{ price: number }>)[0]?.price;
          if (!front) return null;
          const struct = c.structure as string;
          const slope = c.slope as number;
          const slopeStr = Math.abs(slope) > 0.1 ? `${slope > 0 ? '+' : ''}${slope.toFixed(1)}%` : '';
          const name = c.id === 'oil' ? 'WTI' : 'Gold';
          const unit = (c.unit as string) ?? '';
          return `${name}=${front.toFixed(front >= 1000 ? 0 : 2)}${unit.includes('oz') ? '/oz' : '/bbl'}(${struct}${slopeStr})`;
        })
        .filter(Boolean).join(', ');
    }
  } catch { /* ignore */ }

  // Shorts
  let shorts = '';
  try {
    const shortData = ctx.short as Record<string, unknown> | null;
    const arr = Array.isArray(shortData) ? shortData as Array<Record<string, unknown>>
      : (shortData?.entries as Array<Record<string, unknown>>) ?? [];
    const squeeze = arr.filter(s => (s.squeezeScore as number) >= 40).slice(0, 3)
      .map(s => `${s.ticker}(squeeze=${s.squeezeScore})`);
    if (squeeze.length) shorts = squeeze.join(', ');
  } catch { /* ignore */ }

  // News — 연준 위원 발언 + 경제지표 발표 + 13F 변화 반영
  let news = '';
  try {
    const cascadeArr = (ctx.cascade as Array<Record<string, unknown>>) ?? [];
    const isFedArticle = (n: Record<string, unknown>) =>
      /powell|fomc|fed|ecb|lagarde|boj|monetary|rate cut|rate hike/i.test(String(n.title ?? n.summary));
    // Fed articles capped at 2 — prevents macro news from squeezing out sector/company themes
    const fedArticles = cascadeArr.filter(isFedArticle).slice(0, 2);
    const sectorArticles = cascadeArr.filter(n => !isFedArticle(n));
    const mixed = [...fedArticles, ...sectorArticles].slice(0, 6);
    const topNews = mixed.map(n => {
      const sent = n.sentiment === 'bullish' ? '↑' : n.sentiment === 'bearish' ? '↓' : '·';
      const prefix = isFedArticle(n) ? '[연준]' : '';
      const text = ((n.summary as string) || (n.title as string) || '').slice(0, 70);
      const impacts = ((n.cascades as Array<Record<string, unknown>>) ?? [])
        .filter(c => (c.magnitude === 'high' || c.magnitude === 'medium') && c.direction !== 'neutral')
        .slice(0, 3)
        .map(c => `${c.asset}${c.direction === 'positive' ? '↑' : '↓'}`)
        .join(',');
      return impacts ? `${sent}${prefix}${text}(${impacts})` : `${sent}${prefix}${text}`;
    });
    if (topNews.length) news = topNews.join(' | ');
  } catch { /* ignore */ }

  // Korea flows
  let koreaFlow = '';
  try {
    const cap = ctx.capital as Record<string, unknown> | null;
    const cf = cap?.countryFlow as Record<string, unknown> | undefined;
    const countries = (cf?.countries as Array<{ id?: string; label?: string; ret1w?: number | null; ret4w?: number | null }>) ?? [];
    const korea = countries.find(c => c.id === 'korea');
    if (korea) koreaFlow = `Korea(EWY): 1w=${korea.ret1w?.toFixed(1) ?? '?'}% 4w=${korea.ret4w?.toFixed(1) ?? '?'}%`;
  } catch { /* ignore */ }

  // Asset-class F&G
  let assetFg = '';
  try {
    const assets = ctx.fearGreedAssets ?? [];
    if (assets.length) {
      assetFg = assets.slice(0, 8).map(a => `${a.id}:${Math.round(a.score as number)}(${a.level})`).join(', ');
    }
  } catch { /* ignore */ }

  // Bollinger Band 과매수 판단 (sparklines from capital-flows)
  let bbWarnings = '';
  try {
    const cap = ctx.capital as Record<string, unknown> | null;
    const assets = (cap?.assets as Array<{ ticker?: string; sparkline?: number[] }>) ?? [];
    const countryAssets = ((cap?.countryFlow as Record<string, unknown>)?.countries as Array<{ ticker?: string; sparkline?: number[] }>) ?? [];
    const allAssets = [...assets, ...countryAssets];
    const warnings: string[] = [];
    for (const a of allAssets) {
      if (!a.ticker || !a.sparkline?.length) continue;
      const prices = a.sparkline;
      // 20-day BB
      if (prices.length >= 20) {
        const slice20 = prices.slice(-20);
        const mean20 = slice20.reduce((s, v) => s + v, 0) / 20;
        const std20 = Math.sqrt(slice20.reduce((s, v) => s + (v - mean20) ** 2, 0) / 20);
        const upper2σ = mean20 + 2 * std20;
        const last = prices[prices.length - 1];
        if (last > upper2σ) warnings.push(`${a.ticker}:20d2σ초과(BB${upper2σ.toFixed(2)},현재${last.toFixed(2)})`);
      }
      // 4-day 4σ
      if (prices.length >= 4) {
        const slice4 = prices.slice(-4);
        const mean4 = slice4.reduce((s, v) => s + v, 0) / 4;
        const std4 = Math.sqrt(slice4.reduce((s, v) => s + (v - mean4) ** 2, 0) / 4);
        const upper4σ = mean4 + 4 * std4;
        const last = prices[prices.length - 1];
        if (last >= upper4σ && std4 > 0) warnings.push(`⚠️${a.ticker}:4d4σ극단초과→진입금지`);
      }
    }
    if (warnings.length) bbWarnings = warnings.join(', ');
  } catch { /* non-fatal */ }

  // 신용잔고 — 시장 레버리지 리스크 신호 (Codex 권장: S1 Macro에 포함)
  let credit = '';
  try {
    const cr = ctx.credit as Record<string, unknown> | null;
    const snap = (cr?.globalSnapshot as Record<string, unknown>) ?? {};
    const total = snap.totalUsd as number | null;
    const gdpPct = snap.avgGdpPct as number | null;
    const usEntry = (cr?.countries as Array<Record<string, unknown>>)?.find((c: Record<string, unknown>) => c.id === 'us');
    if (total && gdpPct) {
      const usYoy = usEntry?.yoyChangePct as number | null;
      credit = `신용잔고: 글로벌 $${(total/1e9).toFixed(0)}B, GDP대비${gdpPct.toFixed(1)}%${usYoy != null ? `, US YoY${usYoy.toFixed(1)}%` : ''}`;
    }
  } catch { /* ignore */ }

  // N-PORT 뮤추얼펀드 집계 (기관 매집 신호)
  let nport = '';
  try {
    const np = ctx.nport as Record<string, unknown> | null;
    const byTicker = (np?.byTicker as Array<Record<string, unknown>>) ?? [];
    const top = byTicker
      .filter(t => typeof t.totalValue === 'number' && t.totalValue > 0)
      .sort((a, b) => (b.totalValue as number) - (a.totalValue as number))
      .slice(0, 4)
      .map(t => `${t.ticker}($${Math.round((t.totalValue as number) / 1e6)}M)`);
    if (top.length) nport = `N-PORT 기관집계: ${top.join(', ')}`;
  } catch { /* ignore */ }

  // 옵션 플로우 (이상 매수/매도 신호)
  let optionsFlow = '';
  try {
    const opts = (ctx.options as Array<Record<string, unknown>>) ?? [];
    const notable = opts.filter(o => o.unusual || (o.premium as number) > 500000).slice(0, 3);
    if (notable.length) {
      optionsFlow = `옵션이상: ${notable.map(o => `${o.ticker}${o.side}(${o.type}$${Math.round((o.premium as number)/1000)}K)`).join(', ')}`;
    }
  } catch { /* ignore */ }

  // 13D/G 대량보유 알림 (5% 이상 지분 변동)
  let ownership = '';
  try {
    const ow = (ctx.ownership as Array<Record<string, unknown>>) ?? [];
    const recent = ow.slice(0, 3).map(o => `${o.ticker}(${o.filerName} ${o.changePct ?? o.pct}%)`);
    if (recent.length) ownership = `13D/G지분변동: ${recent.join(', ')}`;
  } catch { /* ignore */ }

  // 경제 캘린더 — 향후 7일 고임팩트 이벤트
  let econCal = '';
  try {
    const cal = ctx.econCal as Record<string, unknown> | null;
    const events = (cal?.events as Array<Record<string, unknown>>) ?? [];
    const highImpact = events
      .filter(e => e.impact === 'high' || e.impact === 3)
      .slice(0, 4)
      .map(e => `${e.date}:${e.event}`);
    if (highImpact.length) econCal = `고임팩트이벤트: ${highImpact.join(', ')}`;
  } catch { /* ignore */ }

  return { macro, sentiment, flows, cot, commodity, institutional, shorts, news, koreaFlow, assetFg, bbWarnings, credit, nport, optionsFlow, ownership, econCal };
}

// ── Event calendar for fallback risk events — mirrors macro-indicators FOMC_DATES_UPCOMING / RELEASE_SCHEDULE ─
const FALLBACK_FOMC_DATES = ['2026-06-17','2026-07-29','2026-09-16','2026-10-28','2026-12-09']; // 2026-04-29 hold confirmed
const FALLBACK_NFP_DATES  = ['2026-05-01','2026-06-05','2026-07-03','2026-08-07','2026-09-04','2026-10-02'];
const FALLBACK_CPI_DATES  = ['2026-05-13','2026-06-10','2026-07-15','2026-08-12','2026-09-10','2026-10-14'];
function nextEventDate(dates: string[]): string {
  const today = new Date().toISOString().slice(0, 10);
  return dates.find(d => d > today) ?? dates[dates.length - 1];
}

// ── Fallback strategy when AI fails ──────────────────────────────────────────
function fallbackStrategy(locale = 'en'): InvestmentStrategy {
  const isKo = locale === 'ko';
  const isJa = locale === 'ja';
  const isZh = locale === 'zh-CN' || locale === 'zh-TW';

  const txt = {
    thesis: isKo ? '데이터 기반 분산 ETF 배분 — 시장 신호 대기'
           : isJa ? 'データ駆動分散ETF配分 — 市場シグナル待機'
           : isZh ? '数据驱动分散ETF配置 — 等待市场信号'
           : 'Data-driven diversified ETF — awaiting market signal',
    spyRationale: isKo ? 'S&P500 코어 — 분산 시장 익스포저, F&G 탐욕 구간'
                : isJa ? 'S&P500コア — 分散市場エクスポージャー、F&G欲張り局面'
                : isZh ? 'S&P500核心 — 分散市场敞口，F&G贪婪区间'
                : 'S&P500 core — diversified exposure, F&G greed regime',
    qqqRationale: isKo ? 'Mag7 AI 설비 투자 사이클 — 클라우드/반도체 성장'
                : isJa ? 'Mag7 AI設備投資サイクル — クラウド/半導体成長'
                : isZh ? 'Mag7 AI资本支出周期 — 云计算/半导体成长'
                : 'Mag7 AI capex cycle — cloud and semiconductor growth',
    gldRationale: isKo ? '중앙은행 매수 + 지정학 리스크 헤지'
                : isJa ? '中央銀行買い + 地政学リスクヘッジ'
                : isZh ? '央行购金 + 地缘风险对冲'
                : 'Central bank demand + geopolitical risk hedge',
    tltRationale: isKo ? 'FOMC 금리 인하 기대 — 장기 금리 하락 베팅'
                : isJa ? 'FOMC利下げ期待 — 長期金利低下へのベット'
                : isZh ? 'FOMC降息预期 — 押注长期利率下行'
                : 'FOMC rate cut expectations — long-duration positioning',
    cashRationale: isKo ? '고VIX 이벤트 대비 현금 준비 — MMF 5%+ 수익'
                 : isJa ? '高VIXイベント備え現金準備 — MMF5%+リターン'
                 : isZh ? '高VIX事件准备现金储备 — 货币基金5%+收益'
                 : 'VIX event buffer — MMF 5%+ yield on dry powder',
    techReason: isKo ? 'AI 자본지출 사이클 지속'
              : isJa ? 'AI設備投資サイクル継続'
              : isZh ? 'AI资本支出周期持续'
              : 'AI capex cycle sustained',
    finReason: isKo ? '금리 인하 경로가 순이자마진에 긍정적'
             : isJa ? '利下げ経路が純金利マージンにプラス'
             : isZh ? '降息路径对净息差有利'
             : 'Rate cut trajectory positive for NIM',
    hcReason: isKo ? '방어적 배분, 안정적 수익'
            : isJa ? '防御的配分、安定した収益'
            : isZh ? '防御性配置，稳定收益'
            : 'Defensive allocation, stable earnings',
    energyReason: isKo ? '수요 불확실성, 지정학적 프리미엄 소멸'
                : isJa ? '需要不確実性、地政学的プレミアム消滅'
                : isZh ? '需求不确定性，地缘溢价消退'
                : 'Demand uncertainty, geopolitical premium fading',
    consumerReason: isKo ? '소비 지출 둔화 리스크'
                  : isJa ? '消費支出鈍化リスク'
                  : isZh ? '消费支出放缓风险'
                  : 'Consumer spending slowdown risk',
    bondReason: isKo ? '리스크 관리 + 금리 인하 옵션성'
              : isJa ? 'リスク管理 + 利下げオプション性'
              : isZh ? '风险管理 + 降息期权性'
              : 'Risk management + rate-cut optionality',
    fomcWatch: isKo ? '금리 인하 확률 및 연준 위원(파월 전 의장 포함) 향후 발언'
             : isJa ? '利下げ確率とパウエル議長の今後の方針発言'
             : isZh ? '降息概率及鲍威尔对未来路径的指引'
             : 'Rate cut probability and Powell guidance on future path',
    nfpWatch: isKo ? '고용시장 건전성과 연준 반응 함수'
            : isJa ? '雇用市場の健全性とFRBの反応関数'
            : isZh ? '就业市场健康状况与美联储反应函数'
            : 'Labor market health and Fed reaction function',
    cpiWatch: isKo ? '인플레이션 경로 대 연준 2% 목표'
            : isJa ? 'インフレ経路 対 FRB 2%目標'
            : isZh ? '通胀路径与美联储2%目标对比'
            : 'Inflation trajectory vs Fed 2% target',
    macroAnalysis: isKo ? '수익률 곡선 스프레드, CPI 추세, IG/HY OAS 크레딧 스프레드가 거시 환경을 결정하는 핵심 변수입니다.'
                 : isJa ? 'イールドカーブスプレッド、CPI推移、IG/HY OASクレジットスプレッドがマクロ環境を決定する主要変数です。'
                 : isZh ? '收益率曲线利差、CPI趋势和IG/HY OAS信用利差是决定宏观环境的核心变量。'
                 : 'Yield curve spread, CPI trend, and IG/HY OAS credit spreads are the key macro environment variables.',
    technicalAnalysis: isKo ? 'SPY 200일 이동평균 지지선 및 VIX 레짐 모니터링 권장. 20 이하 VIX는 강세 신호, 30 이상은 변동성 확대 구간.'
                     : isJa ? 'SPY 200日移動平均サポートとVIXレジームの監視を推奨。VIX 20以下は強気シグナル、30以上はボラティリティ拡大局面。'
                     : isZh ? '建议监控SPY 200日均线支撑和VIX机制。VIX低于20为看涨信号，高于30为波动扩大区间。'
                     : 'Monitor SPY 200-day MA support and VIX regime. VIX below 20 = bullish signal; above 30 = elevated volatility.',
    fundamentalAnalysis: isKo ? '기술주(XLK) AI 실적 서프라이즈 지속으로 밸류에이션 부담에도 모멘텀 유지. 에너지·금융 섹터 상대적 저평가. 금리 고공행진이 고PER 성장주에 압박.'
                        : isJa ? 'テクノロジー(XLK)はAI業績サプライズでバリュエーション負担にもかかわらずモメンタム維持。エネルギー・金融は相対的割安。'
                        : isZh ? '科技股(XLK)受AI业绩惊喜支撑，估值压力下仍保持动能。能源和金融板块相对低估。'
                        : 'Technology (XLK) AI earnings surprises sustain momentum despite valuation premium. Energy/Financials relatively cheap. High rates pressure high-P/E growth.',
  };

  return {
    stance: 'neutral',
    thesis: txt.thesis,
    portfolio: [
      { ticker: 'SPY', name: 'S&P 500 ETF', sector: isKo ? '분산형' : 'Diversified', rationale: txt.spyRationale, allocation: 35, entryZone: 'market ±1%', stopLoss: '-5%', target: '+8%', confidence: 'medium', action: 'hold' as const },
      { ticker: 'QQQ', name: 'Nasdaq 100 ETF', sector: isKo ? '기술' : 'Technology', rationale: txt.qqqRationale, allocation: 25, entryZone: 'market ±1%', stopLoss: '-7%', target: '+12%', confidence: 'medium', action: 'hold' as const },
      { ticker: 'GLD', name: 'Gold ETF', sector: isKo ? '원자재' : 'Commodities', rationale: txt.gldRationale, allocation: 15, entryZone: 'market ±1%', stopLoss: '-4%', target: '+6%', confidence: 'medium', action: 'hold' as const },
      { ticker: 'TLT', name: '20Y Treasury ETF', sector: isKo ? '채권' : 'Bonds', rationale: txt.tltRationale, allocation: 15, entryZone: 'market ±1%', stopLoss: '-4%', target: '+5%', confidence: 'low', action: 'watch' as const },
      { ticker: 'CASH', name: isKo ? '현금/T-Bill' : 'Cash / T-Bills', sector: isKo ? '현금' : 'Cash', rationale: txt.cashRationale, allocation: 10, entryZone: '-', stopLoss: '-', target: isKo ? '+5% (연환산)' : '+5% annualized', confidence: 'high', action: 'hold' as const },
    ],
    sectorAllocation: [
      { sector: isKo ? '기술' : 'Technology', pct: 25, stance: 'overweight', reason: txt.techReason },
      { sector: isKo ? '금융' : 'Financials', pct: 20, stance: 'neutral', reason: txt.finReason },
      { sector: isKo ? '헬스케어' : 'Health Care', pct: 15, stance: 'neutral', reason: txt.hcReason },
      { sector: isKo ? '에너지' : 'Energy', pct: 10, stance: 'underweight', reason: txt.energyReason },
      { sector: isKo ? '경기소비재' : 'Consumer Disc.', pct: 15, stance: 'underweight', reason: txt.consumerReason },
      { sector: isKo ? '현금/채권' : 'Cash/Bonds', pct: 15, stance: 'overweight', reason: txt.bondReason },
    ],
    riskEvents: [
      { date: nextEventDate(FALLBACK_FOMC_DATES), event: isKo ? 'FOMC 금리 결정' : isJa ? 'FOMC金利決定' : 'FOMC Rate Decision', impact: 'high', watchFor: txt.fomcWatch },
      { date: nextEventDate(FALLBACK_NFP_DATES),  event: isKo ? '비농업 고용지수' : isJa ? '非農業部門雇用者数' : 'Non-Farm Payrolls', impact: 'high', watchFor: txt.nfpWatch },
      { date: nextEventDate(FALLBACK_CPI_DATES),  event: isKo ? 'CPI / 근원 PCE' : isJa ? 'CPI / コアPCE' : 'CPI / Core PCE', impact: 'medium', watchFor: txt.cpiWatch },
    ],
    macroAnalysis: txt.macroAnalysis,
    technicalAnalysis: txt.technicalAnalysis,
    fundamentalAnalysis: txt.fundamentalAnalysis,
    riskLevel: 'medium',
    generatedAt: new Date().toISOString(),
    dataAsOf: new Date().toISOString(),
    source: 'fallback',
  };
}

// ── Data-driven fallback: adjusts base allocations using real-time signals ────
function priceZone(prices: Map<string, { price: number }>, ticker: string, pctRange: number): string {
  const p = prices.get(ticker)?.price;
  if (!p || p <= 0) return 'market ±' + pctRange + '%';
  const isKR = ticker.endsWith('.KS');
  if (isKR) {
    const lo = Math.round(p * (1 - pctRange / 100) / 100) * 100;
    const hi = Math.round(p * (1 + pctRange / 100) / 100) * 100;
    return `₩${lo.toLocaleString()}-₩${hi.toLocaleString()}`;
  }
  const lo = Math.round(p * (1 - pctRange / 100) * 100) / 100;
  const hi = Math.round(p * (1 + pctRange / 100) * 100) / 100;
  return `$${lo.toFixed(2)}-$${hi.toFixed(2)}`;
}

function dataFallbackStrategy(ctx: Awaited<ReturnType<typeof gatherTabContext>>, locale = 'en', prices: Map<string, { price: number }> = new Map()): InvestmentStrategy {
  const base = fallbackStrategy(locale);

  // Extract signals from context
  const fg = ctx.fearGreed as Record<string, unknown> | null;
  const fgScore: number = (fg?.score as number) ?? 50;
  const macro = ctx.macro as Record<string, unknown> | null;
  const yc = macro?.yieldCurve as Record<string, unknown> | undefined;
  const inverted = (yc?.inverted as boolean) ?? false;
  const spread = (yc?.spread10y2y as number) ?? null;
  const inds = (macro?.indicators as Array<Record<string, unknown>>) ?? [];
  const igSpread = (inds.find(i => i.id === 'ig_spread')?.actual as number) ?? 0.8;
  const hySpread = (inds.find(i => i.id === 'hy_spread')?.actual as number) ?? 3.0;
  const vol = ctx.volatility as Record<string, unknown> | null;
  const vix: number = (vol?.vix as number) ?? 18;

  // Base allocations (sum = 100)
  let spy = PORTFOLIO.DEFAULT_SPY, qqq = PORTFOLIO.DEFAULT_QQQ, gld = PORTFOLIO.DEFAULT_GLD, tlt = PORTFOLIO.DEFAULT_TLT, cash = PORTFOLIO.DEFAULT_CASH;

  // Adjustments: risk-off signals → reduce equity, increase defensive
  if (vix > VIX.HIGH || igSpread > SPREADS.IG_ELEVATED || hySpread > SPREADS.HY_ELEVATED) {
    spy -= 10; qqq -= 5; gld += 5; cash += 10;
  } else if (vix > VIX.NORMAL || igSpread > SPREADS.IG_NORMAL) {
    spy -= 5; qqq -= 5; gld += 5; cash += 5;
  }
  if (inverted) {
    tlt -= 10; cash += 10; // Inverted curve = bond duration risk
  }
  if (fgScore >= FG.EXTREME_GREED) {
    spy -= 5; gld += 5; // Extreme greed = take some off the table
  } else if (fgScore <= FG.EXTREME_FEAR) {
    spy += 5; cash -= 5; // Extreme fear = buying opportunity
  }

  // Clamp each to [5, 55] then normalize to 100
  const clamp = (v: number) => Math.max(5, Math.min(55, v));
  spy = clamp(spy); qqq = clamp(qqq); gld = clamp(gld); tlt = clamp(tlt); cash = clamp(cash);
  const total = spy + qqq + gld + tlt + cash;
  const norm = 100 / total;
  spy = Math.round(spy * norm);
  qqq = Math.round(qqq * norm);
  gld = Math.round(gld * norm);
  tlt = Math.round(tlt * norm);
  cash = 100 - spy - qqq - gld - tlt;

  // Build data-driven thesis
  const isKo = locale === 'ko';
  const isJa = locale === 'ja';
  const isZh = locale === 'zh-CN' || locale === 'zh-TW';
  const vixLabel = vix > VIX.HIGH ? (isKo ? '고변동성' : 'high-vol') : vix > VIX.NORMAL ? (isKo ? '변동성 상승' : 'elevated-vol') : (isKo ? '저변동성' : 'low-vol');
  const fgLabel = fgScore >= FG.EXTREME_GREED ? (isKo ? '탐욕 과잉' : 'extreme greed') : fgScore >= FG.GREED ? (isKo ? '탐욕' : 'greed') : fgScore >= FG.FEAR ? (isKo ? '중립' : 'neutral') : fgScore > FG.EXTREME_FEAR ? (isKo ? '공포' : 'fear') : (isKo ? '극단적 공포' : 'extreme fear');
  const ycLabel = inverted ? (isKo ? '수익률 곡선 역전' : 'curve inverted') : (spread != null ? (isKo ? `스프레드 ${Math.round(spread * 100)}bp` : `spread ${Math.round(spread * 100)}bp`) : '');
  const conditions = [vixLabel, fgLabel, ycLabel].filter(Boolean).join(' · ');

  const thesis = isKo ? `데이터 기반 배분 — ${conditions}`
    : isJa ? `データ駆動配分 — ${conditions}`
    : isZh ? `数据驱动配置 — ${conditions}`
    : `Data-driven allocation — ${conditions}`;

  const riskLevel: 'low' | 'medium' | 'high' = vix > 28 || fgScore <= FG.EXTREME_FEAR || igSpread > 1.5 ? 'high' : vix < 18 && fgScore >= FG.GREED ? 'low' : 'medium';

  // Build data-populated analysis text (replaces generic "AI unavailable" from base)
  const cpiInd = inds.find((i: Record<string, unknown>) => i.id === 'cpi');
  const gdpInd = inds.find((i: Record<string, unknown>) => i.id === 'gdp');
  const spreadStr = spread != null ? `${Math.round(spread * 100)}bp` : '?bp';
  const ycStr = `YieldCurve=${inverted ? 'inverted' : 'normal'}(${spreadStr})`;
  const cpiStr = cpiInd?.actual != null ? `CPI=${(cpiInd.actual as number).toFixed(1)}%YoY` : '';
  const gdpStr = gdpInd?.actual != null
    ? `GDP=${(gdpInd.actual as number).toFixed(1)}%`
    : gdpInd?.previous != null ? `GDP(Q4)=${(gdpInd.previous as number).toFixed(1)}%→Q1 pending` : '';
  // Human-readable Korean analysis (fallback when AI unavailable)
  const cpiVal = cpiInd?.actual as number | null | undefined;
  const gdpVal = gdpInd?.actual != null ? gdpInd.actual as number : gdpInd?.previous as number | null | undefined;
  const macroAnalysis = isKo
    ? [
        inverted ? `수익률 곡선 역전(${Math.round((spread ?? 0) * 100)}bp) — 경기침체 경보` : `수익률 곡선 정상(+${Math.round((spread ?? 0) * 100)}bp), 경기침체 신호 없음`,
        cpiVal != null ? `CPI ${cpiVal.toFixed(1)}%로 인플레이션 ${cpiVal > 3 ? '여전히 목표치(2%) 초과' : '완화세'}` : '',
        gdpVal != null ? `GDP ${gdpVal.toFixed(1)}% (${gdpInd?.actual != null ? '최신' : 'Q4 이전'})` : '',
        igSpread > 1.5 ? `신용 스프레드(IG ${igSpread.toFixed(1)}%) 확대 — 리스크 경보` : `신용 스프레드 안정(IG ${igSpread.toFixed(1)}%)`,
      ].filter(Boolean).join('. ') + '.'
    : [ycStr, cpiStr, gdpStr, `IG OAS ${igSpread.toFixed(2)}%`, `F&G ${Math.round(fgScore)}(${fgLabel})`].filter(Boolean).join(' · ');

  const technicalAnalysis = isKo
    ? `VIX ${vix.toFixed(1)}${vix > 28 ? ' — 고변동성, 방어 포지션 확대 권장' : vix > 20 ? ' — 변동성 상승, 헤지 고려' : ' — 저변동성 안정 구간'}. ${inverted ? '수익률 곡선 역전 — 경기침체 리스크 주시' : '수익률 곡선 정상, 경기침체 신호 없음'}.`
    : `VIX=${vix.toFixed(1)}(${vixLabel})${inverted ? ' · curve inverted — recession signal active' : ' · curve normal — no recession signal'}`;

  // Use real nextRelease dates from macro-indicators instead of fallback's d(N) offsets.
  // fallbackStrategy uses d(7), d(14), d(21) relative offsets which drift from actual release dates.
  const fomcInd = inds.find(i => i.id === 'fomc');
  const nfpInd  = inds.find(i => i.id === 'nfp');
  const cpiInd2 = inds.find(i => i.id === 'cpi');
  const liveRiskEvents = [
    fomcInd?.nextRelease && {
      date: fomcInd.nextRelease as string,
      event: isKo ? 'FOMC 금리 결정' : isJa ? 'FOMC金利決定' : 'FOMC Rate Decision',
      impact: 'high' as const,
      watchFor: isKo ? '금리 결정 및 점도표 변화' : isJa ? '金利決定とドットチャート変化' : 'Rate decision and dot-plot guidance',
    },
    nfpInd?.nextRelease && {
      date: nfpInd.nextRelease as string,
      event: isKo ? '비농업 고용지수' : isJa ? '非農業部門雇用者数' : 'Non-Farm Payrolls',
      impact: 'high' as const,
      watchFor: isKo ? '고용 강도 및 실업률' : isJa ? '雇用強度と失業率' : 'Jobs strength and unemployment rate',
    },
    cpiInd2?.nextRelease && {
      date: cpiInd2.nextRelease as string,
      event: isKo ? 'CPI 소비자물가' : isJa ? 'CPI消費者物価' : 'CPI Inflation',
      impact: 'medium' as const,
      watchFor: isKo ? '목표 2% 대비 인플레이션 추세' : isJa ? 'インフレ推移と利下げ見通し' : 'Inflation trend vs 2% target',
    },
  ].filter(Boolean) as typeof base.riskEvents;

  return {
    ...base,
    stance: riskLevel === 'high' ? 'bearish' : riskLevel === 'low' ? 'bullish' : 'neutral',
    thesis,
    riskLevel,
    macroAnalysis,
    technicalAnalysis,
    riskEvents: liveRiskEvents.length >= 3 ? liveRiskEvents.slice(0, 3) : base.riskEvents,
    // Data-driven fundamentalAnalysis using real F&G + rate context
    fundamentalAnalysis: isKo
      ? `${fgScore > 70 ? '탐욕 과잉 — 고PER 구간 경계' : fgScore < 30 ? '극단적 공포 — 밸류에이션 저점 접근' : 'F&G 중립 — 밸류에이션 합리적'}. 기술주 AI 실적 서프라이즈로 모멘텀 유지. 에너지·금융 상대적 저평가.`
      : `F&G ${Math.round(fgScore)}(${fgLabel}) — ${fgScore > 70 ? 'overvalued territory' : fgScore < 30 ? 'undervalued entry' : 'fair valuation'}. Tech AI beats sustain momentum. Energy/Financials cheap.`,
    portfolio: [
      // ETF core — with actual dollar entry zones from live prices
      { ...base.portfolio[0], allocation: Math.round(spy * 0.7),
        entryZone: priceZone(prices, 'SPY', 1),
        stopLoss: (() => { const p = prices.get('SPY')?.price; return p ? `$${(p * 0.93).toFixed(2)}` : '-7%'; })(),
        target: (() => { const p = prices.get('SPY')?.price; return p ? `$${(p * 1.09).toFixed(2)}` : '+9%'; })(),
        currentPrice: prices.get('SPY')?.price,
      },
      { ...base.portfolio[1], allocation: Math.round(qqq * 0.7),
        entryZone: priceZone(prices, 'QQQ', 1.5),
        stopLoss: (() => { const p = prices.get('QQQ')?.price; return p ? `$${(p * 0.91).toFixed(2)}` : '-9%'; })(),
        target: (() => { const p = prices.get('QQQ')?.price; return p ? `$${(p * 1.12).toFixed(2)}` : '+12%'; })(),
        currentPrice: prices.get('QQQ')?.price,
      },
      // Individual stocks
      {
        ticker: 'NVDA', name: 'NVIDIA', sector: isKo ? '기술' : 'Technology', market: 'us',
        rationale: isKo ? `AI 가속기 독점 — Blackwell 사이클 + F&G ${Math.round(fgScore)}` : `AI accelerator monopoly — Blackwell cycle`,
        allocation: Math.max(5, Math.round(qqq * 0.2)),
        entryZone: priceZone(prices, 'NVDA', 2.5),
        stopLoss: (() => { const p = prices.get('NVDA')?.price; return p ? `$${(p * 0.88).toFixed(2)}` : '-12%'; })(),
        target: (() => { const p = prices.get('NVDA')?.price; return p ? `$${(p * 1.25).toFixed(2)}` : '+25%'; })(),
        currentPrice: prices.get('NVDA')?.price,
        confidence: (fgScore > 60 ? 'high' : 'medium') as 'high' | 'medium',
        action: 'buy' as const,
      },
      {
        ticker: 'JPM', name: 'JPMorgan Chase', sector: isKo ? '금융' : 'Financials', market: 'us',
        rationale: isKo ? `금리 고공 → NIM 수혜 + 실적 서프라이즈` : `High rates → NIM tailwind + earnings beat`,
        allocation: Math.max(5, Math.round(spy * 0.15)),
        entryZone: priceZone(prices, 'JPM', 2),
        stopLoss: (() => { const p = prices.get('JPM')?.price; return p ? `$${(p * 0.92).toFixed(2)}` : '-8%'; })(),
        target: (() => { const p = prices.get('JPM')?.price; return p ? `$${(p * 1.15).toFixed(2)}` : '+15%'; })(),
        currentPrice: prices.get('JPM')?.price,
        confidence: 'medium' as const,
        action: 'buy' as const,
      },
      { ...base.portfolio[2], allocation: gld,
        entryZone: priceZone(prices, 'GLD', 1.5),
        currentPrice: prices.get('GLD')?.price,
      },
      { ...base.portfolio[3], allocation: tlt,
        entryZone: priceZone(prices, 'TLT', 2),
        currentPrice: prices.get('TLT')?.price,
      },
      { ...base.portfolio[4], allocation: Math.max(5, cash - 5) },
    ].filter(p => p.allocation > 0),
  };
}

// ── Parse AI response ─────────────────────────────────────────────────────────
function parseStrategy(raw: string, source: string): InvestmentStrategy | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<InvestmentStrategy>;

    // Stance must be a valid enum value
    if (!parsed.stance || !['bullish', 'neutral', 'bearish'].includes(parsed.stance)) return null;
    if (typeof parsed.thesis !== 'string' || !parsed.thesis) return null;

    // Portfolio: minimum 5 positions, each must have ticker + positive allocation
    if (!Array.isArray(parsed.portfolio)) return null;
    const portfolioRaw = (parsed.portfolio as Partial<PortfolioItem>[])
      .filter((p): p is PortfolioItem =>
        typeof p?.ticker === 'string' && p.ticker.length > 0 &&
        typeof p?.allocation === 'number' && p.allocation > 0
      )
      .map(p => ({
        ...p,
        action: (['buy', 'hold', 'watch'] as const).includes(p.action as never) ? p.action : undefined,
      }));
    // Dedup by ticker — keep highest allocation entry (AI occasionally returns same ticker twice)
    const seenTickers = new Map<string, PortfolioItem>();
    for (const p of portfolioRaw) {
      const existing = seenTickers.get(p.ticker.toUpperCase());
      if (!existing || (p.allocation ?? 0) > (existing.allocation ?? 0)) {
        seenTickers.set(p.ticker.toUpperCase(), p);
      }
    }
    const portfolio = Array.from(seenTickers.values());
    if (portfolio.length < 5) {
      logger.warn('investment-strategy', 'portfolio_invalid', { count: portfolio.length, raw: raw.slice(0, 200) });
      return null;
    }

    // Allocation sum: warn but don't reject (AI rounding can cause slight deviation)
    const allocSum = portfolio.reduce((s, p) => s + p.allocation, 0);
    if (Math.abs(allocSum - 100) > 15) {
      logger.warn('investment-strategy', 'allocation_sum_off', { sum: allocSum });
    }

    return {
      stance: parsed.stance,
      thesis: parsed.thesis.slice(0, 150),
      portfolio,
      sectorAllocation: Array.isArray(parsed.sectorAllocation) ? parsed.sectorAllocation : [],
      riskEvents: Array.isArray(parsed.riskEvents) ? parsed.riskEvents : [],
      macroAnalysis: typeof parsed.macroAnalysis === 'string' ? parsed.macroAnalysis : '',
      technicalAnalysis: typeof parsed.technicalAnalysis === 'string' ? parsed.technicalAnalysis : '',
      fundamentalAnalysis: typeof parsed.fundamentalAnalysis === 'string' ? parsed.fundamentalAnalysis : '',
      riskLevel: parsed.riskLevel && ['low', 'medium', 'high'].includes(parsed.riskLevel) ? parsed.riskLevel : 'medium',
      generatedAt: new Date().toISOString(),
      source,
    };
  } catch (e) {
    logger.warn('investment-strategy', 'parse_exception', { error: String(e) });
    return null;
  }
}

// ── GET handler — READ-ONLY (캐시만 읽음, AI 생성 없음) ──────────────────────
// AI 생성은 크론(/api/cron/investment-strategy)이 하루 3회 담당.
// 사용자 요청: 캐시 히트 → 즉시 반환 / 미스 → stale 반환 / 없으면 빈 응답.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locale = searchParams.get('locale') ?? 'en';
  // probe=1: used by verify-metrics — always return quickly
  const probe = searchParams.get('probe') === '1';
  // force=1 with cron auth only — triggers live generation (for cron route)
  const rawForce = searchParams.get('force') === '1';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const cronAuthed = !cronSecret || (request as Request).headers.get('authorization') === `Bearer ${cronSecret}`;
  const force = rawForce && cronAuthed;

  const redis = createRedis();
  const session = getKstSession();
  const key = cacheKey(session, locale);

  // Memory cache (no-Redis path)
  if (!redis && STRATEGY_MEMORY_CACHE && Date.now() < STRATEGY_MEMORY_CACHE.expiresAt) {
    return NextResponse.json({ ...STRATEGY_MEMORY_CACHE.data, cached: true }, { headers: CDN_HEADERS });
  }

  if (redis) {
    try {
      // 1. Current session cache (force=1 bypasses for fresh cron regeneration)
      if (!force) {
        const cached = await redis.get(key);
        if (cached) {
          logger.info('api.investment-strategy', 'cache_hit', { locale, session });
          return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
        }
      }

      // Non-priority locale: try 'en' cache first
      if (!PRIORITY_LOCALES.has(locale) && locale !== 'en') {
        const enKey = cacheKey(session, 'en');
        const enCached = await redis.get(enKey);
        if (enCached) {
          logger.info('api.investment-strategy', 'locale_fallback_hit', { locale, fallbackLocale: 'en', session });
          return NextResponse.json({ ...(enCached as object), cached: true, localeFallback: true }, { headers: CDN_HEADERS });
        }
      }
      // 2. Stale (last AI-generated report, up to 7 days) — schema-validated
      if (!force) {
        const stale = await redis.get(staleKey(locale));
        if (stale && isSchemaCompatible(stale as Record<string, unknown>)) {
          logger.info('api.investment-strategy', 'stale_hit', { locale });
          return NextResponse.json({ ...(stale as object), cached: true, stale: true }, { headers: CDN_HEADERS });
        }
        if (stale && !isSchemaCompatible(stale as Record<string, unknown>)) {
          logger.warn('api.investment-strategy', 'stale_schema_mismatch', { locale, missing: REQUIRED_SCHEMA_FIELDS.filter(f => !(stale as Record<string,unknown>)[f]) });
          // Delete incompatible stale so next cron regenerates properly
          try { await redis.del(staleKey(locale)); } catch { /* best-effort */ }
        }
        // 3. Any previous session's report from today or yesterday (A1 fix)
        const yesterday = new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
        for (const dateStr of [new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), yesterday]) {
          for (const s of ['morning', 'afternoon', 'evening'] as const) {
            if (dateStr === new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) && s === session) continue;
            const alt = await redis.get(`flowvium:investment-strategy:v${SCHEMA_VERSION}:${dateStr}:${s}`);
            if (alt && isSchemaCompatible(alt as Record<string, unknown>)) {
              return NextResponse.json({ ...(alt as object), cached: true, stale: true }, { headers: CDN_HEADERS });
            }
          }
        }
        // 4. No data at all — return minimal static fallback (no AI)
        if (probe) {
          return NextResponse.json(fallbackStrategy(locale), { headers: { 'Cache-Control': 'no-store' } });
        }
        return NextResponse.json({ ...fallbackStrategy(locale), stale: true, noData: true }, { headers: { 'Cache-Control': 'public, s-maxage=60' } });
      }
    } catch (e) { logger.warn('api.investment-strategy', 'cache_read_error', { error: e }); }
  }

  if (probe) {
    return NextResponse.json(fallbackStrategy(locale), { headers: { 'Cache-Control': 'no-store' } });
  }

  // HARD GATE: if not cron-authenticated force request → NEVER generate, always return fallback
  if (!force) {
    return NextResponse.json({ ...fallbackStrategy(locale), stale: true, noData: true }, { headers: { 'Cache-Control': 'public, s-maxage=60' } });
  }

  // Only continues if force=1 AND cronAuthed (cron calls only)

  const reqUrl = new URL(request.url);
  const baseUrl = reqUrl.host.startsWith('localhost')
    ? 'http://localhost:3000'
    : `${reqUrl.protocol}//${reqUrl.host}`;

  // 각 컨텍스트를 독립적으로 수집 — 하나가 느려도 나머지 데이터 보존
  // (Promise.race + allSettled 조합: 전체 타임아웃 30s, 개별 실패는 빈값으로 대체)
  let ctx: Awaited<ReturnType<typeof gatherTabContext>>;
  let sectorPe: string, earnings: string, vixCtx: string, activeCascades: string;
  let livePrices: Awaited<ReturnType<typeof getLivePrices>>;
  {
    const GATHER_TIMEOUT = 30000;
    const wrap = <T>(p: Promise<T>, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>(res => setTimeout(() => res(fallback), GATHER_TIMEOUT))]);
    const [ctxR, sectorR, earningsR, pricesR, vixR, cascadeR] = await Promise.all([
      wrap(gatherTabContext(redis, baseUrl), {} as Awaited<ReturnType<typeof gatherTabContext>>),
      wrap(getSectorSummary(baseUrl), ''),
      wrap(getUpcomingEarnings(baseUrl), ''),
      wrap(getLivePrices(), new Map()),
      wrap(getVixContext(baseUrl), ''),
      wrap(getActiveCascadeSignals(baseUrl), ''),
    ]);
    ctx = ctxR; sectorPe = sectorR; earnings = earningsR;
    livePrices = pricesR; vixCtx = vixR; activeCascades = cascadeR;
    logger.info('api.investment-strategy', 'ctx_gathered', { locale,
      ctxKeys: Object.keys(ctx).length,
      prices: livePrices.size,
      sectorPe: sectorPe.length,
      earnings: earnings.length,
      vixCtx: vixCtx.length,
      activeCascades: activeCascades.length,
    });
  }

  const dataAsOf = new Date().toISOString();
  const ctxSummary = buildCtxSummary(ctx);
  const priceData = pricesSection(livePrices);

  logger.info('api.investment-strategy', 'ctx_summary', { locale,
    macro: ctxSummary.macro?.length ?? 0,
    sentiment: ctxSummary.sentiment?.length ?? 0,
    flows: ctxSummary.flows?.length ?? 0,
    news: ctxSummary.news?.length ?? 0,
    koreaFlow: ctxSummary.koreaFlow?.length ?? 0,
    institutional: ctxSummary.institutional?.length ?? 0,
    shorts: ctxSummary.shorts?.length ?? 0,
    cot: ctxSummary.cot?.length ?? 0,
    credit: ctxSummary.credit?.length ?? 0,
    nport: ctxSummary.nport?.length ?? 0,
    optionsFlow: ctxSummary.optionsFlow?.length ?? 0,
    ownership: ctxSummary.ownership?.length ?? 0,
    econCal: ctxSummary.econCal?.length ?? 0,
    commodity: ctxSummary.commodity?.length ?? 0,
    assetFg: ctxSummary.assetFg?.length ?? 0,
    bbWarnings: ctxSummary.bbWarnings?.length ?? 0,
    priceData: priceData.length,
  });

  // ── 3섹션 병렬 AI 호출 ──────────────────────────────────────────────────────
  // activeCascades: 리더 1W ±5% 이상 시 팔로워 추천 신호 — flows + news에 주입
  const cascadeCtx = activeCascades
    ? `\n[ACTIVE CASCADE SIGNALS — 공급망 연쇄 움직임 감지]\n${activeCascades}`
    : '';

  const ctxForPrompts: CtxForPrompts = {
    macro: ctxSummary.macro, sentiment: ctxSummary.sentiment,
    flows: ctxSummary.flows + cascadeCtx,   // cascade 신호 → 자금흐름 컨텍스트에 추가
    cot: ctxSummary.cot, commodity: ctxSummary.commodity, institutional: ctxSummary.institutional,
    shorts: ctxSummary.shorts,
    news: ctxSummary.news + (activeCascades ? `\n[공급망 cascade 활성]\n${activeCascades}` : ''),
    koreaFlow: ctxSummary.koreaFlow,
    assetFg: ctxSummary.assetFg, bbWarnings: ctxSummary.bbWarnings,
    credit: ctxSummary.credit, nport: ctxSummary.nport,
    optionsFlow: ctxSummary.optionsFlow, ownership: ctxSummary.ownership,
    econCal: ctxSummary.econCal,
  };

  // maxDuration 300s (vercel.json) — 타임아웃 여유 확보
  const aiOpts = { tag: 'investment-strategy', skipVllm: true, skipGroq: false, temperature: 0.7, timeoutMs: 40000 };
  const parseSec = (raw: string) => { try { const m = raw.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } };

  // 과거 예측 회고 교훈 (S2: 전술적, S7: 전략적)
  const [retroS2, retroS7] = redis
    ? await Promise.allSettled([getRetrospectiveForS2(redis), getRetrospectiveForS7(redis)])
        .then(r => [
          r[0].status==='fulfilled' ? r[0].value : '',
          r[1].status==='fulfilled' ? r[1].value : '',
        ])
    : ['', ''];
  // S2 전술 교훈 주입 (entry/target calibration)
  const ctxWithRetro: CtxForPrompts = retroS2
    ? { ...ctxForPrompts, news: `${ctxForPrompts.news}\n${retroS2}` }
    : ctxForPrompts;

  // ── Wave 1: 5섹션 병렬 (서로 독립적) ───────────────────────────────────────
  const [macroResult, portfolioResult, regionalResult, opportunityResult, narrativeResult] = await Promise.all([
    callAIProvider(buildMacroPrompt(ctxForPrompts, vixCtx, locale, session),               { ...aiOpts, tag: 'invest-macro',      maxTokens: 800 }),
    callAIProvider(buildPortfolioPrompt(ctxWithRetro, sectorPe, earnings, priceData, locale), { ...aiOpts, tag: 'invest-portfolio', maxTokens: 1000 }),
    callAIProvider(buildRegionalPrompt(ctxForPrompts, locale),                              { ...aiOpts, tag: 'invest-regional',   maxTokens: 700 }),
    callAIProvider(buildOpportunityPrompt(ctxForPrompts, locale),                           { ...aiOpts, tag: 'invest-opportunity',maxTokens: 500 }),
    callAIProvider(buildNarrativePrompt(ctxForPrompts, session, locale),                    { ...aiOpts, tag: 'invest-narrative',  maxTokens: 500 }),
  ]);

  const macroData      = parseSec(macroResult.text);
  const portfolioData  = parseSec(portfolioResult.text);
  const regionalData   = parseSec(regionalResult.text);
  const opportunityData = parseSec(opportunityResult.text);
  const narrativeData  = parseSec(narrativeResult.text);

  logger.info('api.investment-strategy', 'wave1_results', { locale,
    macro:       { source: macroResult.source,       ok: !!macroData,       riskLevel: macroData?.riskLevel,        riskEvents: (macroData?.riskEvents as unknown[])?.length ?? 0 },
    portfolio:   { source: portfolioResult.source,   ok: !!portfolioData,   count: (portfolioData?.portfolio as unknown[])?.length ?? 0,
                   buy: (portfolioData?.portfolio as Array<{action?:string}>|undefined)?.filter(p => p.action==='buy').length ?? 0 },
    regional:    { source: regionalResult.source,    ok: !!regionalData,    regions: Object.keys((regionalData?.regionStances as object|null) ?? {}) },
    opportunity: { source: opportunityResult.source, ok: !!opportunityData, squeeze: (opportunityData?.shortSqueeze as unknown[])?.length ?? 0,
                   insider: (opportunityData?.insiderSignals as unknown[])?.length ?? 0 },
    narrative:   { source: narrativeResult.source,   ok: !!narrativeData },
  });

  // ── Wave 2: S2b 매수종목상세 + S5 리스크관리 + S8 기업변화 (병렬) ─────────────
  let riskData: Record<string, unknown> | null = null;
  let companyChangesData: Record<string, unknown> | null = null;
  let stockDetailMap = new Map<string, { catalysts?: string[]; fundamentalBasis?: string; technicalBasis?: string; riskNote?: string }>();

  if (portfolioData?.portfolio?.length) {
    const portfolioTickers = (portfolioData.portfolio as Array<{ ticker: string; name?: string }>).map(p => p.ticker);
    const buyStocksForLog = (portfolioData.portfolio as Array<{action?:string; ticker:string}>).filter(p => p.action === 'buy').map(p => p.ticker);
    logger.info('api.investment-strategy', 'wave2_start', { locale,
      portfolioCount: portfolioTickers.length,
      buyTickers: buyStocksForLog,
      hasBuyStocks: buyStocksForLog.length > 0,
    });
    const companyFinancialsSummary = await getCompanyFinancialsSummary(baseUrl, portfolioTickers).catch(() => '');

    // buy 종목만 추출해서 상세분석 인풋 구성
    type PortfolioRaw = { ticker: string; name?: string; sector?: string; rationale?: string; entryZone?: string; target?: string; entryRationale?: string; targetRationale?: string; action?: string };
    const buyStocks = (portfolioData.portfolio as PortfolioRaw[])
      .filter(p => p.action === 'buy')
      .map(p => ({
        ticker: p.ticker,
        name: p.name ?? p.ticker,
        sector: p.sector ?? '',
        rationale: p.rationale ?? '',
        entryZone: p.entryZone ?? '',
        target: p.target ?? '',
        entryRationale: p.entryRationale,
        targetRationale: p.targetRationale,
      }));

    const s8Input: CompanyChangesInput = {
      portfolio: (portfolioData.portfolio as Array<{ ticker: string; name?: string }>).map(p => ({ ticker: p.ticker, name: p.name ?? p.ticker })),
      earnings,
      institutional: ctxSummary.institutional,
      news: ctxSummary.news,
      companyFinancials: companyFinancialsSummary,
    };

    const stockDetailInput: StockDetailInput = {
      buyStocks,
      institutional: ctxSummary.institutional,
      shorts: ctxSummary.shorts,
      earnings,
      sectorPe,
      news: ctxSummary.news,
    };

    const wave2Calls: Promise<{ text: string; source: string }>[] = [
      callAIProvider(buildRiskMgmtPrompt({
        portfolio: (portfolioData.portfolio as Array<{ ticker: string; entryZone: string; stopLoss: string; allocation: number; action: string }>),
        riskLevel: macroData?.riskLevel ?? 'medium',
        bbWarnings: ctxSummary.bbWarnings,
        vix: vixCtx,
      }, locale), { ...aiOpts, tag: 'invest-risk', maxTokens: 600 }),
      callAIProvider(buildCompanyChangesPrompt(s8Input, locale), { ...aiOpts, tag: 'invest-s8', maxTokens: 800 }),
    ];
    // buy 종목 있을 때만 상세분석 호출
    if (buyStocks.length > 0) {
      wave2Calls.push(
        callAIProvider(buildStockDetailPrompt(stockDetailInput, locale), { ...aiOpts, tag: 'invest-stock-detail', maxTokens: 900 }),
      );
    }

    const [riskResult, companyChangesResult, stockDetailResult] = await Promise.all(wave2Calls);
    riskData = parseSec(riskResult.text);
    companyChangesData = parseSec(companyChangesResult.text);

    if (stockDetailResult) {
      const stockDetailData = parseSec(stockDetailResult.text);
      if (Array.isArray(stockDetailData?.stockDetails)) {
        for (const d of stockDetailData.stockDetails as Array<{ ticker: string; catalysts?: string[]; fundamentalBasis?: string; technicalBasis?: string; riskNote?: string }>) {
          if (d.ticker) stockDetailMap.set(d.ticker.toUpperCase(), d);
        }
      }
    }

    logger.info('api.investment-strategy', 'wave2_results', { locale,
      risk:          { source: riskResult.source,          ok: !!riskData,          hasStopLoss: !!(riskData?.stopLossRationale), hasHedging: !!(riskData?.hedgingSuggestion) },
      companyChange: { source: companyChangesResult.source, ok: !!companyChangesData, count: (companyChangesData?.companyChanges as unknown[])?.length ?? 0 },
      stockDetail:   stockDetailResult ? { source: stockDetailResult.source, tickerCount: stockDetailMap.size } : null,
    });
  } else {
    logger.warn('api.investment-strategy', 'wave2_skipped', { locale,
      reason: portfolioData ? 'empty_portfolio' : 'portfolio_parse_failed',
      portfolioSource: portfolioResult.source,
      portfolioRaw: portfolioResult.text.slice(0, 120),
    });
    await appendErrorLog(redis, 'wave2_skipped', { reason: portfolioData ? 'empty_portfolio' : 'portfolio_parse_failed', source: portfolioResult.source }, locale, session);
  }


  // fallback source 결정
  const bestSource = [macroResult, portfolioResult, regionalResult, opportunityResult, narrativeResult]
    .find(r => r.source !== 'fallback')?.source ?? 'fallback';

  // ── 7섹션 + 상세분석 조합 ─────────────────────────────────────────────────────
  // stockDetailMap: Wave2에서 생성된 buy종목 상세분석을 portfolio에 병합
  const mergeStockDetail = (portfolio: PortfolioItem[]): PortfolioItem[] =>
    portfolio.map(p => {
      const detail = stockDetailMap.get(p.ticker.toUpperCase());
      if (!detail) return p;
      return {
        ...p,
        catalysts: detail.catalysts?.length ? detail.catalysts : p.catalysts,
        fundamentalBasis: detail.fundamentalBasis || p.fundamentalBasis,
        technicalBasis: detail.technicalBasis || p.technicalBasis,
        riskNote: detail.riskNote || p.riskNote,
      };
    });

  const combinedStrategy: InvestmentStrategy | null = portfolioData?.portfolio ? {
    stance: portfolioData.stance ?? 'neutral',
    thesis: macroData?.thesis ?? '데이터 기반 배분',
    portfolio: mergeStockDetail(portfolioData.portfolio ?? []),
    sectorAllocation: portfolioData.sectorAllocation ?? [],
    riskEvents: macroData?.riskEvents ?? [],
    macroAnalysis: macroData?.macroAnalysis ?? '',
    technicalAnalysis: macroData?.technicalAnalysis ?? '',
    fundamentalAnalysis: macroData?.fundamentalAnalysis ?? '',
    riskLevel: macroData?.riskLevel ?? 'medium',
    regionStances: regionalData?.regionStances ?? undefined,
    // S4: 기회 신호
    shortSqueeze: opportunityData?.shortSqueeze ?? undefined,
    insiderSignals: opportunityData?.insiderSignals ?? undefined,
    topOpportunity: opportunityData?.topOpportunity ?? undefined,
    // S5: 리스크 관리
    stopLossRationale: riskData?.stopLossRationale as InvestmentStrategy['stopLossRationale'] ?? undefined,
    hedgingSuggestion: riskData?.hedgingSuggestion as string ?? undefined,
    portfolioRiskNote: riskData?.portfolioRiskNote as string ?? undefined,
    // S6: 시장 내러티브
    marketNarrative: narrativeData ?? undefined,
    // S8: 기업 변화
    companyChanges: companyChangesData?.companyChanges as InvestmentStrategy['companyChanges'] ?? undefined,
    generatedAt: dataAsOf,
    dataAsOf,
    source: bestSource,
  } : null;

  // combined 실패 시 단일 프롬프트 폴백 (기존 방식)
  const singlePrompt = combinedStrategy ? null : buildInvestmentPrompt(ctxSummary, sectorPe, earnings, livePrices, vixCtx, locale, session);
  // Wave 1 실패 후 singleResult — 이미 실패한 GROQ 건너뜀 (skipGroq: true)
  const singleResult = singlePrompt ? await callAIProvider(singlePrompt, { ...aiOpts, skipGroq: true, maxTokens: 1400 }) : null;

  let strategy: InvestmentStrategy | null = combinedStrategy ?? (singleResult ? parseStrategy(singleResult.text, singleResult.source) : null);

  logger.info('api.investment-strategy', 'merge_result', { locale,
    usedCombined: !!combinedStrategy,
    usedSingle: !combinedStrategy && !!singleResult,
    singleSource: singleResult?.source ?? null,
    hasStrategy: !!strategy,
    source: strategy?.source ?? null,
    sections: strategy ? {
      portfolio: strategy.portfolio?.length ?? 0,
      sectorAllocation: strategy.sectorAllocation?.length ?? 0,
      riskEvents: strategy.riskEvents?.length ?? 0,
      regionStances: Object.keys(strategy.regionStances ?? {}),
      shortSqueeze: strategy.shortSqueeze?.length ?? 0,
      insiderSignals: strategy.insiderSignals?.length ?? 0,
      hasRiskMgmt: !!(strategy.stopLossRationale?.length || strategy.hedgingSuggestion),
      hasNarrative: !!strategy.marketNarrative,
      companyChanges: strategy.companyChanges?.length ?? 0,
    } : null,
  });

  // ── 후처리: portfolio dedup + 유효하지 않은 티커 필터 ──────────────────────────
  // 거래 불가 티커: 인덱스(^KS11=KOSPI, ^N225=Nikkei, ^GSPC=S&P500 등), 빈 값
  // 거래 불가 티커: 인덱스, 약자(KS=Korea Stock?), 유효하지 않은 단일문자
  const INDEX_TICKERS = new Set([
    '^KS11','^N225','^GSPC','^DJI','^IXIC','KOSPI','NIKKEI','KOSDAQ','^KQ11',
    'KS','KR','JP','CN','EU','US','UK',  // 국가 약자 오류 방지
    // 한국 주요 지수명 (AI가 개별주로 착각하는 경우 방지)
    'KOSPI200','KOSPI100','KOSPI50','KOSDAQ150','KRX300',
    // 글로벌 지수 약자
    'SPX','NDX','RUT','DAX','FTSE','HSI','N225','SENSEX',
  ]);
  // 한국 주식 6자리 숫자 티커 → .KS 자동 보정 (AI가 005930 대신 005930.KS 형식 필요)
  const KR_NUM_REGEX = /^\d{6}$/;
  if (strategy?.portfolio?.length) {
    const beforeDedup = strategy.portfolio.length;
    const krFixed: string[] = [];
    strategy.portfolio = strategy.portfolio.map(p => {
      const fixed = KR_NUM_REGEX.test(p.ticker ?? '') ? `${p.ticker}.KS` : (p.ticker ?? '');
      if (fixed !== p.ticker) krFixed.push(`${p.ticker}→${fixed}`);
      return { ...p, ticker: fixed };
    });
    const dedupMap = new Map<string, typeof strategy.portfolio[0]>();
    const indexRemoved: string[] = [];
    for (const p of strategy.portfolio) {
      const key = p.ticker?.toUpperCase();
      if (!key || INDEX_TICKERS.has(key)) { indexRemoved.push(p.ticker); continue; }
      const existing = dedupMap.get(key);
      if (!existing || (p.allocation ?? 0) > (existing.allocation ?? 0)) dedupMap.set(key, p);
    }
    // allocation 합계 100 재조정
    const items = Array.from(dedupMap.values());
    const total = items.reduce((s, p) => s + (p.allocation ?? 0), 0);
    let allocationAdjusted = false;
    if (total > 0 && Math.abs(total - 100) > 2) {
      items.forEach(p => { p.allocation = Math.round((p.allocation ?? 0) / total * 100); });
      const diff = 100 - items.reduce((s, p) => s + p.allocation, 0);
      if (diff !== 0 && items.length) items[0].allocation += diff;
      allocationAdjusted = true;
    }
    strategy = { ...strategy, portfolio: items };
    logger.info('api.investment-strategy', 'postprocess_portfolio', { locale,
      before: beforeDedup, after: items.length,
      krFixed, indexRemoved, allocationAdjusted, totalAfter: items.reduce((s, p) => s + p.allocation, 0),
      tickers: items.map(p => `${p.ticker}(${p.action ?? 'hold'},${p.allocation}%)`),
    });
  }

  // ── Section 4: Karpathy Loop — Critic (Draft → Critique → Refine) ─────────
  // AutoResearch "val_bpb 평가 후 커밋/리버트" 개념을 투자에 적용:
  // AI가 자신의 Draft 포트폴리오를 반박 → REVISE/WARN → 반영
  // D3 FIX: gate on strategy.source (covers both combinedStrategy + singleResult paths)
  if (strategy && strategy.portfolio?.length > 0 && strategy.source !== 'fallback' && strategy.source !== '데이터 기반 모델') {
    logger.info('api.investment-strategy', 'critic_gate_pass', { locale, source: strategy.source, portfolioCount: strategy.portfolio.length });
    try {
      // Critic에 S4 기회신호 요약 추가 (Codex 권장: ~150 tokens, 상위 2개만)
      const s4Summary = strategy.shortSqueeze?.slice(0, 2)
        .map(s => `${s.ticker}:squeeze${s.score}(${s.timing})`).join(', ') ?? '';
      const critiqueInput: CritiqueInput = {
        portfolio: strategy.portfolio.map(p => ({
          ticker: p.ticker,
          rationale: p.rationale ?? '',
          action: (p.action as string) || 'hold',
          entryZone: p.entryZone ?? '',
          target: p.target ?? '',
        })),
        macroAnalysis: strategy.macroAnalysis ?? '',
        bbWarnings: ctxSummary.bbWarnings + (s4Summary ? ` | S4기회:${s4Summary}` : '') + (retroS7 ? `\n${retroS7}` : ''),
        assetFg: ctxSummary.assetFg,
      };
      const critiqueResult = await callAIProvider(
        buildCritiquePrompt(critiqueInput, locale),
        { tag: 'invest-critic', skipVllm: true, maxTokens: 600, temperature: 0.4, timeoutMs: 25000 },
      );
      if (critiqueResult.text && critiqueResult.source !== 'fallback') {
        const refinedPortfolio = applyCritique(critiqueInput.portfolio, critiqueResult.text);
        const actionChanges = refinedPortfolio
          .map((r, i) => ({ ticker: r.ticker, before: (critiqueInput.portfolio[i]?.action ?? 'hold'), after: r.action }))
          .filter(c => c.before !== c.after);
        strategy = {
          ...strategy,
          portfolio: strategy.portfolio.map((p, i) => ({
            ...p,
            action: ((refinedPortfolio[i]?.action ?? p.action) || 'hold') as 'buy' | 'hold' | 'watch',
            rationale: refinedPortfolio[i]?.rationale ?? p.rationale,
          })),
        };
        logger.info('api.investment-strategy', 'critic_applied', { locale, source: critiqueResult.source, actionChanges, changedCount: actionChanges.length });
      } else {
        logger.warn('api.investment-strategy', 'critic_no_change', { locale, source: critiqueResult.source, hasText: !!critiqueResult.text });
      }
    } catch (e) { logger.warn('api.investment-strategy', 'critic_failed', { locale, error: String(e) }); }
  } else if (strategy) {
    logger.warn('api.investment-strategy', 'critic_gate_blocked', { locale,
      source: strategy.source, portfolioCount: strategy.portfolio?.length ?? 0,
      reason: strategy.source === 'fallback' ? 'fallback_source' : strategy.source === '데이터 기반 모델' ? 'data_model_source' : 'empty_portfolio',
    });
  }

  if (!strategy) {
    logger.warn('api.investment-strategy', 'parse_failed', { locale,
      sources: [macroResult.source, portfolioResult.source, regionalResult.source],
      singleSource: singleResult?.source,
    });

    // Try last known good result before serving generic fallback
    if (redis) {
      try {
        const stale = await redis.get(staleKey(locale));
        if (stale && isSchemaCompatible(stale)) {
          logger.info('api.investment-strategy', 'stale_cache_served', { locale });
          return NextResponse.json({ ...(stale as object), cached: true, stale: true }, { headers: CDN_HEADERS });
        }
      } catch { /* ignore */ }
    }

    strategy = dataFallbackStrategy(ctx, locale, livePrices);
  }

  if (strategy && !strategy.dataAsOf) strategy = { ...strategy, dataAsOf };

  // Inject current live prices (only if not already set by dataFallbackStrategy)
  if (strategy) {
    strategy = {
      ...strategy,
      portfolio: strategy.portfolio.map(p => ({
        ...p,
        currentPrice: p.currentPrice ?? livePrices.get(p.ticker)?.price,
        rationale: p.rationale ? p.rationale.slice(0, 100) : p.rationale, // D2: truncate
      })),
    };
  }

  // ── Quality gate: garbage AI output 탐지 후 해당 필드만 제거 ──────────────
  // 소형 모델(qwen3:8b 등)이 프롬프트 구분자를 모방해 "AI+AI+AI" 또는
  // "버핏FCF수익률+린치PEG<1" 같은 프롬프트 에코를 생성할 때 Redis 오염 방지.
  // garbageStrippedMajor: thesis/macro garbage → isFallback 처리 → quarantine + stale 서빙
  let garbageStrippedMajor = false;
  {
    const thesisGarbage      = isGarbageText(strategy.thesis,              GARBAGE_MIN_LEN.thesis);
    const macroGarbage       = isGarbageText(strategy.macroAnalysis,       GARBAGE_MIN_LEN.macroAnalysis);
    const technicalGarbage   = isGarbageText(strategy.technicalAnalysis,   GARBAGE_MIN_LEN.technicalAnalysis);
    const fundamentalGarbage = isGarbageText(strategy.fundamentalAnalysis, GARBAGE_MIN_LEN.fundamentalAnalysis);
    const narrativeGarbage   = strategy.marketNarrative != null && (
      isGarbageText(strategy.marketNarrative.why, GARBAGE_MIN_LEN.narrative) ||
      isGarbageText(strategy.marketNarrative.story, GARBAGE_MIN_LEN.narrative)
    );
    const anyGarbage = thesisGarbage || macroGarbage || technicalGarbage || fundamentalGarbage || narrativeGarbage;
    garbageStrippedMajor = anyGarbage && (thesisGarbage || macroGarbage);
    if (anyGarbage) {
      logger.warn('api.investment-strategy', 'quality_gate_failed', { locale,
        thesisGarbage, macroGarbage, technicalGarbage, fundamentalGarbage, narrativeGarbage,
        garbageStrippedMajor,
        thesis: strategy.thesis?.slice(0, 60),
        macro: strategy.macroAnalysis?.slice(0, 60),
        technical: strategy.technicalAnalysis?.slice(0, 60),
        fundamental: strategy.fundamentalAnalysis?.slice(0, 60),
        source: strategy.source,
        note: garbageStrippedMajor ? 'MAJOR_GARBAGE → short TTL, stale key protected' : 'minor garbage stripped',
      });
      await appendErrorLog(redis, 'quality_gate_failed', { source: strategy.source, thesisGarbage, macroGarbage, garbageStrippedMajor }, locale, session);
      strategy = {
        ...strategy,
        ...(thesisGarbage ? { thesis: undefined } : {}),
        ...(macroGarbage ? { macroAnalysis: '' } : {}),
        ...(technicalGarbage ? { technicalAnalysis: '' } : {}),
        ...(fundamentalGarbage ? { fundamentalAnalysis: '' } : {}),
        ...(narrativeGarbage ? { marketNarrative: undefined } : {}),
      };
    } else {
      logger.info('api.investment-strategy', 'quality_gate_passed', { locale, source: strategy.source });
    }
  }

  // ── Source allowlist — 공유 모듈(strategy-quality.ts)로 중앙화 ──
  // ex: 'local-ollama/qwen3:8b' → isKnownSource=false → quarantine + stale 서빙
  const isUnknownSource = !isKnownSource(strategy.source);
  if (isUnknownSource) {
    logger.warn('api.investment-strategy', 'unknown_source_detected', { locale,
      source: strategy.source,
      note: 'not in ALLOWED_SOURCES (strategy-quality.ts) — likely old deployment → quarantine, stale served',
    });
    await appendErrorLog(redis, 'unknown_source_detected', { source: strategy.source }, locale, session);
  }

  // 0-100 품질 점수: 섹션 완성도 기반 (로그 전용, 응답에 포함 안 함)
  const qualityScore = (() => {
    let s = 0;
    if ((strategy.thesis?.length ?? 0) >= 25)             s += 15;
    if ((strategy.macroAnalysis?.length ?? 0) >= 30)      s += 15;
    if ((strategy.technicalAnalysis?.length ?? 0) >= 15)  s += 10;
    if ((strategy.fundamentalAnalysis?.length ?? 0) >= 15)s += 10;
    if ((strategy.portfolio?.length ?? 0) >= 2)            s += 15;
    if ((strategy.riskEvents?.length ?? 0) >= 1)           s += 5;
    if (Object.keys(strategy.regionStances ?? {}).length >= 2) s += 5;
    if ((strategy.shortSqueeze?.length ?? 0) >= 1)         s += 5;
    if ((strategy.insiderSignals?.length ?? 0) >= 1)       s += 3;
    if ((strategy.stopLossRationale?.length ?? 0) >= 1)    s += 5;
    if (strategy.marketNarrative?.why || strategy.marketNarrative?.story) s += 5;
    if ((strategy.companyChanges?.length ?? 0) >= 1)       s += 7;
    return s;
  })();

  // ── 최종 보고서 섹션 완성도 요약 ──────────────────────────────────────────────
  logger.info('api.investment-strategy', 'report_final_summary', { locale,
    session, source: strategy.source, qualityScore,
    sections: {
      stance:           strategy.stance,
      thesis:           { ok: !!(strategy.thesis), len: strategy.thesis?.length ?? 0 },
      macroAnalysis:    { ok: !!(strategy.macroAnalysis), len: strategy.macroAnalysis?.length ?? 0 },
      technicalAnalysis:{ ok: !!(strategy.technicalAnalysis) },
      fundamental:      { ok: !!(strategy.fundamentalAnalysis) },
      riskLevel:        strategy.riskLevel,
      riskEvents:       strategy.riskEvents?.length ?? 0,
      portfolio:        { count: strategy.portfolio?.length ?? 0, tickers: strategy.portfolio?.map(p => p.ticker) ?? [] },
      sectorAlloc:      strategy.sectorAllocation?.length ?? 0,
      regionStances:    Object.keys(strategy.regionStances ?? {}),
      shortSqueeze:     strategy.shortSqueeze?.length ?? 0,
      insiderSignals:   strategy.insiderSignals?.length ?? 0,
      topOpportunity:   !!(strategy.topOpportunity),
      stopLossRationale:strategy.stopLossRationale?.length ?? 0,
      hedgingSuggestion:!!(strategy.hedgingSuggestion),
      portfolioRiskNote:!!(strategy.portfolioRiskNote),
      marketNarrative:  !!(strategy.marketNarrative),
      companyChanges:   strategy.companyChanges?.length ?? 0,
    },
  });

  // isFallback: source 이름과 무관하게 7섹션 필드 없으면 fallback으로 판단
  // → 데이터 기반 fallback이 stale 키를 덮어쓰는 것 방지 (기존 좋은 stale 보존)
  // → garbage 주요 필드 제거된 보고서: 1h TTL, stale 보호
  // → 알 수 없는 source(구버전 배포): 1h TTL, stale 보호
  const isFallback = strategy.source === 'fallback'
    || strategy.source === '데이터 기반 모델'
    || !isSchemaCompatible(strategy as unknown as Record<string, unknown>)
    || garbageStrippedMajor   // thesis/macro garbage → 1h TTL
    || isUnknownSource;       // 구버전 provider → 1h TTL
  const cacheable = toCacheable(strategy);
  if (redis) {
    try {
      const isQuarantined = garbageStrippedMajor || isUnknownSource;
      if (isQuarantined) {
        // Garbage/unknown-source 보고서: 세션 키에 저장 안 함 → 사용자는 stale(정상 보고서) 수신
        // quarantine 키에만 포렌식 보존 (24h)
        const quarantineKey = `flowvium:investment-strategy:quarantine:${key.split(':').slice(-2).join(':')}`;
        await loggedRedisSet(redis, 'api.investment-strategy', quarantineKey, cacheable, { ex: 24 * 60 * 60 });
        logger.warn('api.investment-strategy', 'quarantined', { locale,
          quarantineKey, garbageStrippedMajor, isUnknownSource, source: strategy.source,
          note: 'session key NOT written — users will receive stale report',
        });
      } else if (isFallback) {
        // data-based fallback: 2h TTL (크론이 곧 재생성)
        await loggedRedisSet(redis, 'api.investment-strategy', key, cacheable, { ex: 2 * 60 * 60 });
      } else {
        // 정상 AI 보고서: 24h TTL
        await loggedRedisSet(redis, 'api.investment-strategy', key, cacheable, { ex: CACHE_TTL });
        // stale 키는 정상 AI 보고서만 갱신
        await loggedRedisSet(redis, 'api.investment-strategy', staleKey(locale), cacheable, { ex: 7 * 24 * 60 * 60 });
      }
    } catch (e) { logger.warn('api.investment-strategy', 'cache_write_error', { locale, error: e }); }

    // History — 전용 90일 키에 full report 저장 (session TTL 키 만료 시에도 히스토리 유지)
    try {
      const HIST_KEY = 'flowvium:investment-strategy:history:arr:v1';
      const HIST_REPORT_TTL = 90 * 86400; // 90일
      const kstDateHist = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
      // 전용 히스토리 리포트 키 (session 키와 별도, 90일 TTL)
      const histReportKey = `flowvium:investment-strategy:hist:report:${strategy.generatedAt}`;
      // Always write to in-process memory cache first — survives Upstash daily command limit exhaustion
      memSetReport(histReportKey, cacheable);
      await loggedRedisSet(redis, 'api.investment-strategy', histReportKey, cacheable, { ex: HIST_REPORT_TTL });
      // 히스토리 배열에는 전용 키를 저장 (session TTL 만료와 무관)
      const meta = { key: histReportKey, generatedAt: strategy.generatedAt, session, kstDate: kstDateHist, stance: strategy.stance, thesis: (strategy.thesis ?? '').slice(0, 80), riskLevel: strategy.riskLevel, source: strategy.source, locale };
      const raw = await redis.get(HIST_KEY);
      const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const arr = Array.isArray(existing) ? existing : [];
      const cleaned = arr.filter((e: unknown) => e && typeof e === 'object' && (e as Record<string,unknown>).key && (e as Record<string,unknown>).generatedAt);
      const updated = [meta, ...cleaned].slice(0, 30);
      // Merge with any in-memory items not yet persisted to Redis
      const memArr = memGetArray() ?? [];
      const memKeys = new Set(updated.map((e: Record<string,unknown>) => e.key));
      const mergedArr = [...updated, ...memArr.filter(e => !memKeys.has(e.key))].slice(0, 30);
      memSetArray(mergedArr as import('@/app/api/investment-strategy/history/route').HistoryMeta[]);
      await loggedRedisSet(redis, 'api.investment-strategy', HIST_KEY, updated, { ex: HIST_REPORT_TTL });
      logger.info('api.investment-strategy', 'history_saved', { count: updated.length, histReportKey, source: strategy.source });
      // 포트폴리오 예측 회고 로그 (14일 후 평가)
      if (!isFallback && strategy.portfolio?.length) {
        logPortfolioPredictions(redis, strategy.portfolio, strategy.generatedAt).catch(() => {});
        executeReportTrades(redis, strategy.portfolio, strategy.generatedAt.slice(0, 10)).catch(() => {});
      }
    } catch (he) { logger.warn('api.investment-strategy', 'history_save_error', { error: String(he) }); }
  }

  // Module-level memory cache write (no-Redis path)
  if (!redis) {
    const memTtl = isFallback ? 5 * 60_000 : STRATEGY_MEMORY_TTL_MS;
    STRATEGY_MEMORY_CACHE = { data: strategy, expiresAt: Date.now() + memTtl };
    logger.info('api.investment-strategy', 'memory_cache_written', { isFallback });
  }

  // Fallbacks must not be CDN-cached for 24h — AI quota resets daily and users would
  // see stale "quota pending" for the full day. Short 5min CDN TTL allows fast recovery.
  const responseHeaders = isFallback
    ? { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' }
    : CDN_HEADERS;
  return NextResponse.json(strategy, { headers: responseHeaders });
}
