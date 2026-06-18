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

// Yahoo 일봉 차트 직접 fetch — 가격·전일대비·52주·OHLC closes (US·KR 동일 권위 소스).
//   batch-prices 가 KR 에 null 반환 + quote/price 엔드포인트 부재 사건(2026-06-18) → 리포트 엔진과
//   동일하게 Yahoo v8 chart 직결로 일원화. closes 로 SMA50/200·RSI14 결정론 계산.
async function fetchYahooChart(ticker: string): Promise<{ price: number | null; changePct: number | null; high52w: number | null; low52w: number | null; closes: number[] } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0' }, cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json() as { chart?: { result?: Array<{ meta?: Record<string, number>; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } };
    const res = d?.chart?.result?.[0];
    if (!res?.meta) return null;
    const meta = res.meta;
    const closes = (res.indicators?.quote?.[0]?.close ?? []).filter((v): v is number => typeof v === 'number' && v > 0);
    const price = num(meta.regularMarketPrice);
    // 일간 변동률: range=1y 의 meta.chartPreviousClose 는 range 시작 이전(최대 1년 전) 종가라
    //   부정확(NVDA "+42% 급등" 가짜 변동률 사건 2026-06-18). closes 배열의 직전 거래일 종가로 계산.
    const prevDay = closes.length >= 2 ? closes[closes.length - 2] : num(meta.chartPreviousClose);
    return {
      price,
      changePct: price != null && prevDay ? parseFloat(((price - prevDay) / prevDay * 100).toFixed(2)) : null,
      high52w: num(meta.fiftyTwoWeekHigh),
      low52w: num(meta.fiftyTwoWeekLow),
      closes,
    };
  } catch { return null; }
}

function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const slice = closes.slice(-n);
  return Math.round(slice.reduce((a, b) => a + b, 0) / n * 100) / 100;
}
function rsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let gain = 0, loss = 0;
  const s = closes.slice(-15);
  for (let i = 1; i < s.length; i++) { const ch = s[i] - s[i - 1]; if (ch >= 0) gain += ch; else loss -= ch; }
  if (gain + loss === 0) return 50;
  const rs = (gain / 14) / ((loss / 14) || 1e-9);
  return Math.round(100 - 100 / (1 + rs));
}

export async function gatherTickerContext(ticker: string, origin: string): Promise<TickerCtx> {
  const { meta } = getData();
  const m = meta[ticker] ?? {};
  const isKr = /\.(KS|KQ)$/.test(ticker);
  const enc = encodeURIComponent(ticker);
  // Yahoo(가격·52주·기술) + 재무(DART KR / SEC US) + 옵션 UOA(US). news/recs 는 경로·shape 불일치라 제외.
  const [yh, signals, fin] = await Promise.all([
    fetchYahooChart(ticker),
    safeJson(`${origin}/api/company-signals/${enc}`),
    isKr ? safeJson(`${origin}/api/company-kr/${enc}`) : safeJson(`${origin}/api/company-financials/${enc}`),
  ]);
  const finCore = (fin?.latestAnnual as Record<string, unknown>) ?? fin ?? {};  // 재무는 latestAnnual 중첩
  const closes = yh?.closes ?? [];
  const uoa = Array.isArray(signals?.uoa) ? (signals!.uoa as unknown[]) : [];
  return {
    ticker, name: m.name ?? ticker, sector: m.sector, market: m.market,
    price: yh?.price ?? null,
    changePct: yh?.changePct ?? null,
    rsi: rsi14(closes),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    high52w: yh?.high52w ?? null,
    low52w: yh?.low52w ?? null,
    roe: num(pick(finCore, 'roePct', 'roe')),
    opMargin: num(pick(finCore, 'operatingMarginPct', 'operatingMargin', 'opMargin')),
    revenueGrowth: num(pick(fin, 'revenueYoYPct', 'revenueYoY', 'revenueGrowth'), pick(finCore, 'revenueYoYPct', 'revenueYoY')),
    peRatio: num(pick(finCore, 'peRatio', 'pe')),
    analystTarget: null,
    rating: null,
    newsSentiment: null,
    signalsRaw: uoa.length ? { uoaCount: uoa.length, topUoa: uoa.slice(0, 3) } : undefined,
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
  const sr = c.signalsRaw as { uoaCount?: number } | undefined;
  if (sr?.uoaCount) L.push(`이상옵션 ${sr.uoaCount}건(UOA)`);
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
  // 내부 룰 ID(snake_case)·점수는 사용자 답변에 누출되면 난독 → 모델엔 카테고리+설명만 제공.
  const fmt = (r: Rule) => `- (${r.category ?? '기타'}) ${r.description ?? ''}`;
  return `# 매수 판단 기준 (참고 — 답변엔 ID·점수 쓰지 말고 자연어로 풀어 설명)\n${buyRules.map(fmt).join('\n')}\n\n# 매도 판단 기준 (참고)\n${sellRules.map(fmt).join('\n')}`;
}

// AITS = 심판엔진 본체(룰+doctrine+실시간 금융데이터+오늘 리포트). AITS+RAG = 그 위에
// 버핏 서한/투자 고전 전문에서 의미검색한 구절을 추가 grounding (2026-06-18, 사용자 "AITS / AITS+RAG 로 구분").
export type JudgeMode = 'aits' | 'aits-rag';
export const MODE_OPTS: Record<JudgeMode, { maxTokens: number; temperature: number; preferSmallModel?: boolean; maxTickers: number; useRag: boolean }> = {
  'aits':     { maxTokens: 1800, temperature: 0.6, maxTickers: 3, useRag: false },
  'aits-rag': { maxTokens: 2600, temperature: 0.6, maxTickers: 3, useRag: true },
};

const LANG: Record<string, string> = {
  ko: 'Korean', en: 'English', ja: 'Japanese', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
  es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
  id: 'Indonesian', th: 'Thai', tr: 'Turkish', vi: 'Vietnamese',
};

import type { RagHit } from '@/lib/rag';

function fmtRagHits(hits: RagHit[]): string {
  const body = hits.map((h, i) => {
    const cite = [h.source, h.year].filter(Boolean).join(' ');
    return `[${i + 1}] (${cite}, 유사도 ${h.score.toFixed(2)})\n"${h.text.trim().slice(0, 700)}"`;
  }).join('\n\n');
  return `# 관련 원전 인용 (버핏 서한·투자 고전 — 의미검색 RAG)\n아래는 질문과 의미적으로 가까운 실제 원문 구절이다. 판단의 *철학적 근거*로 인용하되, 수치/사실은 위 실시간 데이터를 우선하라.\n\n${body}`;
}

export function buildSystemPrompt(opts: { locale: string; mode: JudgeMode; tickerCtx: TickerCtx[]; reportContext: string; ragHits?: RagHit[] }): string {
  const lang = LANG[opts.locale] ?? 'Korean';
  const liveBlock = opts.tickerCtx.length
    ? `# 실시간 종목 데이터 (지금 외부 금융 소스에서 수집)\n${opts.tickerCtx.map(fmtTickerCtx).join('\n')}`
    : '# 실시간 종목 데이터\n(질문에서 특정 종목 미감지 — 일반 전략/원칙 상담)';
  const ragBlock = opts.ragHits && opts.ragHits.length ? `\n${fmtRagHits(opts.ragHits)}` : '';
  return [
    `You are "매수·매도 심판엔진" (the Buy/Sell Judgment Engine) of FlowVium — a disciplined, evidence-grounded investment judgment assistant.`,
    `Respond ENTIRELY in ${lang}. Be concise, structured, and decisive.`,
    ``,
    `## 역할`,
    `- 사용자가 특정 종목의 매수/매도/관망을 상의하면: ① 한 줄 결론(매수/분할매수/관망/비중축소/매도/회피 중 하나) ② 왜 그렇게 봤는지(핵심 근거 2~4개) ③ 어떤 데이터를 봤는지 ④ 리스크 ⑤ (가능하면) 진입/손절 순으로.`,
    `- 데이터가 없거나 불확실하면 "데이터 없음"이라고 솔직히 말하라. 절대 수치를 지어내지 마라(환각 금지).`,
    `- 너는 심판엔진이지 보장이 아니다. 답변 끝에 한 줄 면책: 투자 판단·책임은 본인에게 있음.`,
    ``,
    `## 답변 형식 (반드시 지켜라 — 일반 투자자가 읽는다)`,
    `- 평이한 한국어로, 친절한 애널리스트가 말하듯 자연스럽게 풀어 써라.`,
    `- ⛔ 내부 룰 ID(영문 snake_case, 예: price_momentum_52w_high, guru_buffett_moat)·점수 표기(+4, +5)·별표 태그(*xxx*)를 절대 출력하지 마라. 그 의미를 *우리말로 풀어서* 설명하라 (예: "price_momentum_52w_high (+5)" ❌ → "주가가 52주 신고가 부근이라 추세가 강합니다" ✅).`,
    `- 근거마다 실제 수치를 곁들여 구체적으로 (예: "ROE 18.5%로 업종 평균을 웃돌아 수익성이 탄탄"). 단, 위 실시간 데이터에 있는 값만 사용.`,
    `- "고려한 데이터" 한 줄로 무엇을 봤는지 투명하게 (예: 현재가·RSI·52주 위치·ROE·시장 변동성(VIX) 등).`,
    `- 굵은 글씨는 핵심 1~2개만. 표·코드블록·영문 식별자 나열 금지.`,
    ``,
    condenseDoctrine(),
    `\n${condenseRules()}`,
    ragBlock,
    ``,
    liveBlock,
    opts.reportContext ? `\n# 오늘의 FlowVium 리포트 맥락\n${opts.reportContext}` : '',
  ].filter(Boolean).join('\n');
}
