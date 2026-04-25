import { logger, loggedRedisSet } from '@/lib/logger';
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createRedis, gatherTabContext } from '@/lib/daily-brief';
import { callAI as callAIProvider } from '@/lib/ai-providers';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';
export const dynamic = 'force-dynamic';

export const maxDuration = 90;

const CACHE_TTL = 12 * 60 * 60; // 12h Redis
const STALE_KEY_PREFIX = 'flowvium:investment-strategy:stale'; // last known good result
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=1800' };

// Module-level memory cache — without Redis every request triggers a heavy AI call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let STRATEGY_MEMORY_CACHE: { data: any; expiresAt: number } | null = null;
const STRATEGY_MEMORY_TTL_MS = 4 * 60 * 60 * 1000;

function cacheKey(): string {
  const kstDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `flowvium:investment-strategy:v5:${kstDate}`;
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

export interface InvestmentStrategy {
  stance: 'bullish' | 'neutral' | 'bearish';
  thesis: string;
  portfolio: PortfolioItem[];
  sectorAllocation: SectorWeight[];
  riskEvents: RiskEvent[];
  macroAnalysis: string;
  technicalAnalysis: string;
  fundamentalAnalysis: string;
  riskLevel: 'low' | 'medium' | 'high';
  generatedAt: string;
  source: string;
  cached?: boolean;
}

// ── Live price fetcher ────────────────────────────────────────────────────────
interface LivePrice {
  price: number;
  change1d: number;
  high52w: number;
  low52w: number;
}

async function fetchOnePrice(ticker: string): Promise<[string, LivePrice | null]> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
      {
        headers: YAHOO_HEADERS,
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      }
    );
    if (!res.ok) return [ticker, null];
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return [ticker, null];
    const price = meta.regularMarketPrice as number;
    const prev = meta.previousClose as number;
    const change1d = prev ? ((price - prev) / prev) * 100 : 0;
    return [ticker, {
      price: Math.round(price * 100) / 100,
      change1d: Math.round(change1d * 10) / 10,
      high52w: meta.fiftyTwoWeekHigh ?? price * 1.3,
      low52w: meta.fiftyTwoWeekLow ?? price * 0.7,
    }];
  } catch { return [ticker, null]; }
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
            change1d: Math.round((changePct ?? 0) * 10) / 10,
            high52w: (q.fiftyTwoWeekHigh as number | undefined) ?? price * 1.3,
            low52w: (q.fiftyTwoWeekLow as number | undefined) ?? price * 0.7,
          });
        }
        return map;
      }
    }
  } catch { /* fall through to v8 */ }
  const results = await Promise.all(CANDIDATE_TICKERS.map(fetchOnePrice));
  return new Map(results.filter((r): r is [string, LivePrice] => r[1] !== null));
}

function pricesSection(prices: Map<string, LivePrice>): string {
  if (prices.size === 0) return '';
  const lines = Array.from(prices.entries()).map(([t, p]) =>
    `${t}: $${p.price} (1d ${p.change1d > 0 ? '+' : ''}${p.change1d}%, 52wH $${p.high52w}, 52wL $${p.low52w})`
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
function buildInvestmentPrompt(ctx: ReturnType<typeof buildCtxSummary>, sectorPe: string, earnings: string, prices: Map<string, LivePrice>, vix: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const priceData = pricesSection(prices);

  return `You are a quantitative strategist and portfolio manager. Based on real-time data as of ${today}, provide the optimal investment strategy for the next 4 weeks.

[Live Prices — use these as the basis for entryZone/stopLoss/target calculations]
${priceData || 'No data'}

[Macro]
${ctx.macro}

[Market Sentiment]
${ctx.sentiment}

[Volatility]
${vix || 'No data'}

[Capital Flows]
${ctx.flows}

[Institutional Positions]
${ctx.institutional}

[Sector Valuations]
${sectorPe || 'No data'}

[Short Squeeze Candidates]
${ctx.shorts}

[Upcoming Earnings]
${earnings || 'None'}

[News Cascade]
${ctx.news}

Synthesize the above data and respond in the following JSON format only. Pure JSON, no markdown.

Key rules:
1. portfolio must have exactly 5 or 6 positions (minimum 5)
2. entryZone/stopLoss/target must be actual dollar ranges based on the live prices above (e.g., if current price is $850, entryZone "$840-855")
3. rationale must include specific numbers/reasons, no repetitive phrases
4. allocation must sum to 100

{
  "stance": "bullish|neutral|bearish",
  "thesis": "one-line strategy (specific sector/event, max 50 chars)",
  "portfolio": [
    {
      "ticker": "NVDA",
      "name": "NVIDIA",
      "sector": "Technology",
      "rationale": "AI accelerator demand +25% QoQ, P/E 35x below sector average",
      "allocation": 20,
      "entryZone": "$price-based range",
      "stopLoss": "$price-7%",
      "target": "$price+15%",
      "confidence": "high"
    }
  ],
  "sectorAllocation": [
    {"sector": "Technology", "pct": 30, "stance": "overweight", "reason": "AI demand sustained + sector P/E 35x fair"}
  ],
  "riskEvents": [
    {"date": "2026-04-30", "event": "FOMC Rate Decision + PCE", "impact": "high", "watchFor": "25bp cut ~52% probability, Powell guidance on future path"}
  ],
  "macroAnalysis": "Specific analysis based on yield curve spread, CPI, credit spreads (IG/HY OAS), FOMC probabilities",
  "technicalAnalysis": "Analysis based on major index MA, RSI, VIX levels",
  "fundamentalAnalysis": "Analysis based on sector P/E, EPS growth rate, FCF yield",
  "riskLevel": "low|medium|high"
}

portfolio 5-6 items, sectorAllocation 5-7 items, riskEvents 3-5 items. Specific numbers required for each.`;
}

interface CtxSummary {
  macro: string;
  sentiment: string;
  flows: string;
  institutional: string;
  shorts: string;
  news: string;
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
      const parts = [`YieldCurve=${yc?.inverted ? 'inverted' : 'normal'}(${spread != null ? spread.toFixed(0) : '?'}bp)`];
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

  // News — include AI summary + top cascade asset impacts for richer context
  let news = '';
  try {
    const cascadeArr = (ctx.cascade as Array<Record<string, unknown>>) ?? [];
    const topNews = cascadeArr.slice(0, 3).map(n => {
      const sent = n.sentiment === 'bullish' ? '↑' : n.sentiment === 'bearish' ? '↓' : '·';
      const text = ((n.summary as string) || (n.title as string) || '').slice(0, 50);
      const impacts = ((n.cascades as Array<Record<string, unknown>>) ?? [])
        .filter(c => (c.magnitude === 'high' || c.magnitude === 'medium') && c.direction !== 'neutral')
        .slice(0, 2)
        .map(c => `${c.asset}${c.direction === 'positive' ? '↑' : '↓'}`)
        .join(',');
      return impacts ? `${sent}${text}(${impacts})` : `${sent}${text}`;
    });
    if (topNews.length) news = topNews.join(' | ');
  } catch { /* ignore */ }

  return { macro, sentiment, flows, institutional, shorts, news };
}

// ── Fallback strategy when AI fails ──────────────────────────────────────────
function fallbackStrategy(): InvestmentStrategy {
  // Use relative dates so risk events don't show as past events after deployment
  const d = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  return {
    stance: 'neutral',
    thesis: 'AI quota reset pending — diversified ETF allocation',
    portfolio: [
      { ticker: 'SPY', name: 'S&P 500 ETF', sector: 'Diversified', rationale: 'Broad market core — defensive during AI analysis gap', allocation: 35, entryZone: 'market ±1%', stopLoss: '-5%', target: '+8%', confidence: 'medium' },
      { ticker: 'QQQ', name: 'Nasdaq 100 ETF', sector: 'Technology', rationale: 'Tech sector exposure — AI/cloud growth theme', allocation: 25, entryZone: 'market ±1%', stopLoss: '-7%', target: '+12%', confidence: 'medium' },
      { ticker: 'GLD', name: 'Gold ETF', sector: 'Commodities', rationale: 'Safe-haven hedge during macro uncertainty', allocation: 15, entryZone: 'market ±1%', stopLoss: '-4%', target: '+6%', confidence: 'medium' },
      { ticker: 'TLT', name: '20Y Treasury ETF', sector: 'Bonds', rationale: 'Duration play on rate cut expectations', allocation: 15, entryZone: 'market ±1%', stopLoss: '-4%', target: '+5%', confidence: 'low' },
      { ticker: 'CASH', name: 'Cash / T-Bills', sector: 'Cash', rationale: 'Liquidity reserve — 5%+ yield while awaiting signals', allocation: 10, entryZone: '-', stopLoss: '-', target: '+5% annualized', confidence: 'high' },
    ],
    sectorAllocation: [
      { sector: 'Technology', pct: 25, stance: 'overweight', reason: 'AI capex cycle sustained' },
      { sector: 'Financials', pct: 20, stance: 'neutral', reason: 'Rate cut trajectory positive for NIM' },
      { sector: 'Health Care', pct: 15, stance: 'neutral', reason: 'Defensive allocation, stable earnings' },
      { sector: 'Energy', pct: 10, stance: 'underweight', reason: 'Demand uncertainty, geopolitical premium fading' },
      { sector: 'Consumer Disc.', pct: 15, stance: 'underweight', reason: 'Consumer spending slowdown risk' },
      { sector: 'Cash/Bonds', pct: 15, stance: 'overweight', reason: 'Risk management + rate-cut optionality' },
    ],
    riskEvents: [
      { date: d(7), event: 'FOMC Rate Decision', impact: 'high', watchFor: 'Rate cut probability and Powell guidance on future path' },
      { date: d(14), event: 'Non-Farm Payrolls', impact: 'high', watchFor: 'Labor market health and Fed reaction function' },
      { date: d(21), event: 'CPI / Core PCE', impact: 'medium', watchFor: 'Inflation trajectory vs Fed 2% target' },
    ],
    macroAnalysis: 'AI analysis unavailable — check yield curve spread, CPI, and credit spreads (IG/HY OAS) directly. AI quota resets daily at 09:00 KST.',
    technicalAnalysis: 'AI analysis unavailable — monitor SPY 200-day MA support and VIX regime. AI analysis resumes after quota reset.',
    fundamentalAnalysis: 'AI analysis unavailable — compare sector P/E to EPS growth estimates and FCF yield. Live data available in Sector P/E tab.',
    riskLevel: 'medium',
    generatedAt: new Date().toISOString(),
    source: 'fallback',
  };
}

// ── Parse AI response ─────────────────────────────────────────────────────────
function parseStrategy(raw: string, source: string): InvestmentStrategy | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<InvestmentStrategy>;
    if (!parsed.stance || !parsed.thesis || !Array.isArray(parsed.portfolio)) return null;
    return {
      stance: parsed.stance,
      thesis: parsed.thesis,
      portfolio: parsed.portfolio ?? [],
      sectorAllocation: parsed.sectorAllocation ?? [],
      riskEvents: parsed.riskEvents ?? [],
      macroAnalysis: parsed.macroAnalysis ?? '',
      technicalAnalysis: parsed.technicalAnalysis ?? '',
      fundamentalAnalysis: parsed.fundamentalAnalysis ?? '',
      riskLevel: parsed.riskLevel ?? 'medium',
      generatedAt: new Date().toISOString(),
      source,
    };
  } catch { return null; }
}

// ── GET handler ───────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === '1';

  const redis = createRedis();
  const key = cacheKey();

  // Module-level memory cache hit (no-Redis path)
  if (!redis && !force && STRATEGY_MEMORY_CACHE && Date.now() < STRATEGY_MEMORY_CACHE.expiresAt) {
    logger.info('api.investment-strategy', 'memory_cache_hit');
    return NextResponse.json({ ...STRATEGY_MEMORY_CACHE.data, cached: true }, { headers: CDN_HEADERS });
  }

  if (redis && !force) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        logger.info('api.investment-strategy', 'cache_hit');
        return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
      }
    } catch (e) { logger.warn('api.investment-strategy', 'cache_read_error', { error: e }); }
  }

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

  const ctxSummary = buildCtxSummary(ctx);
  const prompt = buildInvestmentPrompt(ctxSummary, sectorPe, earnings, livePrices, vixCtx);

  const aiResult = await callAIProvider(prompt, {
    tag: 'investment-strategy',
    skipVllm: true,
    maxTokens: 2000,
    temperature: 0.55,
    timeoutMs: 45000,
  });
  let strategy = parseStrategy(aiResult.text, aiResult.source);

  if (!strategy) {
    logger.warn('api.investment-strategy', 'parse_failed', {
      raw: aiResult.text.slice(0, 500),
      source: aiResult.source,
      attempts: JSON.stringify(aiResult.attempts ?? []).slice(0, 300),
    });

    // Try last known good result before serving generic fallback
    if (redis) {
      try {
        const stale = await redis.get(STALE_KEY_PREFIX);
        if (stale) {
          logger.info('api.investment-strategy', 'stale_cache_served');
          const isDebug = searchParams.get('debug') === '1';
          return NextResponse.json({
            ...(stale as object),
            cached: true,
            stale: true,
            ...(isDebug ? { _debug: { raw: aiResult.text.slice(0, 1000), source: aiResult.source, attempts: aiResult.attempts } } : {}),
          }, { headers: CDN_HEADERS });
        }
      } catch { /* ignore */ }
    }

    strategy = fallbackStrategy();
    const isDebug = searchParams.get('debug') === '1';
    if (isDebug) {
      return NextResponse.json({
        ...strategy,
        _debug: { raw: aiResult.text.slice(0, 1000), source: aiResult.source, attempts: aiResult.attempts },
      }, { headers: CDN_HEADERS });
    }
  }

  if (redis) {
    try {
      // Write to current key + stale key (no expiry on stale — keeps last good result indefinitely)
      await Promise.all([
        loggedRedisSet(redis, 'api.investment-strategy', key, strategy, { ex: CACHE_TTL }),
        loggedRedisSet(redis, 'api.investment-strategy', STALE_KEY_PREFIX, strategy, { ex: 7 * 24 * 60 * 60 }), // 7d
      ]);
    } catch (e) { logger.warn('api.investment-strategy', 'cache_write_error', { error: e }); }
  }

  // Module-level memory cache write (no-Redis path)
  if (!redis) {
    STRATEGY_MEMORY_CACHE = { data: strategy, expiresAt: Date.now() + STRATEGY_MEMORY_TTL_MS };
    logger.info('api.investment-strategy', 'memory_cache_written');
  }

  return NextResponse.json(strategy, { headers: CDN_HEADERS });
}
