/**
 * judge-engine.ts — 매수·매도 심판엔진 채팅 백엔드 헬퍼 (2026-06-18 신설)
 *
 * 채팅이 LLM(vLLM 우선) + RAG(judgment-doctrine/investor-wisdom + buy/sell 룰) + 실시간 금융 API
 * + 최신 리포트(Redis)를 종합해 사용자와 매수/매도 판단을 "상의" 하도록 컨텍스트를 구성한다.
 *
 * 룰 평가 엔진 자체는 scripts/generate-report-local.mjs(Node 전용)에만 존재 → 여기선 룰 정의를
 * grounding context 로 LLM 에 주입(룰을 적용·인용하도록). 결정론적 rule-firing 스코어는 v2.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { companyNamesI18n } from '@/data/company-names-i18n';

const ROOT = process.cwd();
function loadJson<T>(rel: string): T | null {
  try { return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')) as T; }
  catch { return null; }
}

// ── 데이터 캐시 (모듈 수명 — 룰/doctrine 은 거의 안 변함) ───────────────────────
interface Rule { id: string; score?: number; category?: string; description?: string; condition?: unknown }
interface Doctrine { id: string; theme?: string; sources?: string[]; rule?: string; apply?: string }
interface Meta { name?: string; sector?: string; cap?: string; market?: string }

let _cache: {
  buyRules: Rule[]; sellRules: Rule[]; doctrine: Doctrine[]; wisdom: Doctrine[];
  meta: Record<string, Meta>; nameToTicker: Map<string, string>;
} | null = null;

function getData() {
  if (_cache) return _cache;
  const buy = loadJson<{ rules?: Rule[] } | Rule[]>('data/buy-rules-tuned.json');
  const sell = loadJson<{ rules?: Rule[] } | Rule[]>('data/sell-rules-tuned.json');
  const doc = loadJson<Doctrine[] | { principles?: Doctrine[] }>('data/judgment-doctrine.json');
  const wis = loadJson<Doctrine[] | { principles?: Doctrine[] }>('data/investor-wisdom.json');
  const cand = loadJson<{ meta?: Record<string, Meta> }>('data/candidate-tickers.json');
  const arr = (x: unknown): Doctrine[] => Array.isArray(x) ? x as Doctrine[] : ((x as { principles?: Doctrine[] })?.principles ?? []);
  const rules = (x: unknown): Rule[] => Array.isArray(x) ? x as Rule[] : ((x as { rules?: Rule[] })?.rules ?? []);
  const meta = cand?.meta ?? {};
  // 이름(영문·한글) → 티커 역매핑 (소문자, 공백제거)
  const nameToTicker = new Map<string, string>();
  const addName = (name: string, tk: string) => {
    const key = name.toLowerCase().replace(/\s+/g, '');
    if (key.length >= 2 && !nameToTicker.has(key)) nameToTicker.set(key, tk);
  };
  for (const [tk, m] of Object.entries(meta)) {
    if (m?.name) addName(m.name, tk);
  }
  // 다국어 별칭(엔비디아/エヌビディア/英伟达 등) — US 티커의 현지어 이름 매칭
  for (const [tk, aliases] of Object.entries(companyNamesI18n)) {
    if (meta[tk]) for (const a of aliases) addName(a, tk);
  }
  _cache = { buyRules: rules(buy), sellRules: rules(sell), doctrine: arr(doc), wisdom: arr(wis), meta, nameToTicker };
  return _cache;
}

// ── 티커 탐지 ────────────────────────────────────────────────────────────────
export function detectTickers(text: string, max = 3): string[] {
  const { meta, nameToTicker } = getData();
  const found = new Set<string>();
  // 1) KR 6자리 코드
  for (const m of Array.from(text.matchAll(/\b(\d{6})\b/g))) {
    const code = m[1];
    if (meta[`${code}.KS`]) found.add(`${code}.KS`);
    else if (meta[`${code}.KQ`]) found.add(`${code}.KQ`);
  }
  // 2) 명시적 US 티커 (대문자 1~5, 풀에 존재하는 것만 — AI/CEO 등 오탐 방지)
  for (const m of Array.from(text.matchAll(/\b([A-Z]{1,5})\b/g))) {
    if (meta[m[1]]) found.add(m[1]);
  }
  // 3) 회사명(영문·한글) 부분일치 — 2자 이상 이름만, 긴 이름 우선
  const lower = text.toLowerCase().replace(/\s+/g, '');
  const names = Array.from(nameToTicker.keys()).filter(n => n.length >= 2).sort((a, b) => b.length - a.length);
  for (const n of names) {
    if (found.size >= max) break;
    if (lower.includes(n)) { const tk = nameToTicker.get(n); if (tk) found.add(tk); }
  }
  return Array.from(found).slice(0, max);
}

export function tickerName(ticker: string): string {
  return getData().meta[ticker]?.name ?? ticker;
}

// ── 종목별 실시간 컨텍스트 수집 (각 fetch non-fatal) ─────────────────────────
async function safeJson(url: string, ms = 6000): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const num = (...v: unknown[]): number | null => {
  for (const x of v) { const n = typeof x === 'string' ? parseFloat(x) : x; if (typeof n === 'number' && isFinite(n)) return n; }
  return null;
};
const pick = (o: Record<string, unknown> | null, ...keys: string[]): unknown => {
  if (!o) return undefined;
  for (const k of keys) { if (o[k] != null) return o[k]; }
  return undefined;
};

export interface TickerCtx {
  ticker: string; name: string; sector?: string; market?: string;
  price?: number | null; changePct?: number | null;
  rsi?: number | null; sma50?: number | null; sma200?: number | null;
  high52w?: number | null; low52w?: number | null;
  roe?: number | null; opMargin?: number | null; revenueGrowth?: number | null; peRatio?: number | null;
  analystTarget?: number | null; rating?: string | null;
  newsSentiment?: string | null; signalsRaw?: unknown;
}

export async function gatherTickerContext(ticker: string, origin: string): Promise<TickerCtx> {
  const { meta } = getData();
  const m = meta[ticker] ?? {};
  const isKr = /\.(KS|KQ)$/.test(ticker);
  const enc = encodeURIComponent(ticker);
  const [batch, signals, fin, news, recs] = await Promise.all([
    safeJson(`${origin}/api/batch-prices?tickers=${enc}`),
    safeJson(`${origin}/api/company-signals/${enc}`),
    isKr ? safeJson(`${origin}/api/company-kr/${enc}`) : safeJson(`${origin}/api/company-financials/${enc}`),
    safeJson(`${origin}/api/company-news/${enc}`, 5000),
    safeJson(`${origin}/api/company-recs/${enc}`, 5000),
  ]);
  const bp = (batch?.prices as Record<string, { price?: number; changePct?: number }>)?.[ticker];
  return {
    ticker, name: m.name ?? ticker, sector: m.sector, market: m.market,
    price: num(bp?.price, pick(signals, 'price'), pick(fin, 'price')),
    changePct: num(bp?.changePct, pick(signals, 'changePct', 'change1d')),
    rsi: num(pick(signals, 'rsi'), pick(fin, 'rsi')),
    sma50: num(pick(signals, 'sma50', 'ma50')),
    sma200: num(pick(signals, 'sma200', 'ma200')),
    high52w: num(pick(signals, 'high52w', 'fiftyTwoWeekHigh'), pick(fin, 'high52w')),
    low52w: num(pick(signals, 'low52w', 'fiftyTwoWeekLow'), pick(fin, 'low52w')),
    roe: num(pick(fin, 'roe', 'roePct')),
    opMargin: num(pick(fin, 'opMargin', 'operatingMarginPct', 'operatingMargin')),
    revenueGrowth: num(pick(fin, 'revenueGrowth', 'revenueYoY')),
    peRatio: num(pick(fin, 'peRatio', 'pe')),
    analystTarget: num(pick(recs, 'targetMean', 'priceTarget', 'target')),
    rating: (pick(recs, 'rating', 'consensus', 'recommendation') as string) ?? null,
    newsSentiment: (pick(news, 'sentiment', 'overallSentiment') as string) ?? null,
    signalsRaw: signals ? { uoa: signals.uoa, burst: signals.burst, contracts: signals.contracts, backlog: signals.backlogYoY } : undefined,
  };
}

function fmtTickerCtx(c: TickerCtx): string {
  const cur = c.market === 'kospi' || c.market === 'kosdaq' || /\.(KS|KQ)$/.test(c.ticker) ? '₩' : '$';
  const L: string[] = [`[${c.name} (${c.ticker})${c.sector ? ' · ' + c.sector : ''}]`];
  const f = (v: number | null | undefined) => v == null ? null : (cur === '₩' ? `${cur}${Math.round(v).toLocaleString('en-US')}` : `${cur}${v.toFixed(2)}`);
  if (c.price != null) L.push(`현재가 ${f(c.price)}${c.changePct != null ? ` (${c.changePct >= 0 ? '+' : ''}${c.changePct}%)` : ''}`);
  if (c.rsi != null) L.push(`RSI ${c.rsi}`);
  if (c.sma50 != null || c.sma200 != null) L.push(`50MA ${f(c.sma50) ?? '?'} / 200MA ${f(c.sma200) ?? '?'}`);
  if (c.high52w != null || c.low52w != null) L.push(`52주 ${f(c.low52w) ?? '?'}~${f(c.high52w) ?? '?'}`);
  if (c.roe != null) L.push(`ROE ${c.roe}%`);
  if (c.opMargin != null) L.push(`영업이익률 ${c.opMargin}%`);
  if (c.revenueGrowth != null) L.push(`매출성장 ${c.revenueGrowth}%`);
  if (c.peRatio != null) L.push(`PER ${c.peRatio}`);
  if (c.analystTarget != null) L.push(`애널 목표가 ${f(c.analystTarget)}`);
  if (c.rating) L.push(`컨센서스 ${c.rating}`);
  if (c.newsSentiment) L.push(`뉴스 ${c.newsSentiment}`);
  return L.join(' · ');
}

// ── doctrine/wisdom/rules 압축 (시스템 프롬프트용) ───────────────────────────
function condenseDoctrine(): string {
  const { doctrine, wisdom } = getData();
  const d = doctrine.map(p => `- ${p.id}: ${p.rule ?? ''}${p.apply ? ` → ${p.apply}` : ''}`).join('\n');
  const w = wisdom.map(p => `- ${p.id}: ${p.rule ?? ''}`).join('\n');
  return `# 심판 원칙 (구루 doctrine — 매도/리스크/진입)\n${d}\n\n# 투자 지혜 (버핏·린치·소로스·코스톨라니)\n${w}`;
}

function condenseRules(): string {
  const { buyRules, sellRules } = getData();
  const fmt = (r: Rule) => `- [${r.category ?? '?'}|+${r.score ?? '?'}] ${r.id}: ${r.description ?? ''}`;
  return `# 매수 룰 (${buyRules.length}개 — 발화 시 매수 점수 가산)\n${buyRules.map(fmt).join('\n')}\n\n# 매도 룰 (${sellRules.length}개 — 발화 시 매도 신호)\n${sellRules.map(fmt).join('\n')}`;
}

export type JudgeMode = 'fast' | 'standard' | 'deep';
export const MODE_OPTS: Record<JudgeMode, { maxTokens: number; temperature: number; preferSmallModel?: boolean; maxTickers: number }> = {
  fast: { maxTokens: 700, temperature: 0.5, preferSmallModel: true, maxTickers: 1 },
  standard: { maxTokens: 1500, temperature: 0.6, maxTickers: 2 },
  deep: { maxTokens: 2600, temperature: 0.65, maxTickers: 3 },
};

const LANG: Record<string, string> = {
  ko: 'Korean', en: 'English', ja: 'Japanese', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
  es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
  id: 'Indonesian', th: 'Thai', tr: 'Turkish', vi: 'Vietnamese',
};

export function buildSystemPrompt(opts: { locale: string; mode: JudgeMode; tickerCtx: TickerCtx[]; reportContext: string }): string {
  const lang = LANG[opts.locale] ?? 'Korean';
  const liveBlock = opts.tickerCtx.length
    ? `# 실시간 종목 데이터 (지금 외부 금융 소스에서 수집)\n${opts.tickerCtx.map(fmtTickerCtx).join('\n')}`
    : '# 실시간 종목 데이터\n(질문에서 특정 종목 미감지 — 일반 전략/원칙 상담)';
  const includeRules = opts.mode !== 'fast';
  return [
    `You are "매수·매도 심판엔진" (the Buy/Sell Judgment Engine) of FlowVium — a disciplined, evidence-grounded investment judgment assistant.`,
    `Respond ENTIRELY in ${lang}. Be concise, structured, and decisive.`,
    ``,
    `## 역할`,
    `- 사용자가 특정 종목의 매수/매도/관망을 상의하면: ① 명확한 판단(매수/분할매수/관망/비중축소/매도/회피 중 하나) ② 근거(아래 룰·원칙과 실시간 데이터를 *인용*) ③ 리스크 ④ (가능하면) 진입/손절 아이디어 순으로.`,
    `- 데이터가 없거나 불확실하면 "데이터 없음"이라고 솔직히 말하라. 절대 수치를 지어내지 마라(환각 금지).`,
    `- 너는 심판엔진이지 보장이 아니다. 답변 끝에 한 줄 면책: 투자 판단·책임은 본인에게 있음.`,
    ``,
    condenseDoctrine(),
    includeRules ? `\n${condenseRules()}` : '',
    ``,
    liveBlock,
    opts.reportContext ? `\n# 오늘의 FlowVium 리포트 맥락\n${opts.reportContext}` : '',
  ].filter(Boolean).join('\n');
}
