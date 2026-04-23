import { Redis } from '@upstash/redis';
import { logger } from './logger';
import { callAI as callAIProvider } from './ai-providers';
import { institutionalSignals, type InstitutionalSignal } from '@/data/institutional-signals';
import { newsGapData } from '@/data/news-gap';
import { allCompanies } from '@/data/companies';
import { companySupplyChainUpdates } from '@/data/company-supply-chain-updates';

// ── Types ─────────────────────────────────────────────────────────────────────
export type Timeframe = '1w' | '4w' | '13w';

export interface BriefSection {
  title: string;
  content: string;
  bullets: string[];
}

export interface DailyBrief {
  market: BriefSection;
  capital: BriefSection;
  company: BriefSection;
  signals: BriefSection;
  outlook: string;
  riskLevel: 'low' | 'medium' | 'high';
  generatedAt: string;
  tf: Timeframe;
  source?: string;
  cached?: boolean;
}

// ── Redis ─────────────────────────────────────────────────────────────────────
export function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export function kstDateStr(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function cacheKey(tf: Timeframe): string {
  return `flowvium:daily-brief:v4:${kstDateStr()}:${tf}`;
}

// ── Per-tab data aggregator ───────────────────────────────────────────────────
/**
 * Pulls live data from every tab's Redis cache so the AI report reflects the
 * full site state. Each field may be null if that tab hasn't been populated.
 */
export interface TabContext {
  heatmap: unknown | null;        // Market Heatmap (US default)
  short: unknown | null;          // Short Interest (squeeze candidates)
  capital: unknown | null;        // Capital Flows (assets + countries)
  fearGreed: unknown | null;      // Fear & Greed (SPY = US)
  fedWatch: unknown | null;       // CME FedWatch
  macro: unknown | null;          // Macro Indicators (CPI, yield curve, …)
  credit: unknown | null;         // NYSE margin / credit balance
  cascade: unknown[];             // News Cascade top articles today
  signals: InstitutionalSignal[]; // 13F (live if available, else static)
  // ── Bloomberg-style real-time (beats 13F's 45-day lag) ──
  insider: unknown[];             // Form 4 insider trades (D+2)
  ownership: unknown[];           // 13D/13G 5%+ crossings (+10d)
  options: unknown[];             // Unusual Whales options flow (requires key)
  korea: unknown | null;          // KRX foreign/institutional real-time
  nport: unknown | null;          // Form N-PORT mutual fund monthly holdings
  blocks: unknown[];              // Polygon block trades (requires key)
}

async function safeGet<T = unknown>(redis: Redis, key: string): Promise<T | null> {
  try { return (await redis.get<T>(key)) ?? null; } catch { return null; }
}

/** HTTP fallback: fetch live from internal API endpoints when Redis is unavailable.
 *  Parallel — each has its own timeout so slow endpoints don't block others.
 *  Routes internally skip Redis writes (loggedRedisSet no-ops on null redis) and
 *  compute fresh data. */
async function safeFetchJson<T = unknown>(baseUrl: string, path: string, timeoutMs = 12000): Promise<T | null> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'flowvium-daily-brief/1.0' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}

/** HTTP-based context gatherer — used when Redis is not configured.
 *  Fetches live from each internal API endpoint in parallel. Slower than
 *  Redis (each call ~100-500ms vs ~10ms Redis get) but ensures daily-brief
 *  has real context even without UPSTASH env vars.
 *  Each endpoint's own caching layer (if any) still applies. */
async function gatherTabContextViaHttp(baseUrl: string): Promise<TabContext> {
  const ctx: TabContext = {
    heatmap: null, short: null, capital: null, fearGreed: null,
    fedWatch: null, macro: null, credit: null, cascade: [],
    signals: institutionalSignals,
    insider: [], ownership: [], options: [], korea: null,
    nport: null, blocks: [],
  };

  const [
    capital, fgAll, fedWatch, macro, heatmap, credit,
    insiderR, ownerR, koreaR, nportR, shortR, cascadeR,
  ] = await Promise.all([
    safeFetchJson<Record<string, unknown>>(baseUrl, '/api/capital-flows', 15000),
    safeFetchJson<Record<string, unknown>>(baseUrl, '/api/fear-greed', 12000),
    safeFetchJson<Record<string, unknown>>(baseUrl, '/api/fedwatch', 10000),
    safeFetchJson<Record<string, unknown>>(baseUrl, '/api/macro-indicators', 10000),
    safeFetchJson<Record<string, unknown>>(baseUrl, '/api/market-heatmap?country=US', 15000),
    safeFetchJson<Record<string, unknown>>(baseUrl, '/api/credit-balance', 10000),
    safeFetchJson<{ items?: unknown[] }>(baseUrl, '/api/insider-trades', 15000),
    safeFetchJson<{ items?: unknown[] }>(baseUrl, '/api/ownership-alerts', 15000),
    safeFetchJson<Record<string, unknown>>(baseUrl, '/api/korea-flow', 10000),
    safeFetchJson<Record<string, unknown>>(baseUrl, '/api/nport-holdings', 15000),
    safeFetchJson<Record<string, unknown>>(baseUrl, '/api/short-interest', 12000),
    safeFetchJson<{ articles?: unknown[] }>(baseUrl, '/api/news-cascade', 15000),
  ]);

  ctx.capital = capital;
  // /api/fear-greed returns { byCountry: [{id:'us', score, ...}], byAsset: [...] }
  // Daily-brief summariseFearGreed wants entry with .score top-level → pass the US entry.
  if (fgAll) {
    const byCountry = (fgAll as { byCountry?: Array<Record<string, unknown>> }).byCountry ?? [];
    ctx.fearGreed = byCountry.find(x => x.id === 'us') ?? byCountry[0] ?? null;
  }
  ctx.fedWatch = fedWatch;
  ctx.macro = macro;
  ctx.heatmap = heatmap;
  ctx.credit = credit;
  if (insiderR?.items && Array.isArray(insiderR.items)) ctx.insider = insiderR.items;
  if (ownerR?.items && Array.isArray(ownerR.items)) ctx.ownership = ownerR.items;
  ctx.korea = koreaR;
  ctx.nport = nportR;
  ctx.short = shortR;
  if (cascadeR?.articles && Array.isArray(cascadeR.articles)) ctx.cascade = cascadeR.articles;

  logger.info('daily-brief', 'http_context_gathered', {
    populated: {
      capital: ctx.capital != null, fearGreed: ctx.fearGreed != null,
      fedWatch: ctx.fedWatch != null, macro: ctx.macro != null,
      heatmap: ctx.heatmap != null, credit: ctx.credit != null,
      insider: ctx.insider.length, ownership: ctx.ownership.length,
      korea: ctx.korea != null, nport: ctx.nport != null,
      short: ctx.short != null, cascade: ctx.cascade.length,
    },
  });
  return ctx;
}

export async function gatherTabContext(redis: Redis | null, baseUrl?: string): Promise<TabContext> {
  const ctx: TabContext = {
    heatmap: null, short: null, capital: null, fearGreed: null,
    fedWatch: null, macro: null, credit: null, cascade: [],
    signals: institutionalSignals,
    insider: [], ownership: [], options: [], korea: null,
    nport: null, blocks: [],
  };
  if (!redis) {
    // UPSTASH 미설정 환경: 내부 API endpoint 로 HTTP fetch 폴백
    if (baseUrl) return gatherTabContextViaHttp(baseUrl);
    logger.warn('daily-brief', 'no_redis_no_baseUrl', { note: 'context will be empty' });
    return ctx;
  }

  const hour = new Date().toISOString().slice(0, 13);
  const today = new Date().toISOString().slice(0, 10);
  const kst = kstDateStr();

  const [
    heatmap, shortData, capFlowsV5Twelve, capFlowsV5Yahoo, capFlowsV4Legacy,
    fg, fed, macroV4, macroV3, credit, cascadeIds, liveSignals,
    insider, ownership, options, korea, nport, blocks,
  ] = await Promise.all([
    safeGet(redis, `flowvium:heatmap:v5:US:${hour}`),
    safeGet(redis, 'flowvium:short-interest:v1'),
    // capital-flows 현행 스키마는 v5 (twelve/yahoo). v4 는 구형. 후자로 폴백.
    safeGet(redis, 'flowvium:capital-flows:v5:twelve'),
    safeGet(redis, 'flowvium:capital-flows:v5:yahoo'),
    safeGet(redis, 'flowvium:capital-flows:v4:twelve'),
    // fear-greed 현행 스키마는 v5:SPY (v3 은 삭제됨)
    safeGet(redis, 'flowvium:fg:v5:SPY'),
    safeGet(redis, `flowvium:fedwatch:v1:${hour}`),
    safeGet(redis, `flowvium:macro-indicators:v4:${kst}`),
    safeGet(redis, `flowvium:macro-indicators:v3:${kst}`),
    safeGet<Record<string, unknown>>(redis, `flowvium:credit-balance:v2:${today}`),
    (async () => {
      try { return await redis.lrange(`flowvium:news-cascade:v1:list:${today}`, 0, 5); }
      catch { return [] as string[]; }
    })(),
    safeGet<InstitutionalSignal[]>(redis, 'flowvium:13f-signals:v1'),
    safeGet<unknown[]>(redis, 'flowvium:insider-trades:v1'),
    safeGet<unknown[]>(redis, 'flowvium:ownership-alerts:v1'),
    safeGet<unknown[]>(redis, 'flowvium:options-flow:v1'),
    safeGet(redis, 'flowvium:korea-flow:v1'),
    safeGet(redis, 'flowvium:nport-holdings:v1'),
    safeGet<unknown[]>(redis, 'flowvium:block-trades:v1'),
  ]);

  ctx.heatmap = heatmap;
  ctx.short = shortData;
  ctx.capital = capFlowsV5Twelve ?? capFlowsV5Yahoo ?? capFlowsV4Legacy;
  ctx.fearGreed = fg;
  ctx.fedWatch = fed;
  ctx.macro = macroV4 ?? macroV3;
  ctx.credit = credit;
  if (Array.isArray(liveSignals) && liveSignals.length > 0) ctx.signals = liveSignals;
  if (Array.isArray(insider)) ctx.insider = insider;
  if (Array.isArray(ownership)) ctx.ownership = ownership;
  if (Array.isArray(options)) ctx.options = options;
  ctx.korea = korea;
  ctx.nport = nport;
  if (Array.isArray(blocks)) ctx.blocks = blocks;

  if (cascadeIds && cascadeIds.length > 0) {
    const articles = await Promise.all(
      cascadeIds.slice(0, 5).map(id => safeGet(redis, `flowvium:news-cascade:v1:article:${id}`))
    );
    ctx.cascade = articles.filter(Boolean);
  }

  return ctx;
}

// ── AI call ───────────────────────────────────────────────────────────────────
// 통합 cascade(vLLM → GROQ → Gemini)로 위임. 자세한 체인 설명은 ai-providers.ts 참조.
export async function callAI(prompt: string): Promise<{ text: string; source: string; attempts?: unknown }> {
  // maxTokens 500 → 1800: 4-section JSON with bullets + outlook ≈ 1000-1400 tokens;
  //   500이 truncation 을 일으켜 parseAIResponse 실패 → fallbackBrief 에 항상 떨어짐.
  // skipVllm=true: EXAONE-2.4B는 max_model_len=1024로 긴 JSON 생성에 부적합.
  //   vLLM 터널이 살아있어도 GROQ 70b가 이 용도에 훨씬 적합.
  const r = await callAIProvider(prompt, {
    tag: 'daily-brief',
    maxTokens: 1800,
    temperature: 0.55,
    skipVllm: true,
    timeoutMs: 30000,
  });
  return { text: r.text, source: r.source, attempts: r.attempts };
}

// ── Compact summarisers for each tab ─────────────────────────────────────────
function summariseHeatmap(data: unknown): string {
  const d = data as Record<string, unknown> | null;
  if (!d?.sectors) return '';
  const sectors = (d.sectors as Array<Record<string, unknown>>) ?? [];
  const sorted = [...sectors]
    .filter(s => s.avgChangePct != null)
    .sort((a, b) => (b.avgChangePct as number) - (a.avgChangePct as number));
  const top = sorted.slice(0, 3).map(s => `${s.sector}${(s.avgChangePct as number) > 0 ? '+' : ''}${(s.avgChangePct as number).toFixed(1)}%`);
  const bot = sorted.slice(-2).map(s => `${s.sector}${(s.avgChangePct as number).toFixed(1)}%`);
  return `sectors↑${top.join(',')} ↓${bot.join(',')}`;
}

function summariseShort(data: unknown): string {
  const d = data as Array<Record<string, unknown>> | { entries?: Array<Record<string, unknown>> } | null;
  const arr = Array.isArray(d) ? d : d?.entries;
  if (!arr?.length) return '';
  const top = [...arr]
    .filter(s => (s.squeezeScore as number) > 0 || (s.shortFloatPct as number | null) != null)
    .sort((a, b) => ((b.squeezeScore as number) ?? 0) - ((a.squeezeScore as number) ?? 0))
    .slice(0, 4)
    .map(s => `${s.ticker}(${s.squeezeScore ?? 0}점,short${(s.shortFloatPct as number | null) ?? '-'}%)`);
  return `squeeze:${top.join(',')}`;
}

function summariseCapital(data: unknown, tf: Timeframe): string {
  const retKey = tf === '1w' ? 'ret1w' : tf === '4w' ? 'ret4w' : 'ret13w';
  const d = data as Record<string, unknown> | null;
  if (!d) return '';
  const assets = (d.assets as Array<Record<string, unknown>>) ?? [];
  const sortedA = [...assets].sort((a, b) => ((b[retKey] as number) ?? 0) - ((a[retKey] as number) ?? 0));
  const topA = sortedA.slice(0, 3).map(a => `${a.ticker}+${((a[retKey] as number) ?? 0).toFixed(1)}%`);
  const botA = sortedA.slice(-2).map(a => `${a.ticker}${((a[retKey] as number) ?? 0).toFixed(1)}%`);

  const cf = d.countryFlow as Record<string, unknown> | undefined;
  const countries = (cf?.countries as Array<Record<string, unknown>>) ?? [];
  const sortedC = [...countries].sort((a, b) => ((b[retKey] as number) ?? 0) - ((a[retKey] as number) ?? 0));
  // capital-flows schema uses `label` not `country` — fall back to both for safety
  const topC = sortedC.slice(0, 2).map(c => `${c.label ?? c.country ?? c.id}+${((c[retKey] as number) ?? 0).toFixed(1)}%`);
  const botC = sortedC.slice(-1).map(c => `${c.label ?? c.country ?? c.id}${((c[retKey] as number) ?? 0).toFixed(1)}%`);

  return `assets↑${topA.join(',')} ↓${botA.join(',')} | countries↑${topC.join(',')} ↓${botC.join(',')}`;
}

function summariseFearGreed(data: unknown): string {
  const d = data as Record<string, unknown> | null;
  if (!d || d.score == null) return '';
  const score = d.score as number;
  const prev = d.prevScore as number | undefined;
  const chg = prev != null ? score - prev : 0;
  return `F&G=${Math.round(score)}${chg > 0 ? ` (+${Math.round(chg)})` : chg < 0 ? ` (${Math.round(chg)})` : ''}`;
}

function summariseFed(data: unknown): string {
  const d = data as Record<string, unknown> | null;
  if (!d) return '';
  const meetings = d.meetings as Array<Record<string, unknown>> | undefined;
  const cur = d.currentRateMid;
  if (!meetings?.length) return `FedRate=${cur}%`;
  const next = meetings[0];
  return `FedRate=${cur}%,next ${next.label as string}:hold${Math.round((next.probHold as number) ?? 0)}%/cut${Math.round((next.probCut25 as number) ?? 0)}%`;
}

function summariseMacro(data: unknown): string {
  const d = data as Record<string, unknown> | null;
  if (!d) return '';
  const inds = (d.indicators as Array<Record<string, unknown>>) ?? [];
  const notable = inds
    .filter(i => i.actual != null && (i.surprise === 'beat' || i.surprise === 'miss'))
    .slice(0, 3)
    .map(i => `${i.nameKo ?? i.id}=${i.actual}${i.unit ?? ''}(${i.surprise})`);
  const yc = d.yieldCurve as Record<string, unknown> | undefined;
  const spread = yc?.spread10y2y as number | undefined;
  const parts: string[] = [];
  if (notable.length) parts.push(notable.join(','));
  if (spread != null) parts.push(`10y2y=${spread.toFixed(0)}bp${yc?.inverted ? '(inv)' : ''}`);
  return parts.join(' | ');
}

function summariseCredit(data: unknown): string {
  const d = data as Record<string, unknown> | null;
  if (!d) return '';
  const latest = d.latestMonth as Record<string, unknown> | undefined;
  if (!latest) return '';
  const m = latest.margin as number | undefined;
  const fc = latest.freeCredit as number | undefined;
  const mom = latest.marginMoM as number | undefined;
  return `margin=$${m?.toFixed(0)}B${mom != null ? `(MoM ${mom > 0 ? '+' : ''}${mom.toFixed(1)}%)` : ''},freeCredit=$${fc?.toFixed(0)}B`;
}

function summariseCascade(articles: unknown[]): string {
  const arr = articles as Array<Record<string, unknown>>;
  if (!arr?.length) return '';
  return arr.slice(0, 3).map(a => {
    const title = (a.title as string ?? '').slice(0, 40);
    const sent = a.sentiment as string;
    return `${sent === 'bullish' ? '↑' : sent === 'bearish' ? '↓' : '·'}${title}`;
  }).join(' | ');
}

function summariseSignals(signals: InstitutionalSignal[]): { buys: string; cuts: string } {
  const buys = signals
    .filter(s => s.action === 'accumulating' || s.action === 'new_position')
    .slice(0, 4)
    .map(s => `${s.institution.slice(0, 14)}→${s.ticker}(${s.estimatedValue})`)
    .join(', ');
  const cuts = signals
    .filter(s => s.action === 'reducing' || s.action === 'exit')
    .slice(0, 3)
    .map(s => `${s.institution.slice(0, 14)}↓${s.ticker}(${s.estimatedValue})`)
    .join(', ');
  return { buys, cuts };
}

function summariseNewsGap(): { stakes: string; gaps: string } {
  const stakes = newsGapData
    .flatMap(n => n.ownershipData.filter(o => o.action === 'new' || o.action === 'increased').map(o => ({ ticker: n.ticker, ...o })))
    .sort((a, b) => b.valueM - a.valueM)
    .slice(0, 3)
    .map(s => {
      const chg = s.prevPct !== undefined ? `${s.prevPct.toFixed(1)}→${s.pctOfShares.toFixed(1)}%` : `신규${s.pctOfShares.toFixed(1)}%`;
      return `${s.ticker}:${s.institution.slice(0, 12)}(${chg},$${s.valueM}M)`;
    })
    .join(', ');
  const gaps = [...newsGapData]
    .sort((a, b) => b.gapScore - a.gapScore)
    .slice(0, 3)
    .map(n => `${n.ticker}(갭${n.gapScore})`)
    .join(', ');
  return { stakes, gaps };
}

function summariseInsider(items: unknown[]): string {
  const arr = items as Array<Record<string, unknown>>;
  if (!arr?.length) return '';
  // Prioritize large open-market BUYS by officers (strongest signal)
  const buys = arr
    .filter(t => t.direction === 'buy' && (t.transactionValueUsd as number ?? 0) > 100_000)
    .slice(0, 3)
    .map(t => `${t.ticker ?? '?'}:${(t.insiderName as string ?? '').slice(0, 14)}(${t.officerTitle ?? 'insider'})$${Math.round((t.transactionValueUsd as number) / 1000)}K`)
    .join(', ');
  const sells = arr
    .filter(t => t.direction === 'sell' && (t.transactionValueUsd as number ?? 0) > 1_000_000)
    .slice(0, 2)
    .map(t => `${t.ticker ?? '?'}↓$${Math.round((t.transactionValueUsd as number) / 1_000_000)}M`)
    .join(', ');
  return [buys && `buys=${buys}`, sells && `sells=${sells}`].filter(Boolean).join(' | ');
}

function summariseOwnership(items: unknown[]): string {
  const arr = items as Array<Record<string, unknown>>;
  if (!arr?.length) return '';
  return arr.slice(0, 3)
    .map(a => `${a.ticker ?? '?'}:${(a.filerName as string ?? '').slice(0, 18)}(${a.formType} ${a.percentOwned != null ? `${a.percentOwned}%` : ''})`)
    .join(', ');
}

function summariseOptionsFlow(items: unknown[]): string {
  const arr = items as Array<Record<string, unknown>>;
  if (!arr?.length) return '';
  // Biggest premium bullish/bearish sweeps
  const sorted = [...arr].sort((a, b) => ((b.premiumUsd as number) ?? 0) - ((a.premiumUsd as number) ?? 0));
  return sorted.slice(0, 3)
    .map(o => `${o.ticker}(${o.sentiment}$${Math.round((o.premiumUsd as number) / 1000)}K)`)
    .join(', ');
}

function summariseKorea(korea: unknown): string {
  const k = korea as Record<string, unknown> | null;
  if (!k) return '';
  const topFB = (k.topForeignBuy as Array<Record<string, unknown>>) ?? [];
  const topFS = (k.topForeignSell as Array<Record<string, unknown>>) ?? [];
  const topIB = (k.topInstBuy as Array<Record<string, unknown>>) ?? [];
  const fbStr = topFB.slice(0, 2).map(r => `${r.name}(+${Math.round(((r.foreignerNetBuy as number) ?? 0) / 1e8)}억)`).join(',');
  const fsStr = topFS.slice(0, 2).map(r => `${r.name}(${Math.round(((r.foreignerNetBuy as number) ?? 0) / 1e8)}억)`).join(',');
  const ibStr = topIB.slice(0, 2).map(r => `${r.name}(+${Math.round(((r.institutionNetBuy as number) ?? 0) / 1e8)}억)`).join(',');
  return `외인매수:${fbStr} / 외인매도:${fsStr} / 기관매수:${ibStr}`;
}

function summariseNPort(nport: unknown): string {
  const p = nport as Record<string, unknown> | null;
  if (!p) return '';
  const byTicker = (p.byTicker as Array<Record<string, unknown>>) ?? [];
  return byTicker.slice(0, 4)
    .map(a => `${a.ticker}:${(a.funds as unknown[])?.length ?? 0}펀드/$${Math.round((a.totalValueUsd as number) / 1e6)}M`)
    .join(', ');
}

function summariseBlocks(items: unknown[]): string {
  const arr = items as Array<Record<string, unknown>>;
  if (!arr?.length) return '';
  return arr.slice(0, 3)
    .map(b => `${b.ticker}(${(b.size as number)?.toLocaleString()}주@$${(b.price as number)?.toFixed(2)})`)
    .join(', ');
}

function summariseSupply(): string {
  return Object.entries(companySupplyChainUpdates)
    .flatMap(([tk, ups]) => ups.filter(u => u.impact === 'high').slice(0, 1).map(u => `${tk}:${u.type}`))
    .slice(0, 3)
    .join(', ');
}

// ── Build rich prompt covering every tab ─────────────────────────────────────
export function buildPrompt(tf: Timeframe, ctx?: TabContext): string {
  const tfLabel = tf === '1w' ? '1주' : tf === '4w' ? '4주' : '13주';
  const signals = ctx?.signals ?? institutionalSignals;
  const { buys, cuts } = summariseSignals(signals);
  const { stakes, gaps } = summariseNewsGap();
  const supply = summariseSupply();
  const heatmap = ctx ? summariseHeatmap(ctx.heatmap) : '';
  const short = ctx ? summariseShort(ctx.short) : '';
  const capital = ctx ? summariseCapital(ctx.capital, tf) : '';
  const fg = ctx ? summariseFearGreed(ctx.fearGreed) : '';
  const fed = ctx ? summariseFed(ctx.fedWatch) : '';
  const macro = ctx ? summariseMacro(ctx.macro) : '';
  const credit = ctx ? summariseCredit(ctx.credit) : '';
  const cascade = ctx ? summariseCascade(ctx.cascade) : '';
  const insider = ctx ? summariseInsider(ctx.insider) : '';
  const ownership = ctx ? summariseOwnership(ctx.ownership) : '';
  const optionsFlow = ctx ? summariseOptionsFlow(ctx.options) : '';
  const korea = ctx ? summariseKorea(ctx.korea) : '';
  const nport = ctx ? summariseNPort(ctx.nport) : '';
  const blocks = ctx ? summariseBlocks(ctx.blocks) : '';

  // 빈 섹션은 프롬프트에서 제외 — GROQ TPD 한도 소비 최소화 (100,000/일).
  // "[Heatmap] n/a" 한 줄도 8-12 토큰 소비. 18개 탭 × 수십 건/일 축적시 상당량.
  const sections: Array<[string, string]> = [
    ['Heatmap', heatmap],
    ['CapitalFlows', capital],
    ['Fear&Greed', fg],
    ['FedWatch', fed],
    ['Macro', macro],
    ['Credit', credit],
    ['Cascade', cascade],
    ['13F-Buys', buys],
    ['13F-Cuts', cuts],
    ['NewsGap-Stakes', stakes],
    ['NewsGap-Top', gaps],
    ['Supply', supply],
    ['Form4-Insider', insider],
    ['13D13G-Ownership', ownership],
    ['OptionsFlow', optionsFlow],
    ['Korea-Flow', korea],
    ['NPort-Funds', nport],
    ['Block-Trades', blocks],
  ];
  const body = sections
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([k, v]) => `[${k}] ${v}`)
    .join('\n');
  return `Flowvium ${tfLabel} 리포트용 실시간 탭 데이터입니다. 각 탭을 종합해 한국어 JSON만 반환하세요.

${body}

출력 규칙: JSON만, 마크다운 금지, bullets는 각 25자 이내의 구체 수치 포함 문장.
섹션 매핑:
- market: Heatmap+CapitalFlows+Fear&Greed+FedWatch에서 시장 전반
- capital: CapitalFlows countries+Macro+Credit+Korea-Flow에서 자금 이동·거시
- company: 13F-Buys+Form4-Insider(CEO 매수 강조)+13D13G+OptionsFlow+Short에서 주목 종목
- signals: Form4 대형 매수/매도+13D13G 5%돌파+Cascade+Supply에서 강한 실시간 구조 신호
- outlook: 위 전체를 종합한 한 줄 전망(리스크 포함)
- riskLevel: low|medium|high (Fear&Greed·yieldCurve 기반)

{"market":{"title":"시장","content":"한 줄 요약","bullets":["","",""]},"capital":{"title":"자금","content":"한 줄 요약","bullets":["","",""]},"company":{"title":"종목","content":"한 줄 요약","bullets":["","",""]},"signals":{"title":"신호","content":"한 줄 요약","bullets":["","",""]},"outlook":"","riskLevel":"medium"}`;
}

// ── Parse AI response ─────────────────────────────────────────────────────────
export function parseAIResponse(raw: string, tf: Timeframe, source = 'AI'): DailyBrief | null {
  try {
    let text = raw.replace(/```(?:json)?/g, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    text = text.slice(start, end + 1);
    const parsed = JSON.parse(text);

    if (!parsed.market || !parsed.capital || !parsed.company || !parsed.signals) return null;

    const ensureSection = (s: unknown): BriefSection => {
      const sec = s as Record<string, unknown>;
      const bulls = Array.isArray(sec?.bullets) ? (sec.bullets as unknown[]).map(String) : [];
      return {
        title: String(sec?.title ?? ''),
        content: String(sec?.content ?? (bulls.length > 0 ? bulls.join(' · ') : sec?.title) ?? ''),
        bullets: bulls,
      };
    };

    return {
      market: ensureSection(parsed.market),
      capital: ensureSection(parsed.capital),
      company: ensureSection(parsed.company),
      signals: ensureSection(parsed.signals),
      outlook: parsed.outlook ?? '',
      riskLevel: (['low','medium','high'].includes(parsed.riskLevel)
        ? parsed.riskLevel
        : parsed.riskLevel === '높음' || parsed.riskLevel === '상' ? 'high'
        : parsed.riskLevel === '낮음' || parsed.riskLevel === '하' ? 'low'
        : 'medium') as 'low' | 'medium' | 'high',
      generatedAt: new Date().toISOString(),
      tf,
      source,
    };
  } catch {
    return null;
  }
}

/** Data-driven brief — used when AI is unavailable. Now pulls every tab. */
export function fallbackBrief(tf: Timeframe, ctx?: TabContext): DailyBrief {
  const tfLabel = tf === '1w' ? '1주' : tf === '4w' ? '4주' : '13주';
  const retKey = tf === '1w' ? 'ret1w' : tf === '4w' ? 'ret4w' : 'ret13w';
  const capital = ctx?.capital as Record<string, unknown> | null | undefined;
  const macro = ctx?.macro as Record<string, unknown> | null | undefined;
  const signals = ctx?.signals ?? institutionalSignals;

  // ── Market: heatmap + assets + fg + fed ──────────────────────────────────
  const marketBullets: string[] = [];
  try {
    const hm = ctx?.heatmap as Record<string, unknown> | null | undefined;
    const sectors = (hm?.sectors as Array<Record<string, unknown>>) ?? [];
    if (sectors.length > 0) {
      const sorted = [...sectors]
        .filter(s => s.avgChangePct != null)
        .sort((a, b) => (b.avgChangePct as number) - (a.avgChangePct as number));
      const top = sorted.slice(0, 2).map(s => `${s.sector} +${(s.avgChangePct as number).toFixed(1)}%`);
      const bot = sorted.slice(-1).map(s => `${s.sector} ${(s.avgChangePct as number).toFixed(1)}%`);
      if (top.length) marketBullets.push(`섹터 상승: ${top.join(', ')}`);
      if (bot.length) marketBullets.push(`섹터 하락: ${bot.join(', ')}`);
    }
    const assets = (capital?.assets as Array<Record<string, unknown>>) ?? [];
    if (assets.length > 0) {
      const sorted = [...assets].sort((a, b) => ((b[retKey] as number) ?? 0) - ((a[retKey] as number) ?? 0));
      marketBullets.push(`자산 상위: ${sorted.slice(0, 3).map(a => `${a.ticker} +${((a[retKey] as number) ?? 0).toFixed(1)}%`).join(', ')}`);
    }
    const fg = ctx?.fearGreed as Record<string, unknown> | null | undefined;
    if (fg?.score != null) {
      const val = fg.score as number;
      const label = val >= 75 ? '극도 탐욕' : val >= 55 ? '탐욕' : val >= 45 ? '중립' : val >= 25 ? '공포' : '극도 공포';
      marketBullets.push(`공포탐욕: ${Math.round(val)} (${label})`);
    }
    const fed = ctx?.fedWatch as Record<string, unknown> | null | undefined;
    const meetings = fed?.meetings as Array<Record<string, unknown>> | undefined;
    if (meetings?.length) {
      const next = meetings[0];
      marketBullets.push(`FOMC ${next.label as string}: 인하 ${Math.round((next.probCut25 as number) ?? 0)}%`);
    }
  } catch { /* ignore */ }
  if (marketBullets.length === 0) marketBullets.push(`${tfLabel} 시장 데이터 집계 중`);

  // ── Capital: countries + yield + credit ──────────────────────────────────
  const capitalBullets: string[] = [];
  try {
    const cf = capital?.countryFlow as Record<string, unknown> | undefined;
    const countries = (cf?.countries as Array<Record<string, unknown>>) ?? [];
    if (countries.length > 0) {
      const sorted = [...countries].sort((a, b) => ((b[retKey] as number) ?? 0) - ((a[retKey] as number) ?? 0));
      capitalBullets.push(`유입: ${sorted.slice(0, 3).map(c => `${c.label ?? c.country ?? c.id}(+${((c[retKey] as number) ?? 0).toFixed(1)}%)`).join(', ')}`);
      capitalBullets.push(`유출: ${sorted.slice(-2).reverse().map(c => `${c.label ?? c.country ?? c.id}(${((c[retKey] as number) ?? 0).toFixed(1)}%)`).join(', ')}`);
    }
    const yc = macro?.yieldCurve as Record<string, unknown> | undefined;
    if (yc?.spread10y2y != null) {
      const spread = yc.spread10y2y as number;
      capitalBullets.push(`10Y-2Y 스프레드: ${spread.toFixed(0)}bp${yc.inverted ? ' ⚠️ 역전' : ''}`);
    }
    const credit = ctx?.credit as Record<string, unknown> | null | undefined;
    const latest = credit?.latestMonth as Record<string, unknown> | undefined;
    if (latest) {
      const m = latest.margin as number | undefined;
      const mom = latest.marginMoM as number | undefined;
      if (m != null) capitalBullets.push(`NYSE 마진: $${m.toFixed(0)}B${mom != null ? ` (MoM ${mom > 0 ? '+' : ''}${mom.toFixed(1)}%)` : ''}`);
    }
  } catch { /* ignore */ }
  if (capitalBullets.length === 0) capitalBullets.push(`${tfLabel} 자금 흐름 집계 중`);

  // ── Company: 13F + insider (real-time) + squeeze + newsgap ──────────────
  const companyBullets: string[] = [];
  try {
    const top = signals
      .filter(s => s.action === 'accumulating' || s.action === 'new_position')
      .slice(0, 2)
      .map(s => `${s.institution} → ${s.ticker} (${s.estimatedValue})`);
    if (top.length > 0) companyBullets.push(...top);

    // Real-time insider Form 4 buys — strongest signal
    const insider = (ctx?.insider ?? []) as Array<Record<string, unknown>>;
    const topInsider = insider
      .filter(t => t.direction === 'buy' && (t.transactionValueUsd as number ?? 0) > 100_000)
      .slice(0, 2)
      .map(t => `${t.ticker ?? t.issuerName} 내부자(${t.officerTitle ?? '임원'}) $${Math.round((t.transactionValueUsd as number) / 1000)}K 매수`);
    if (topInsider.length) companyBullets.push(...topInsider);

    const shortArr = Array.isArray(ctx?.short) ? ctx!.short as Array<Record<string, unknown>>
      : (ctx?.short as { entries?: Array<Record<string, unknown>> } | null)?.entries ?? [];
    const squeeze = shortArr
      .filter(s => (s.squeezeScore as number) >= 30)
      .slice(0, 1)
      .map(s => `${s.ticker} 스퀴즈 ${s.squeezeScore}점`);
    if (squeeze.length) companyBullets.push(...squeeze);
  } catch { /* ignore */ }
  if (companyBullets.length === 0) companyBullets.push(`13F+Form4 매집 분석 중`);

  // ── Signals: real-time 5% crossings + options flow + cascade ────────────
  const signalBullets: string[] = [];
  try {
    // 13D/13G real-time 5%+ ownership crossings (most actionable signal)
    const ownership = (ctx?.ownership ?? []) as Array<Record<string, unknown>>;
    const xings = ownership
      .filter(a => (a.percentOwned as number) != null)
      .slice(0, 2)
      .map(a => `${a.ticker ?? a.issuerName} ${a.formType}: ${a.filerName} ${(a.percentOwned as number).toFixed(1)}%`);
    if (xings.length) signalBullets.push(...xings);

    // Options unusual flow top sweep
    const options = (ctx?.options ?? []) as Array<Record<string, unknown>>;
    if (options.length) {
      const top = [...options].sort((a, b) => ((b.premiumUsd as number) ?? 0) - ((a.premiumUsd as number) ?? 0))[0];
      if (top) signalBullets.push(`옵션 sweep: ${top.ticker} ${top.sentiment} $${Math.round((top.premiumUsd as number) / 1000)}K`);
    }

    // Korea flow top foreign buy
    const korea = ctx?.korea as Record<string, unknown> | null;
    const topFB = (korea?.topForeignBuy as Array<Record<string, unknown>>) ?? [];
    if (topFB.length > 0) {
      const t = topFB[0];
      signalBullets.push(`🇰🇷 외인 ${t.name}: +${Math.round(((t.foreignerNetBuy as number) ?? 0) / 1e8)}억`);
    }

    // Cascade headline
    const arr = ctx?.cascade as Array<Record<string, unknown>> | undefined;
    if (arr?.length) {
      const top = arr[0];
      const sent = top.sentiment as string;
      signalBullets.push(`Cascade: ${sent === 'bullish' ? '호재' : sent === 'bearish' ? '악재' : '뉴스'} — ${(top.title as string).slice(0, 40)}`);
    }
  } catch { /* ignore */ }
  if (signalBullets.length === 0) {
    // Fallback to 13F stake changes when nothing real-time is available
    const stakeChanges = newsGapData
      .flatMap(n => n.ownershipData.filter(o => o.action === 'new' || o.action === 'increased').map(o => ({ ticker: n.ticker, ...o })))
      .sort((a, b) => b.valueM - a.valueM)
      .slice(0, 2)
      .map(s => `${s.ticker}: ${s.institution} (${s.quarter})`);
    signalBullets.push(...(stakeChanges.length ? stakeChanges : ['실시간 신호 수집 중']));
  }

  // ── Risk ─────────────────────────────────────────────────────────────────
  let riskLevel: 'low' | 'medium' | 'high' = 'medium';
  try {
    const fg = ctx?.fearGreed as Record<string, unknown> | null | undefined;
    const val = fg?.score as number | undefined;
    const yc = macro?.yieldCurve as Record<string, unknown> | undefined;
    const inverted = yc?.inverted as boolean | undefined;
    if (val != null) {
      if (val < 30 || inverted) riskLevel = 'high';
      else if (val > 70) riskLevel = 'low';
    }
  } catch { /* ignore */ }

  return {
    market: { title: '글로벌 시장', content: `${tfLabel} 시장 종합`, bullets: marketBullets },
    capital: { title: '자금 흐름 & 거시', content: `${tfLabel} 자금·거시`, bullets: capitalBullets },
    company: { title: '주목 종목', content: `${tfLabel} 매집·스퀴즈`, bullets: companyBullets },
    signals: { title: '구조 신호', content: `${tfLabel} 지분·Cascade·Supply`, bullets: signalBullets },
    outlook: `${tfLabel} 전 탭(Heatmap·CapitalFlows·13F+Form4·13D/G·옵션flow·한국수급·NewsGap·Short·Macro·Cascade) 종합. 리스크 ${riskLevel === 'high' ? '높음(공포·역전)' : riskLevel === 'low' ? '낮음(탐욕 과열)' : '중립'}.`,
    riskLevel,
    generatedAt: new Date().toISOString(),
    tf,
    source: 'data',
  };
}
