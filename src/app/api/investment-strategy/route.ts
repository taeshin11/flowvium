import { logger, loggedRedisSet } from '@/lib/logger';
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createRedis, gatherTabContext } from '@/lib/daily-brief';
import { callAI as callAIProvider } from '@/lib/ai-providers';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';
import { buildMacroPrompt, buildPortfolioPrompt, buildRegionalPrompt, buildCritiquePrompt, applyCritique } from '@/lib/investment-prompts';
import type { CtxForPrompts, CritiqueInput } from '@/lib/investment-prompts';
export const dynamic = 'force-dynamic';

export const maxDuration = 90;

const CACHE_TTL = 24 * 60 * 60; // 24h Redis
const STALE_KEY_PREFIX = 'flowvium:investment-strategy:stale:v7'; // versioned with cache key schema
// 24h CDN + 2h stale window; daily strategy doesn't need more frequent refresh
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=7200' };

// Module-level memory cache — without Redis every cold start triggers a heavy AI call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let STRATEGY_MEMORY_CACHE: { data: any; expiresAt: number } | null = null;
const STRATEGY_MEMORY_TTL_MS = 23 * 60 * 60 * 1000; // 23h — survive most of the day within one Lambda instance

/** KST 세션 구분:
 *  morning   = 07:00–15:59 KST (미국장 마감 후 분석)
 *  afternoon = 16:00–21:59 KST (아시아장 마감, 유럽장 진행)
 *  evening   = 22:00–06:59 KST (미국장 개장 전후 분석)
 */
function getKstSession(): 'morning' | 'afternoon' | 'evening' {
  const kstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (kstHour >= 7 && kstHour < 16) return 'morning';
  if (kstHour >= 16 && kstHour < 22) return 'afternoon';
  return 'evening';
}

function cacheKey(session?: string): string {
  const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const s = session ?? getKstSession();
  return `flowvium:investment-strategy:v7:${kstDate}:${s}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PortfolioItem {
  ticker: string;
  name: string;
  sector: string;
  rationale: string;
  allocation: number;
  entryZone: string;
  stopLoss: string;
  target: string;
  confidence: 'high' | 'medium' | 'low';
  action?: 'buy' | 'hold' | 'watch';
  currentPrice?: number;
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
  /**
   * Per-country/region outlook.
   * Keys: "us" | "korea" | "japan" | "china" | "europe" | "india" | "taiwan" | "brazil" | "australia" | "global"
   */
  regionStances?: Record<string, RegionStance>;
  portfolio: PortfolioItem[];
  sectorAllocation: SectorWeight[];
  riskEvents: RiskEvent[];
  macroAnalysis: string;
  technicalAnalysis: string;
  fundamentalAnalysis: string;
  riskLevel: 'low' | 'medium' | 'high';
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
        signal: AbortSignal.timeout(4000),
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
  'NVDA', 'MSFT', 'AAPL', 'META', 'GOOGL', 'AMZN', 'TSLA',
  'KLAC', 'AMD', 'JPM', 'V', 'UNH', 'XOM',
  'SPY', 'QQQ', 'GLD', 'TLT', 'USO', 'IWM',
];

async function getLivePrices(): Promise<Map<string, LivePrice>> {
  try {
    const fields = 'regularMarketPrice,regularMarketChangePercent,fiftyTwoWeekHigh,fiftyTwoWeekLow';
    const res = await fetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(CANDIDATE_TICKERS.join(','))}&fields=${fields}`,
      { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000), cache: 'no-store' }
    );
    if (res.ok) {
      const data = await res.json();
      const quotes = (data?.quoteResponse?.result ?? []) as Array<Record<string, unknown>>;
      if (quotes.length > 0) {
        const map = new Map<string, LivePrice>();
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
        return map;
      }
    }
  } catch { /* fall through to v8 / Finnhub */ }
  const results = await Promise.all(CANDIDATE_TICKERS.map(fetchOnePrice));
  return new Map(results.filter((r): r is [string, LivePrice] => r[1] !== null));
}

function pricesSection(prices: Map<string, LivePrice>): string {
  if (prices.size === 0) return '';
  const lines = Array.from(prices.entries()).map(([t, p]) =>
    `${t}: $${p.price} (1d ${p.change1d != null ? `${p.change1d > 0 ? '+' : ''}${p.change1d}%` : 'N/A'}, 52wH $${p.high52w}, 52wL $${p.low52w})`
  );
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
3. entryZone/stopLoss/target: actual $ ranges based on live prices (e.g. price=$209 → entryZone="$205-211")
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

{"stance":"bullish|neutral|bearish","thesis":"≤50 chars","regionStances":{"us":{"stance":"bullish","thesis":"≤40 chars","keyData":"SPY+0.1% 1w, F&G 64, VIX 18.0"},"korea":{"stance":"bullish","thesis":"≤40 chars","keyData":"EWY+1.2% 1w, F&G 77"},"japan":{"stance":"neutral","thesis":"≤40 chars","keyData":"EWJ-1.1% 1w"},"china":{"stance":"neutral","thesis":"≤40 chars","keyData":"FXI-1.7% 1w"},"europe":{"stance":"bearish","thesis":"≤40 chars","keyData":"VGK-2.3% 1w"},"india":{"stance":"neutral","thesis":"≤40 chars","keyData":"INDA-1.9% 1w"},"taiwan":{"stance":"bullish","thesis":"≤40 chars","keyData":"EWT+1.2% 1w"},"brazil":{"stance":"bearish","thesis":"≤40 chars","keyData":"EWZ-4.8% 1w"},"australia":{"stance":"neutral","thesis":"≤40 chars","keyData":"EWA-2.8% 1w"},"global":{"stance":"neutral","thesis":"≤40 chars","keyData":"Mixed signals"}},"portfolio":[{"ticker":"NVDA","name":"NVIDIA","sector":"Technology","market":"us","rationale":"≤60 chars with numbers","allocation":15,"entryZone":"$205-212","stopLoss":"$190","target":"$240","confidence":"high","action":"buy"}],"sectorAllocation":[{"sector":"Technology","pct":25,"stance":"overweight","reason":"≤40 chars"}],"riskEvents":[{"date":"2026-05-01","event":"NFP","impact":"high","watchFor":"≤50 chars"}],"macroAnalysis":"≤150 chars","technicalAnalysis":"≤120 chars","fundamentalAnalysis":"≤120 chars","riskLevel":"low|medium|high"}

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
    const assets = (cap?.assets as Array<{ ticker?: string; ret1w?: number; ret4w?: number }>) ?? [];
    const top = assets.filter(a => a.ticker && typeof a.ret1w === 'number')
      .sort((a, b) => (b.ret1w ?? 0) - (a.ret1w ?? 0))
      .slice(0, 5)
      .map(a => `${a.ticker}:${a.ret1w?.toFixed(1)}%`);
    if (top.length) flows = `Weekly top: ${top.join(', ')}`;
    const cf = cap?.countryFlow as Record<string, unknown> | undefined;
    const countries = (cf?.countries as Array<{ name?: string; label?: string; ret1w?: number }>) ?? [];
    const topCtry = countries.sort((a, b) => (b.ret1w ?? 0) - (a.ret1w ?? 0)).slice(0, 3).map(c => `${c.name ?? c.label}:${c.ret1w?.toFixed(1)}%`);
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
      const clusterMap = new Map<string, { buys: number; sells: number; totalUsd: number }>();
      for (const i of insider) {
        const t = i.ticker as string; if (!t) continue;
        const c = clusterMap.get(t) ?? { buys: 0, sells: 0, totalUsd: 0 };
        if (i.direction === 'buy') c.buys++; else c.sells++;
        c.totalUsd += (i.transactionValueUsd as number) ?? 0;
        clusterMap.set(t, c);
      }
      const hotTickers = Array.from(clusterMap.entries())
        .filter(([, c]) => c.buys + c.sells >= 5)
        .sort((a, b) => (b[1].buys + b[1].sells) - (a[1].buys + a[1].sells))
        .slice(0, 3)
        .map(([t, c]) => `${t}(${c.buys}buy/${c.sells}sell $${Math.round(c.totalUsd / 1000)}K)`);
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
    const squeeze = arr.filter(s => (s.squeezeScore as number) >= 25).slice(0, 3)
      .map(s => `${s.ticker}(squeeze=${s.squeezeScore})`);
    if (squeeze.length) shorts = squeeze.join(', ');
  } catch { /* ignore */ }

  // News — 연준 위원 발언 + 경제지표 발표 + 13F 변화 반영
  let news = '';
  try {
    const cascadeArr = (ctx.cascade as Array<Record<string, unknown>>) ?? [];
    // Prioritize Fed/ECB/macro policy news, then earnings, then general
    const sorted = [...cascadeArr].sort((a, b) => {
      const isFedA = /powell|fomc|fed|ecb|lagarde|monetary|rate/i.test(String(a.title ?? a.summary));
      const isFedB = /powell|fomc|fed|ecb|lagarde|monetary|rate/i.test(String(b.title ?? b.summary));
      return (isFedB ? 1 : 0) - (isFedA ? 1 : 0);
    });
    const topNews = sorted.slice(0, 5).map(n => {
      const sent = n.sentiment === 'bullish' ? '↑' : n.sentiment === 'bearish' ? '↓' : '·';
      const isFed = /powell|fomc|fed|ecb|lagarde|boj|monetary|rate cut|rate hike/i.test(String(n.title ?? n.summary));
      const prefix = isFed ? '[연준/중앙은행]' : '';
      const text = ((n.summary as string) || (n.title as string) || '').slice(0, 60);
      const impacts = ((n.cascades as Array<Record<string, unknown>>) ?? [])
        .filter(c => (c.magnitude === 'high' || c.magnitude === 'medium') && c.direction !== 'neutral')
        .slice(0, 2)
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

  return { macro, sentiment, flows, cot, commodity, institutional, shorts, news, koreaFlow, assetFg, bbWarnings };
}

// ── Event calendar for fallback risk events — mirrors macro-indicators FOMC_DATES_2026 / RELEASE_SCHEDULE ─
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
  let spy = 35, qqq = 25, gld = 15, tlt = 15, cash = 10;

  // Adjustments: risk-off signals → reduce equity, increase defensive
  if (vix > 30 || igSpread > 1.5 || hySpread > 5.5) {
    spy -= 10; qqq -= 5; gld += 5; cash += 10;
  } else if (vix > 22 || igSpread > 1.2) {
    spy -= 5; qqq -= 5; gld += 5; cash += 5;
  }
  if (inverted) {
    tlt -= 10; cash += 10; // Inverted curve = bond duration risk
  }
  if (fgScore > 75) {
    spy -= 5; gld += 5; // Extreme greed = take some off the table
  } else if (fgScore < 25) {
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
  const vixLabel = vix > 30 ? (isKo ? '고변동성' : 'high-vol') : vix > 22 ? (isKo ? '변동성 상승' : 'elevated-vol') : (isKo ? '저변동성' : 'low-vol');
  const fgLabel = fgScore > 75 ? (isKo ? '탐욕 과잉' : 'extreme greed') : fgScore > 55 ? (isKo ? '탐욕' : 'greed') : fgScore > 45 ? (isKo ? '중립' : 'neutral') : fgScore > 25 ? (isKo ? '공포' : 'fear') : (isKo ? '극단적 공포' : 'extreme fear');
  const ycLabel = inverted ? (isKo ? '수익률 곡선 역전' : 'curve inverted') : (spread != null ? (isKo ? `스프레드 ${Math.round(spread * 100)}bp` : `spread ${Math.round(spread * 100)}bp`) : '');
  const conditions = [vixLabel, fgLabel, ycLabel].filter(Boolean).join(' · ');

  const thesis = isKo ? `데이터 기반 배분 — ${conditions}`
    : isJa ? `データ駆動配分 — ${conditions}`
    : isZh ? `数据驱动配置 — ${conditions}`
    : `Data-driven allocation — ${conditions}`;

  const riskLevel: 'low' | 'medium' | 'high' = vix > 28 || fgScore < 25 || igSpread > 1.5 ? 'high' : vix < 18 && fgScore > 55 ? 'low' : 'medium';

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
    const portfolio = (parsed.portfolio as Partial<PortfolioItem>[])
      .filter((p): p is PortfolioItem =>
        typeof p?.ticker === 'string' && p.ticker.length > 0 &&
        typeof p?.allocation === 'number' && p.allocation > 0
      )
      .map(p => ({
        ...p,
        action: (['buy', 'hold', 'watch'] as const).includes(p.action as never) ? p.action : undefined,
      }));
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
  const key = cacheKey(session);

  // Memory cache (no-Redis path)
  if (!redis && STRATEGY_MEMORY_CACHE && Date.now() < STRATEGY_MEMORY_CACHE.expiresAt) {
    return NextResponse.json({ ...STRATEGY_MEMORY_CACHE.data, cached: true }, { headers: CDN_HEADERS });
  }

  if (redis) {
    try {
      // 1. Current session cache
      const cached = await redis.get(key);
      if (cached) {
        logger.info('api.investment-strategy', 'cache_hit', { session });
        return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
      }
      // 2. Stale (last AI-generated report, up to 7 days)
      if (!force) {
        const stale = await redis.get(STALE_KEY_PREFIX);
        if (stale) {
          logger.info('api.investment-strategy', 'stale_hit');
          return NextResponse.json({ ...(stale as object), cached: true, stale: true }, { headers: CDN_HEADERS });
        }
        // 3. Any previous session's report from today or yesterday (A1 fix)
        const yesterday = new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
        for (const dateStr of [new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), yesterday]) {
          for (const s of ['morning', 'afternoon', 'evening'] as const) {
            if (dateStr === new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) && s === session) continue;
            const alt = await redis.get(`flowvium:investment-strategy:v7:${dateStr}:${s}`);
            if (alt) {
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

  // Gather all context in parallel (including live prices)
  const [ctx, sectorPe, earnings, livePrices, vixCtx] = await Promise.all([
    gatherTabContext(redis, baseUrl),
    getSectorSummary(baseUrl),
    getUpcomingEarnings(baseUrl),
    getLivePrices(),
    getVixContext(baseUrl),
  ]);

  const dataAsOf = new Date().toISOString();
  const ctxSummary = buildCtxSummary(ctx);
  const priceData = pricesSection(livePrices);

  // ── 3섹션 병렬 AI 호출 ──────────────────────────────────────────────────────
  const ctxForPrompts: CtxForPrompts = {
    macro: ctxSummary.macro, sentiment: ctxSummary.sentiment, flows: ctxSummary.flows,
    cot: ctxSummary.cot, commodity: ctxSummary.commodity, institutional: ctxSummary.institutional,
    shorts: ctxSummary.shorts, news: ctxSummary.news, koreaFlow: ctxSummary.koreaFlow,
    assetFg: ctxSummary.assetFg, bbWarnings: ctxSummary.bbWarnings,
  };

  const aiOpts = { tag: 'investment-strategy', skipVllm: true, skipGroq: false, maxTokens: 900, temperature: 0.55, timeoutMs: 45000 };

  const [macroResult, portfolioResult, regionalResult] = await Promise.all([
    callAIProvider(buildMacroPrompt(ctxForPrompts, vixCtx, locale, session), { ...aiOpts, tag: 'invest-macro' }),
    callAIProvider(buildPortfolioPrompt(ctxForPrompts, sectorPe, earnings, priceData, locale), { ...aiOpts, tag: 'invest-portfolio' }),
    callAIProvider(buildRegionalPrompt(ctxForPrompts, locale), { ...aiOpts, tag: 'invest-regional' }),
  ]);

  // 3섹션 파싱 후 조합
  const parseMacro = (raw: string) => { try { const m = raw.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } };
  const macroData = parseMacro(macroResult.text);
  const portfolioData = parseMacro(portfolioResult.text);
  const regionalData = parseMacro(regionalResult.text);

  // fallback source 결정 (가장 좋은 provider 우선)
  const bestSource = [macroResult, portfolioResult, regionalResult].find(r => r.source !== 'fallback')?.source ?? 'fallback';

  // 합산된 단일 결과 텍스트로 parseStrategy 우회 후 직접 조합
  const combinedStrategy: InvestmentStrategy | null = portfolioData?.portfolio ? {
    stance: portfolioData.stance ?? 'neutral',
    thesis: macroData?.thesis ?? portfolioData.stance ?? '데이터 기반 배분',
    portfolio: portfolioData.portfolio ?? [],
    sectorAllocation: portfolioData.sectorAllocation ?? [],
    riskEvents: macroData?.riskEvents ?? [],
    macroAnalysis: macroData?.macroAnalysis ?? '',
    technicalAnalysis: macroData?.technicalAnalysis ?? '',
    fundamentalAnalysis: macroData?.fundamentalAnalysis ?? '',
    riskLevel: macroData?.riskLevel ?? 'medium',
    regionStances: regionalData?.regionStances ?? undefined,
    generatedAt: dataAsOf,
    dataAsOf,
    source: bestSource,
  } : null;

  // combined 실패 시 단일 프롬프트 폴백 (기존 방식)
  const singlePrompt = combinedStrategy ? null : buildInvestmentPrompt(ctxSummary, sectorPe, earnings, livePrices, vixCtx, locale, session);
  const singleResult = singlePrompt ? await callAIProvider(singlePrompt, { ...aiOpts, maxTokens: 1400 }) : null;

  let strategy: InvestmentStrategy | null = combinedStrategy ?? (singleResult ? parseStrategy(singleResult.text, singleResult.source) : null);

  // ── Section 4: Karpathy Loop — Critic (Draft → Critique → Refine) ─────────
  // AutoResearch "val_bpb 평가 후 커밋/리버트" 개념을 투자에 적용:
  // AI가 자신의 Draft 포트폴리오를 반박 → REVISE/WARN → 반영
  if (strategy && strategy.portfolio?.length > 0 && bestSource !== 'fallback') {
    try {
      const critiqueInput: CritiqueInput = {
        portfolio: strategy.portfolio.map(p => ({
          ticker: p.ticker,
          rationale: p.rationale ?? '',
          action: (p.action as string) || 'hold',
          entryZone: p.entryZone ?? '',
          target: p.target ?? '',
        })),
        macroAnalysis: strategy.macroAnalysis ?? '',
        bbWarnings: ctxSummary.bbWarnings,
        assetFg: ctxSummary.assetFg,
      };
      const critiqueResult = await callAIProvider(
        buildCritiquePrompt(critiqueInput, locale),
        { tag: 'invest-critic', skipVllm: true, maxTokens: 600, temperature: 0.4, timeoutMs: 30000 },
      );
      if (critiqueResult.text && critiqueResult.source !== 'fallback') {
        const refinedPortfolio = applyCritique(critiqueInput.portfolio, critiqueResult.text);
        strategy = {
          ...strategy,
          portfolio: strategy.portfolio.map((p, i) => ({
            ...p,
            action: ((refinedPortfolio[i]?.action ?? p.action) || 'hold') as 'buy' | 'hold' | 'watch',
            rationale: refinedPortfolio[i]?.rationale ?? p.rationale,
          })),
        };
        logger.info('api.investment-strategy', 'karpathy_critic_applied', { source: critiqueResult.source });
      }
    } catch (e) { logger.warn('api.investment-strategy', 'critic_failed', { error: e }); }
  }

  if (!strategy) {
    logger.warn('api.investment-strategy', 'parse_failed', {
      sources: [macroResult.source, portfolioResult.source, regionalResult.source],
      singleSource: singleResult?.source,
    });

    // Try last known good result before serving generic fallback
    if (redis) {
      try {
        const stale = await redis.get(STALE_KEY_PREFIX);
        if (stale) {
          logger.info('api.investment-strategy', 'stale_cache_served');
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

  const isFallback = strategy.source === 'fallback';
  if (redis) {
    try {
      const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
      const ttl = isFallback ? 2 * 60 * 60 : CACHE_TTL; // Fallback: 2h (was 5min → prevented re-generation too frequently)
      await loggedRedisSet(redis, 'api.investment-strategy', key, strategy, { ex: ttl });
      if (!isFallback) {
        await loggedRedisSet(redis, 'api.investment-strategy', STALE_KEY_PREFIX, strategy, { ex: 7 * 24 * 60 * 60 });
      }
      // History list — AI 생성 리포트만 저장 (fallback은 노이즈)
      if (!isFallback) {
        const meta = { key, generatedAt: strategy.generatedAt, session, kstDate, stance: strategy.stance, thesis: strategy.thesis, riskLevel: strategy.riskLevel, source: strategy.source };
        await redis.lpush('flowvium:investment-strategy:history:v1', JSON.stringify(meta));
        await redis.ltrim('flowvium:investment-strategy:history:v1', 0, 29);
      }
    } catch (e) { logger.warn('api.investment-strategy', 'cache_write_error', { error: e }); }
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
