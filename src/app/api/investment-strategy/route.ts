import { logger, loggedRedisSet } from '@/lib/logger';
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createRedis, gatherTabContext } from '@/lib/daily-brief';
import { callAI as callAIProvider } from '@/lib/ai-providers';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';
export const dynamic = 'force-dynamic';

export const maxDuration = 90;

const CACHE_TTL = 24 * 60 * 60; // 24h Redis
const STALE_KEY_PREFIX = 'flowvium:investment-strategy:stale'; // last known good result
// 24h CDN + 2h stale window; daily strategy doesn't need more frequent refresh
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=7200' };

// Module-level memory cache — without Redis every cold start triggers a heavy AI call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let STRATEGY_MEMORY_CACHE: { data: any; expiresAt: number } | null = null;
const STRATEGY_MEMORY_TTL_MS = 23 * 60 * 60 * 1000; // 23h — survive most of the day within one Lambda instance

function cacheKey(): string {
  const kstDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `flowvium:investment-strategy:v6:${kstDate}`; // v6: don't cache fallbacks for 24h
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
  dataAsOf?: string;
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
        const change1d = prev ? ((price - prev) / prev) * 100 : 0;
        return [ticker, {
          price: Math.round(price * 100) / 100,
          change1d: Math.round(change1d * 10) / 10,
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
            change1d: Math.round((d.dp ?? 0) * 10) / 10,
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
            change1d: Math.round((changePct ?? 0) * 10) / 10,
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
const LOCALE_LANG: Record<string, string> = {
  ko: 'Korean', ja: 'Japanese', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
  es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian',
  ar: 'Arabic', hi: 'Hindi', id: 'Indonesian', th: 'Thai', tr: 'Turkish', vi: 'Vietnamese',
};

function buildInvestmentPrompt(ctx: ReturnType<typeof buildCtxSummary>, sectorPe: string, earnings: string, prices: Map<string, LivePrice>, vix: string, locale = 'en'): string {
  const today = new Date().toISOString().slice(0, 10);
  const priceData = pricesSection(prices);
  const lang = LOCALE_LANG[locale];
  const langInstruction = lang ? `\nIMPORTANT: Write ALL text fields (thesis, rationale, macroAnalysis, technicalAnalysis, fundamentalAnalysis, sectorAllocation.reason, riskEvents.event, riskEvents.watchFor) in ${lang}. Keep ticker symbols and numbers in English/digits.\n` : '';

  return `You are a quantitative strategist and portfolio manager. Based on real-time data as of ${today}, provide the optimal investment strategy for the next 4 weeks.${langInstruction}

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
5. action must be "buy" (actively accumulate now), "hold" (keep if owned), or "watch" (wait for better entry)

{"stance":"bullish|neutral|bearish","thesis":"≤50 chars","portfolio":[{"ticker":"NVDA","name":"NVIDIA","sector":"Technology","rationale":"≤60 chars with numbers","allocation":20,"entryZone":"$840-855","stopLoss":"$780","target":"$950","confidence":"high","action":"buy|hold|watch"}],"sectorAllocation":[{"sector":"Technology","pct":30,"stance":"overweight","reason":"≤40 chars"}],"riskEvents":[{"date":"2026-04-30","event":"FOMC","impact":"high","watchFor":"≤50 chars"}],"macroAnalysis":"≤120 chars","technicalAnalysis":"≤120 chars","fundamentalAnalysis":"≤120 chars","riskLevel":"low|medium|high"}

portfolio exactly 5 items, sectorAllocation 5 items, riskEvents 3 items. Pure JSON, no markdown.`;
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

// ── Event calendar for fallback risk events — mirrors macro-indicators FOMC_DATES_2026 / RELEASE_SCHEDULE ─
const FALLBACK_FOMC_DATES = ['2026-04-30','2026-06-17','2026-07-29','2026-09-16','2026-10-28','2026-12-09'];
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
    fomcWatch: isKo ? '금리 인하 확률 및 파월 의장의 향후 경로 발언'
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
    fundamentalAnalysis: isKo ? '섹터 P/E를 EPS 성장 전망치 및 FCF 수익률과 비교하세요. 실시간 데이터는 인텔리전스 > 자본 탭에서 확인 가능합니다.'
                        : isJa ? 'セクターP/EをEPS成長率予測とFCFイールドと比較してください。リアルタイムデータはインテリジェンス > キャピタルタブで確認できます。'
                        : isZh ? '请将板块市盈率与EPS增长预测和FCF收益率进行比较。实时数据可在智能 > 资本标签页查看。'
                        : 'Compare sector P/E to EPS growth estimates and FCF yield. Live data in Intelligence > Capital tab.',
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
function dataFallbackStrategy(ctx: Awaited<ReturnType<typeof gatherTabContext>>, locale = 'en'): InvestmentStrategy {
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
  const macroParts = [ycStr, cpiStr, gdpStr, `IG_OAS=${igSpread.toFixed(2)}%`, `HY_OAS=${hySpread.toFixed(2)}%`, `F&G=${Math.round(fgScore)}(${fgLabel})`].filter(Boolean);
  const macroAnalysis = macroParts.join(' · ');
  const technicalAnalysis = `VIX=${vix.toFixed(1)}(${vixLabel})${inverted ? ' · curve inverted — recession signal active' : ' · curve normal — no recession signal'}`;

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
    portfolio: [
      { ...base.portfolio[0], allocation: spy },
      { ...base.portfolio[1], allocation: qqq },
      { ...base.portfolio[2], allocation: gld },
      { ...base.portfolio[3], allocation: tlt },
      { ...base.portfolio[4], allocation: cash },
    ],
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

// ── GET handler ───────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === '1';
  const locale = searchParams.get('locale') ?? 'en';
  // probe=1: return cached or data-fallback immediately without AI — used by verify-metrics
  const probe = searchParams.get('probe') === '1';

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

  // probe mode: no cache found → return minimal static fallback (no AI, no heavy context fetch)
  if (probe) {
    return NextResponse.json(fallbackStrategy(locale), { headers: { 'Cache-Control': 'no-store' } });
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

  const dataAsOf = new Date().toISOString();
  const ctxSummary = buildCtxSummary(ctx);
  const prompt = buildInvestmentPrompt(ctxSummary, sectorPe, earnings, livePrices, vixCtx, locale);

  const aiResult = await callAIProvider(prompt, {
    tag: 'investment-strategy',
    skipVllm: true,
    maxTokens: 1400,
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

    strategy = dataFallbackStrategy(ctx, locale);
    const isDebug = searchParams.get('debug') === '1';
    if (isDebug) {
      return NextResponse.json({
        ...strategy,
        _debug: { raw: aiResult.text.slice(0, 1000), source: aiResult.source, attempts: aiResult.attempts },
      }, { headers: CDN_HEADERS });
    }
  }

  if (strategy && !strategy.dataAsOf) strategy = { ...strategy, dataAsOf };

  const isFallback = strategy.source === 'fallback';
  if (redis) {
    try {
      if (isFallback) {
        // Cache fallbacks briefly so retries happen after AI quota resets, not 24h later
        await loggedRedisSet(redis, 'api.investment-strategy', key, strategy, { ex: 5 * 60 }); // 5min
      } else {
        await Promise.all([
          loggedRedisSet(redis, 'api.investment-strategy', key, strategy, { ex: CACHE_TTL }),
          loggedRedisSet(redis, 'api.investment-strategy', STALE_KEY_PREFIX, strategy, { ex: 7 * 24 * 60 * 60 }),
        ]);
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
