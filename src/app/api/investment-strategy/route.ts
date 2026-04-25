import { logger, loggedRedisSet } from '@/lib/logger';
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createRedis, gatherTabContext } from '@/lib/daily-brief';
import { callAI as callAIProvider } from '@/lib/ai-providers';
export const dynamic = 'force-dynamic';

export const maxDuration = 90;

const CACHE_TTL = 12 * 60 * 60; // 12h Redis
const STALE_KEY_PREFIX = 'flowvium:investment-strategy:stale'; // last known good result
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=1800' };

function cacheKey(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const datehour = kst.toISOString().slice(0, 13).replace('T', ':');
  return `flowvium:investment-strategy:v2:${datehour}`;
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
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0)' },
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
  const results = await Promise.all(CANDIDATE_TICKERS.map(fetchOnePrice));
  return new Map(results.filter((r): r is [string, LivePrice] => r[1] !== null));
}

function pricesSection(prices: Map<string, LivePrice>): string {
  if (prices.size === 0) return '';
  const lines = Array.from(prices.entries()).map(([t, p]) =>
    `${t}: 현재가 $${p.price} (전일비 ${p.change1d > 0 ? '+' : ''}${p.change1d}%, 52w고 $${p.high52w}, 52w저 $${p.low52w})`
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
    const data = await res.json() as { entries?: Array<{ ticker: string; name: string; trailingPE: number | null; ytdReturn: number | null; changePct: number | null }> };
    const entries = data.entries ?? [];
    return entries.slice(0, 8).map(e =>
      `${e.ticker}(${e.name}) P/E=${e.trailingPE?.toFixed(1) ?? 'N/A'} YTD=${e.ytdReturn?.toFixed(1) ?? 'N/A'}% 1d=${e.changePct?.toFixed(2) ?? 'N/A'}%`
    ).join(', ');
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
    const data = await res.json() as { upcoming?: Array<{ ticker: string; date: string; eps?: number | null }> };
    const items = (data.upcoming ?? []).slice(0, 5);
    return items.map(e => `${e.ticker} ${e.date}`).join(', ');
  } catch { return ''; }
}

// ── AI prompt ────────────────────────────────────────────────────────────────
function buildInvestmentPrompt(ctx: ReturnType<typeof buildCtxSummary>, sectorPe: string, earnings: string, prices: Map<string, LivePrice>): string {
  const today = new Date().toISOString().slice(0, 10);
  const priceData = pricesSection(prices);

  return `당신은 퀀트 전략가 겸 포트폴리오 매니저입니다. 오늘(${today}) 실시간 데이터를 바탕으로 향후 4주 최적 투자 전략을 제시하세요.

[실시간 주가 — entryZone/stopLoss/target 계산 시 이 가격 기준으로 작성 필수]
${priceData || '데이터 없음'}

[거시경제]
${ctx.macro}

[시장 심리]
${ctx.sentiment}

[자금 흐름]
${ctx.flows}

[기관 포지션]
${ctx.institutional}

[섹터 밸류에이션]
${sectorPe || '데이터 없음'}

[쇼트 스퀴즈 후보]
${ctx.shorts}

[실적 발표 예정]
${earnings || '없음'}

[뉴스 캐스케이드]
${ctx.news}

위 데이터를 종합해 아래 JSON 형식으로만 응답하세요. 마크다운 없이 순수 JSON만.

중요 규칙:
1. portfolio는 반드시 정확히 5개 또는 6개 종목 (4개 이하 금지)
2. entryZone/stopLoss/target은 위 [실시간 주가] 현재가 기준 실제 달러 범위 (예: 현재가 $850이면 entryZone "$840-855")
3. rationale은 구체적 수치·이유 포함, 반복 문구 금지
4. allocation 합계 = 100

{
  "stance": "bullish|neutral|bearish",
  "thesis": "한 줄 투자 전략 (50자 이내, 구체적 섹터/이벤트 언급)",
  "portfolio": [
    {
      "ticker": "NVDA",
      "name": "엔비디아",
      "sector": "기술",
      "rationale": "AI 가속기 수요 25% QoQ 성장, P/E 35x로 섹터 평균 대비 저평가",
      "allocation": 20,
      "entryZone": "$현재가기준범위",
      "stopLoss": "$현재가-7%",
      "target": "$현재가+15%",
      "confidence": "high"
    }
  ],
  "sectorAllocation": [
    {"sector": "Technology", "pct": 30, "stance": "overweight", "reason": "AI 수요 지속 + 섹터 P/E 35x 적정"}
  ],
  "riskEvents": [
    {"date": "2026-05-07", "event": "FOMC 금리 결정", "impact": "high", "watchFor": "동결 확인 시 성장주 재평가"}
  ],
  "macroAnalysis": "수익률곡선 역전폭·CPI·FOMC 확률 기반 구체적 분석",
  "technicalAnalysis": "주요 지수 MA·RSI·VIX 레벨 기반 분석",
  "fundamentalAnalysis": "섹터 P/E·EPS 성장률·FCF yield 기반 분석",
  "riskLevel": "low|medium|high"
}

portfolio 5~6개, sectorAllocation 5~7개, riskEvents 3~5개. 각 항목 구체적 수치 필수.`;
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
      const yc = (m.yieldCurve as Record<string, unknown> | undefined);
      const cpi = m.cpi as Record<string, unknown> | undefined;
      const gdp = m.gdp as Record<string, unknown> | undefined;
      macro = `수익률곡선=${yc?.inverted ? '역전' : '정상'}(${yc?.spread ?? '?'}bp) CPI=${cpi?.value ?? '?'}% GDP=${gdp?.value ?? '?'}%`;
    }
  } catch { /* ignore */ }

  // Sentiment
  let sentiment = '';
  try {
    const fg = ctx.fearGreed as Record<string, unknown> | null;
    const byCountry = (fg?.byCountry as Array<{ id?: string; score?: number; label?: string }>) ?? [];
    const us = byCountry.find(x => x.id === 'us');
    if (us) sentiment = `F&G(US)=${us.score}(${us.label})`;
    const fed = ctx.fedWatch as Record<string, unknown> | null;
    const meetings = (fed?.meetings as Array<Record<string, unknown>>) ?? [];
    if (meetings.length) {
      const next = meetings[0];
      sentiment += ` FOMC ${next.label} 인하확률=${next.probCut25}%`;
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
    if (top.length) flows = `주간 수익 상위: ${top.join(', ')}`;
    const countries = (cap?.countries as Array<{ name?: string; ret1w?: number }>) ?? [];
    const topCtry = countries.sort((a, b) => (b.ret1w ?? 0) - (a.ret1w ?? 0)).slice(0, 3).map(c => `${c.name}:${c.ret1w?.toFixed(1)}%`);
    if (topCtry.length) flows += ` | 국가: ${topCtry.join(', ')}`;
  } catch { /* ignore */ }

  // Institutional
  let institutional = '';
  try {
    const sigs = ctx.signals ?? [];
    const buys = sigs.filter((s: { action?: string }) => s.action === 'buy' || s.action === 'increased').slice(0, 5).map((s: { ticker?: string; institution?: string; valueM?: number }) => `${s.ticker}(${s.institution} $${s.valueM}M)`);
    if (buys.length) institutional = `13F 매수: ${buys.join(', ')}`;
    const insider = (ctx.insider as Array<Record<string, unknown>>) ?? [];
    if (insider.length) {
      const recent = insider.slice(0, 3).map((i: Record<string, unknown>) => `${i.ticker} ${i.insiderTitle ?? ''} ${i.transactionType}`);
      institutional += ` | 내부자: ${recent.join(', ')}`;
    }
  } catch { /* ignore */ }

  // Shorts
  let shorts = '';
  try {
    const shortData = ctx.short as Record<string, unknown> | null;
    const arr = Array.isArray(shortData) ? shortData as Array<Record<string, unknown>>
      : (shortData?.entries as Array<Record<string, unknown>>) ?? [];
    const squeeze = arr.filter(s => (s.squeezeScore as number) >= 25).slice(0, 3)
      .map(s => `${s.ticker}(스퀴즈${s.squeezeScore}점)`);
    if (squeeze.length) shorts = squeeze.join(', ');
  } catch { /* ignore */ }

  // News
  let news = '';
  try {
    const cascadeArr = (ctx.cascade as Array<Record<string, unknown>>) ?? [];
    const topNews = cascadeArr.slice(0, 3).map(n => `${n.sentiment === 'bullish' ? '호재' : n.sentiment === 'bearish' ? '악재' : '뉴스'}:${(n.title as string)?.slice(0, 40)}`);
    if (topNews.length) news = topNews.join(' | ');
  } catch { /* ignore */ }

  return { macro, sentiment, flows, institutional, shorts, news };
}

// ── Fallback strategy when AI fails ──────────────────────────────────────────
function fallbackStrategy(): InvestmentStrategy {
  return {
    stance: 'neutral',
    thesis: '데이터 수집 중 — 잠시 후 다시 시도해주세요',
    portfolio: [
      { ticker: 'SPY', name: 'S&P 500 ETF', sector: 'Diversified', rationale: '분산 ETF로 기본 포지션 유지', allocation: 30, entryZone: '현재가 ±1%', stopLoss: '-5%', target: '+8%', confidence: 'medium' },
      { ticker: 'QQQ', name: 'Nasdaq 100 ETF', sector: 'Technology', rationale: '기술섹터 분산 접근', allocation: 20, entryZone: '현재가 ±1%', stopLoss: '-7%', target: '+12%', confidence: 'medium' },
    ],
    sectorAllocation: [
      { sector: 'Technology', pct: 25, stance: 'overweight', reason: 'AI 테마 지속' },
      { sector: 'Financials', pct: 20, stance: 'neutral', reason: '금리 환경 안정' },
      { sector: 'Health Care', pct: 15, stance: 'neutral', reason: '방어적 배분' },
      { sector: 'Energy', pct: 15, stance: 'neutral', reason: '지정학 리스크 헤지' },
      { sector: 'Consumer Disc.', pct: 15, stance: 'underweight', reason: '소비 둔화 우려' },
      { sector: 'Cash', pct: 10, stance: 'neutral', reason: '리스크 관리 현금' },
    ],
    riskEvents: [
      { date: '2026-05-07', event: 'FOMC 금리 결정', impact: 'high', watchFor: '동결 vs 인하 시그널 확인' },
      { date: '2026-04-30', event: 'PCE 물가 발표', impact: 'high', watchFor: '3% 이하 유지 여부' },
      { date: '2026-05-02', event: 'NFP 고용 보고서', impact: 'medium', watchFor: '고용 냉각 신호' },
    ],
    macroAnalysis: 'AI 분석 일시 불가. 수익률 곡선·CPI·FOMC 데이터 직접 확인 권장.',
    technicalAnalysis: 'AI 분석 일시 불가. SPY 200일 이동평균선 지지 여부 확인 권장.',
    fundamentalAnalysis: 'AI 분석 일시 불가. 섹터 P/E와 EPS 성장률 비교 권장.',
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
  const [ctx, sectorPe, earnings, livePrices] = await Promise.all([
    gatherTabContext(redis, baseUrl),
    getSectorSummary(baseUrl),
    getUpcomingEarnings(baseUrl),
    getLivePrices(),
  ]);

  const ctxSummary = buildCtxSummary(ctx);
  const prompt = buildInvestmentPrompt(ctxSummary, sectorPe, earnings, livePrices);

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

  return NextResponse.json(strategy, { headers: CDN_HEADERS });
}
