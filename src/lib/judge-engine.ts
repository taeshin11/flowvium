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
  // 2) 점 포함 US 클래스주 (BRK.B, BF.B 등) — \b 단어경계가 점을 못 잡아 미감지되던 것 보강
  for (const m of Array.from(text.matchAll(/\b([A-Z]{1,4}\.[A-Z])\b/g))) {
    if (meta[m[1]]) found.add(m[1]);
  }
  // 2b) 명시적 US 티커 (대문자 1~5, 풀에 존재하는 것만 — AI/CEO 등 오탐 방지)
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
  netMargin?: number | null; debtRatio?: number | null; rdPct?: number | null; fcf?: number | null;
  ocf?: number | null; netIncome?: number | null; financingCF?: number | null; // 이익의 질·희석 forensic
  business?: string; industry?: string; products?: string;
  analystTarget?: number | null; rating?: string | null;
  newsSentiment?: string | null; newsHeadlines?: string[]; signalsRaw?: unknown;
}

// Yahoo 일봉 차트 직접 fetch — 가격·전일대비·52주·OHLC closes (US·KR 동일 권위 소스).
//   batch-prices 가 KR 에 null 반환 + quote/price 엔드포인트 부재 사건(2026-06-18) → 리포트 엔진과
//   동일하게 Yahoo v8 chart 직결로 일원화. closes 로 SMA50/200·RSI14 결정론 계산.
async function fetchYahooChart(ticker: string): Promise<{ price: number | null; changePct: number | null; high52w: number | null; low52w: number | null; closes: number[] } | null> {
  try {
    // US 클래스주 포맷 정규화: BRK.B→BRK-B (Yahoo 는 하이픈). KR(.KS/.KQ)은 그대로.
    const yTicker = /\.(KS|KQ)$/.test(ticker) ? ticker : ticker.replace(/\./g, '-');
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yTicker)}?range=1y&interval=1d`;
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
  // Yahoo(가격·52주·기술) + 재무(DART/SEC) + 옵션 UOA + 뉴스 + 사업개요(무슨 사업·업종·주력제품).
  const [yh, signals, fin, newsRes, biz] = await Promise.all([
    fetchYahooChart(ticker),
    safeJson(`${origin}/api/company-signals/${enc}`),
    isKr ? safeJson(`${origin}/api/company-kr/${enc}`) : safeJson(`${origin}/api/company-financials/${enc}`),
    safeJson(`${origin}/api/company-news?ticker=${enc}`),
    safeJson(`${origin}/api/company-business/${enc}`),
  ]);
  const finCore = (fin?.latestAnnual as Record<string, unknown>) ?? fin ?? {};  // 재무는 latestAnnual 중첩
  const closes = yh?.closes ?? [];
  const uoa = Array.isArray(signals?.uoa) ? (signals!.uoa as unknown[]) : [];

  // 재무 보강: R&D 집약도(매출대비)·부채비율·순마진·FCF — DART/SEC 가 주는데 미추출이던 값.
  const rev = num(pick(finCore, 'revenueUSD', 'revenueKRW'));
  const rd = num(pick(finCore, 'rdExpenseUSD', 'rdExpenseKRW'));
  const rdPct = rd != null && rev ? Math.round(rd / rev * 1000) / 10 : null;
  const debtRatio = num(pick(finCore, 'debtRatioPct'));
  const netInc = num(pick(finCore, 'netIncomeUSD', 'netIncomeKRW'));
  const netMargin = num(pick(finCore, 'netMarginPct')) ?? (netInc != null && rev ? Math.round(netInc / rev * 1000) / 10 : null);
  const ocf = num(pick(finCore, 'operatingCFUSD', 'operatingCFKRW'));
  const capex = num(pick(finCore, 'capexUSD', 'capexKRW'));
  const fcf = num(pick(finCore, 'freeCashFlowKRW', 'freeCashFlowUSD')) ?? (ocf != null && capex != null ? ocf - capex : null);
  const financingCF = num(pick(finCore, 'financingCFUSD', 'financingCFKRW'));

  // 뉴스: 엔드포인트가 티커 필터링이 약함(시장 전반 뉴스 혼입) → 회사명/별칭/티커가 제목에 *실제로*
  //   들어간 헤드라인만 채택(무관 뉴스 주입=환각 방지). 매칭 없으면 생략.
  const aliases = (companyNamesI18n[ticker] ?? []).map(a => a.toLowerCase());
  const baseSym = ticker.replace(/\.(KS|KQ)$/, '').toLowerCase();
  const nameToks = String(m.name ?? '').toLowerCase().split(/[\s/]+/).filter(x => x.length >= 3);
  const matchset = Array.from(new Set([baseSym, ...aliases, ...nameToks])).filter(Boolean);
  const newsArr = Array.isArray((newsRes as { news?: unknown[] } | null)?.news) ? (newsRes as { news: Array<{ title?: string }> }).news : [];
  const newsHeadlines = newsArr
    .filter(a => { const t = String(a?.title ?? '').toLowerCase(); return matchset.some(k => t.includes(k)); })
    .slice(0, 3).map(a => String(a.title).slice(0, 90));

  // 사업 개요: 무슨 사업·업종·주력제품 (사용자 '회사가 뭐하는지/업황 조사가 없다').
  const profile = (biz?.profile as Record<string, unknown>) ?? {};
  const bizDesc = String((biz?.desc as string) || (profile.summary as string) || '').slice(0, 280) || undefined;
  const industry = String((profile.industry as string) || (profile.sector as string) || m.sector || '') || undefined;
  const products = String((biz?.products as string) || '') || undefined;

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
    netMargin, debtRatio, rdPct, fcf,
    ocf, netIncome: netInc, financingCF,
    business: bizDesc, industry, products,
    newsHeadlines: newsHeadlines.length ? newsHeadlines : undefined,
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
  // 가격 수집 실패 → 환각 하드 차단. 수치를 채워 넣지 못하도록 명시적 경고 라인만 반환.
  if (c.price == null) {
    return `⚠️ [${c.name} (${c.ticker})${c.sector ? ' · ' + c.sector : ''}] 실시간 데이터 수집 실패 — 이 종목의 가격·RSI·이동평균·52주·ROE 등 어떤 수치도 추정하거나 지어내지 마라. "실시간 데이터를 불러오지 못해 이 종목은 판단을 보류한다"고 답하라.`;
  }
  const L: string[] = [`[${c.name} (${c.ticker})${c.sector ? ' · ' + c.sector : ''}]`];
  if (c.business || c.industry || c.products) L.push(`사업: ${c.business ?? ''}${c.industry ? ` (업종: ${c.industry})` : ''}${c.products ? ` · 주력: ${c.products}` : ''}`);
  const f = (v: number | null | undefined) => v == null ? null : (cur === '₩' ? `${cur}${Math.round(v).toLocaleString('en-US')}` : `${cur}${v.toFixed(2)}`);
  if (c.price != null) L.push(`현재가 ${f(c.price)}${c.changePct != null ? ` (${c.changePct >= 0 ? '+' : ''}${c.changePct}%)` : ''}`);
  if (c.rsi != null) L.push(`RSI ${c.rsi}`);
  if (c.sma50 != null || c.sma200 != null) L.push(`50MA ${f(c.sma50) ?? '?'} / 200MA ${f(c.sma200) ?? '?'}`);
  // 200일선 대비 과대확장 — 추세는 강하나 평균회귀(되돌림) 위험. 추세강함으로만 해석하지 않게 명시.
  if (c.price != null && c.sma200 != null && c.sma200 > 0) {
    const ext = Math.round((c.price / c.sma200 - 1) * 100);
    if (ext >= 60) L.push(`⚠️주가가 200일선보다 +${ext}% 위(과대확장 — 추세는 강하나 평균회귀/되돌림 위험, 무조건 강세로 해석 금지)`);
  }
  if (c.high52w != null || c.low52w != null) L.push(`52주 ${f(c.low52w) ?? '?'}~${f(c.high52w) ?? '?'}`);
  if (c.roe != null) L.push(`ROE ${c.roe}%`);
  if (c.opMargin != null) L.push(`영업이익률 ${c.opMargin}%`);
  if (c.netMargin != null) L.push(`순이익률 ${c.netMargin}%`);
  if (c.revenueGrowth != null) L.push(`매출성장 ${c.revenueGrowth}%`);
  if (c.rdPct != null) L.push(`R&D/매출 ${c.rdPct}%`);
  if (c.debtRatio != null) L.push(`부채비율 ${c.debtRatio}%`);
  if (c.fcf != null) L.push(`FCF ${c.fcf >= 0 ? '흑자(+)' : '적자(−)'}`);
  // 이익의 질: 영업현금흐름 vs 순이익 — OCF가 순이익보다 크게 적으면 이익이 현금으로 안 들어옴(외상매출↑/이익의 질 의심).
  if (c.ocf != null && c.netIncome != null && c.netIncome > 0) {
    const q = c.ocf / c.netIncome;
    // 숫자(%)를 주면 base 모델이 배수로 오독(예: 65%→"938배")하므로 정성 라벨만. ⚠️=약점, ✅=강점 명시.
    const tag = c.ocf < 0 ? '🚫이익의 질 매우 낮음: 영업현금흐름이 적자다(순이익은 흑자라도 현금이 안 들어옴 — 강점 아닌 심각한 약점)'
      : q < 0.6 ? '🚫이익의 질 낮음: 영업현금흐름이 순이익보다 크게 적다(이익이 현금으로 안 들어옴 — 외상매출/일회성 의심, 강점 아닌 약점)'
      : q < 0.85 ? '⚠️이익의 질 다소 낮음: 영업현금흐름이 순이익보다 적다(현금화 미흡 — 강점 아닌 약점)'
      : q >= 1 ? '✅이익의 질 양호: 영업현금흐름이 순이익 이상이다(이익이 현금으로 잘 들어옴 — 강점)'
      : '영업현금흐름이 순이익에 약간 못 미친다(이익의 질 보통)';
    L.push(tag);
  } else if (c.ocf != null && c.ocf < 0) {
    L.push('⚠️영업현금흐름 적자');
  }
  // 재무활동 현금흐름: 큰 +면 자금조달(유상증자/전환사채 → 희석 위험), 큰 −면 상환/배당/자사주.
  if (c.financingCF != null && c.financingCF > 0 && c.ocf != null && c.ocf < Math.abs(c.financingCF)) {
    L.push('⚠️재무활동으로 자금조달 중(유상증자·전환사채 가능성 → 주식 희석 위험)');
  }
  if (c.peRatio != null) L.push(`PER ${c.peRatio}`);
  if (c.analystTarget != null) L.push(`애널 목표가 ${f(c.analystTarget)}`);
  if (c.rating) L.push(`컨센서스 ${c.rating}`);
  if (c.newsSentiment) L.push(`뉴스 ${c.newsSentiment}`);
  const sr = c.signalsRaw as { uoaCount?: number } | undefined;
  if (sr?.uoaCount) L.push(`이상옵션 ${sr.uoaCount}건(UOA)`);
  if (c.newsHeadlines?.length) L.push(`관련 뉴스: ${c.newsHeadlines.map(h => `"${h}"`).join('; ')}`);
  return L.join(' · ');
}

// ── 결정론적 룰 발화 엔진 (매수엔진·매도엔진) — 챗에서 실제 룰을 데이터에 대고 발화·채점 ─────────
//   리포트 파이프라인(generate-report-local.mjs)의 룰 평가를, 챗에서 가용한 TickerCtx+거시 데이터로
//   평가 가능한 부분집합만 결정론 발화. (signals/holdings 의존 룰은 챗 데이터 부재로 미발화=보수적.)
export interface EngineVerdict { buyScore: number; sellScore: number; buy: Array<{ id: string; score: number; desc: string }>; sell: Array<{ id: string; score: number; desc: string }>; }
export function fireRules(c: TickerCtx, macro: { vix?: number | null; fg?: number | null }): EngineVerdict {
  const buy: EngineVerdict['buy'] = [], sell: EngineVerdict['sell'] = [];
  const B = (id: string, score: number, desc: string, cond: boolean) => { if (cond) buy.push({ id, score, desc }); };
  const S = (id: string, score: number, desc: string, cond: boolean) => { if (cond) sell.push({ id, score, desc }); };
  const { price, changePct, rsi, sma50, sma200, high52w, low52w, roe, opMargin, revenueGrowth, peRatio, debtRatio } = c;
  const near = (a?: number | null, b?: number | null, pct = 2) => a != null && b != null && b !== 0 && Math.abs((a - b) / b * 100) <= pct;
  // 매수엔진
  B('price_oversold_gap', 3, '1일 -3%↑ 급락 평균회귀 후보', changePct != null && changePct <= -3);
  B('price_momentum_52w_high', 5, '52주 신고가 3% 이내 추세주도', price != null && high52w != null && (high52w - price) / high52w * 100 <= 3 && price <= high52w * 1.02);
  B('price_support_bounce', 5, '52주 저점 5% 이내 지지반등(Marks 역발상)', price != null && low52w != null && (price - low52w) / low52w * 100 <= 5);
  B('near_50ma', 3, '50일선 ±2% 눌림목', near(price, sma50, 2));
  B('rsi_oversold', 4, 'RSI≤35 과매도', rsi != null && rsi <= 35);
  B('golden_cross', 5, '골든크로스(50MA>200MA)', sma50 != null && sma200 != null && sma50 > sma200);
  B('ma200_reclaim', 4, '200일선 상회(5% 이내)', price != null && sma200 != null && price >= sma200 && (price - sma200) / sma200 * 100 <= 5);
  B('roe_above', 3, 'ROE≥15% 수익성', roe != null && roe >= 15);
  B('buffett_moat', 6, '해자(ROE≥15% & 영업이익률≥20%)', roe != null && roe >= 15 && opMargin != null && opMargin >= 20);
  B('revenue_yoy', 4, '매출성장≥15%', revenueGrowth != null && revenueGrowth >= 15);
  B('lynch_peg', 4, 'PEG≤1 (성장대비 저평가)', peRatio != null && revenueGrowth != null && revenueGrowth > 0 && peRatio / revenueGrowth <= 1);
  B('vix_low', 2, 'VIX≤14 저변동', macro.vix != null && macro.vix <= 14);
  B('fg_recovery', 3, 'F&G 25~50 회복국면', macro.fg != null && macro.fg >= 25 && macro.fg <= 50);
  // 매도엔진
  S('dead_cross', 5, '데드크로스(50MA<200MA)', sma50 != null && sma200 != null && sma50 < sma200);
  S('ma200_breach', 5, '200일선 하향이탈', price != null && sma200 != null && price < sma200);
  S('rsi_overbought', 4, 'RSI≥75 과매수', rsi != null && rsi >= 75);
  S('peg_high', 3, 'PEG≥2 고평가', peRatio != null && revenueGrowth != null && revenueGrowth > 0 && peRatio / revenueGrowth >= 2);
  S('macro_vix_spike', 3, 'VIX≥25 거시 리스크', macro.vix != null && macro.vix >= 25);
  S('fg_extreme_fear', 2, 'F&G≤20 극공포', macro.fg != null && macro.fg <= 20);
  S('high_debt', 2, '부채비율>150% 재무위험', debtRatio != null && debtRatio > 150);
  return { buyScore: buy.reduce((a, b) => a + b.score, 0), sellScore: sell.reduce((a, b) => a + b.score, 0), buy, sell };
}

function fmtEngine(c: TickerCtx, v: EngineVerdict): string {
  if (c.price == null) return '';
  const lean = v.buyScore > v.sellScore + 2 ? '매수 우세' : v.sellScore > v.buyScore + 2 ? '매도 우세' : '팽팽(관망권)';
  const bf = v.buy.length ? v.buy.map(r => `${r.desc}(+${r.score})`).join(', ') : '없음';
  const sf = v.sell.length ? v.sell.map(r => `${r.desc}(+${r.score})`).join(', ') : '없음';
  return `[${c.name} (${c.ticker})] 매수엔진 ${v.buyScore}점 [발화: ${bf}] · 매도엔진 ${v.sellScore}점 [발화: ${sf}] → 룰 종합: ${lean}`;
}

// ── doctrine/wisdom/rules 압축 (시스템 프롬프트용) ───────────────────────────
function condenseDoctrine(): string {
  const { doctrine, wisdom } = getData();
  // 내부 원칙 ID(영문 snake_case)는 답변에 누출되면 난독 → 모델엔 자연어 규칙만 제공(condenseRules 와 동일 정책).
  const d = doctrine.map(p => `- ${p.rule ?? ''}${p.apply ? ` → ${p.apply}` : ''}`).join('\n');
  const w = wisdom.map(p => `- ${p.rule ?? ''}`).join('\n');
  return `# 심판 원칙 (구루 doctrine — 매도/리스크/진입 · 답변엔 영문 ID 쓰지 말고 자연어로)\n${d}\n\n# 투자 지혜 (버핏·린치·소로스·코스톨라니)\n${w}`;
}

function condenseRules(): string {
  const { buyRules, sellRules } = getData();
  // 내부 룰 ID(snake_case)·점수는 사용자 답변에 누출되면 난독 → 모델엔 카테고리+설명만 제공.
  const fmt = (r: Rule) => `- (${r.category ?? '기타'}) ${r.description ?? ''}`;
  return `# 매수 판단 기준 (참고 — 답변엔 ID·점수 쓰지 말고 자연어로 풀어 설명)\n${buyRules.map(fmt).join('\n')}\n\n# 매도 판단 기준 (참고)\n${sellRules.map(fmt).join('\n')}`;
}

// AITS = 심판엔진 본체(룰+doctrine+실시간 금융데이터+오늘 리포트). AITS+RAG = 그 위에
// 버핏 서한/투자 고전 전문에서 의미검색한 구절을 추가 grounding (2026-06-18, 사용자 "AITS / AITS+RAG 로 구분").
// aits-deep(TAISN 심층) = 2-pass: ①사업·업황·전망 리서치 브리프 → ②그 위에 엔진+데이터+구루로 최종판단.
//   환각 줄이려 사실 리서치를 먼저 분리(사용자 '세분화해서 LLM 여러번'). 스트리밍 대신 정밀도↑.
export type JudgeMode = 'aits' | 'aits-rag' | 'aits-deep';
export const MODE_OPTS: Record<JudgeMode, { maxTokens: number; temperature: number; preferSmallModel?: boolean; maxTickers: number; useRag: boolean; deep?: boolean }> = {
  'aits':      { maxTokens: 1800, temperature: 0.6, maxTickers: 3, useRag: false },
  'aits-rag':  { maxTokens: 2600, temperature: 0.6, maxTickers: 3, useRag: true },
  'aits-deep': { maxTokens: 3800, temperature: 0.5, maxTickers: 2, useRag: true, deep: true },
};

// 1-pass(심층): 사업·업황·전망 리서치 브리프 프롬프트. 판단이 아니라 *사실 정리*만.
export function buildResearchPrompt(opts: { locale: string; tickerCtx: TickerCtx[]; macroContext?: string }): string {
  const lang = LANG[opts.locale] ?? 'Korean';
  const data = opts.tickerCtx.length ? opts.tickerCtx.map(fmtTickerCtx).join('\n') : '(특정 종목 미감지)';
  return [
    `You are a sell-side equity research analyst. Write a concise research brief in ${lang}. FACTS ONLY — no buy/sell call yet.`,
    `아래 데이터만 사용하라. 수치를 지어내지 마라(데이터에 없으면 "데이터 없음").`,
    ``,
    `# 작성 항목 (각 항목 2~4문장, 평이한 한국어 — 사실 위주로 충실하게)`,
    `1) 사업 모델: 이 회사가 무슨 사업으로 돈을 버는가, 주력 제품/서비스와 매출 구성 (위 '사업' 데이터 기반).`,
    `2) 업황·사이클: 속한 산업의 현재 사이클 위치(확장/둔화/침체)·경쟁 구도·수요 환경 (업종 + 거시 데이터 연결).`,
    `3) 경쟁 포지션: 이 회사의 해자(브랜드/원가/네트워크/기술)와 경쟁사 대비 위치를 데이터로.`,
    `4) 강세 시나리오: 주가를 끌어올릴 성장 동력·촉매 2~3개 (매출성장·R&D·마진 추세 + 업황 연결).`,
    `5) 약세 시나리오: 핵심 리스크·악재 2~3개 (부채·마진 압박·업황 둔화·밸류 부담).`,
    `6) 핵심 숫자: 밸류(PER)·수익성(ROE/마진)·재무건전성(부채/FCF)·성장(매출 YoY)을 한 줄로.`,
    `7) 이익의 질·자금조달: 데이터에 "영업현금흐름/순이익" 또는 "⚠️" 표시가 있으면 반드시 언급하라 — 순이익이 흑자라도 영업현금흐름이 적자거나 순이익보다 크게 적으면 "이익이 현금으로 안 들어온다(외상매출·일회성 의심)"고 지적하고, 재무활동 자금조달(유상증자·전환사채) 신호가 있으면 주식 희석 리스크로 짚어라. (데이터에 없으면 생략.)`,
    `내부 룰 ID·점수·별표 출력 금지. 매수/매도 결론은 아직 내리지 마라(다음 단계에서 판단).`,
    opts.macroContext ? `\n# 거시 환경\n${opts.macroContext}` : '',
    `\n# 종목 데이터\n${data}`,
  ].filter(Boolean).join('\n');
}

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

export function buildSystemPrompt(opts: { locale: string; mode: JudgeMode; tickerCtx: TickerCtx[]; reportContext: string; ragHits?: RagHit[]; macroContext?: string; macro?: { vix?: number | null; fg?: number | null }; researchBrief?: string }): string {
  const lang = LANG[opts.locale] ?? 'Korean';
  const researchBlock = opts.researchBrief ? `# 📋 사업·업황·전망 리서치 브리프 (1차 분석 — 이 사실 위에서 판단하라)\n${opts.researchBrief}` : '';
  const macroBlock = opts.macroContext ? `# 거시 환경 (실시간: CNN F&G · VIX · CME FedWatch · FRED · 국채금리)\n${opts.macroContext}` : '';
  // 결정론적 룰 발화 엔진(매수엔진·매도엔진) — 종목별 실제 룰 채점. 이게 LLM 의 1차 판단 근거.
  const engineLines = opts.tickerCtx.filter(c => c.price != null).map(c => fmtEngine(c, fireRules(c, opts.macro ?? {}))).filter(Boolean);
  const engineBlock = engineLines.length ? `# ⚙️ 엔진 판정 (매수엔진·매도엔진 결정론적 룰 발화 — 1차 판단 근거)\n${engineLines.join('\n')}` : '';
  const liveBlock = opts.tickerCtx.length
    ? `# 실시간 종목 데이터 (지금 외부 금융 소스에서 수집)\n${opts.tickerCtx.map(fmtTickerCtx).join('\n')}`
    : '# 실시간 종목 데이터\n(질문에서 특정 종목 미감지 — 일반 전략/원칙 상담). ⚠️ 특정 종목명이 언급됐어도 위에 데이터가 없으면 그 종목의 가격·재무·기술 수치를 절대 지어내지 말고 "실시간 데이터를 조회하지 못했다"고 답하라.';
  const ragBlock = opts.ragHits && opts.ragHits.length ? `\n${fmtRagHits(opts.ragHits)}` : '';
  // 심층(aits-deep): 1차 리서치 브리프를 받았으므로 최종 답변을 더 두껍게 — 강세/약세 양립 + 시나리오 + 구체 레벨.
  const deepBlock = opts.mode === 'aits-deep' ? [
    `## 🔬 심층 모드 답변 요건 (이 모드에서만 — 일반 모드보다 깊게)`,
    `위 '리서치 브리프'를 적극 활용해, 다음을 모두 담은 두툼한 분석을 써라(분량을 아끼지 마라):`,
    `- **사업·업황·경쟁 포지션**: 회사가 뭘로 돈 벌고, 업황 사이클 어디에 있고, 경쟁 해자가 있는지 2~3문장.`,
    `- **강세론 vs 약세론 양립 제시**: 살 이유와 팔/피할 이유를 *둘 다* 정직하게 나열한 뒤, 어느 쪽이 더 무거운지 저울질하라(한쪽만 쓰지 마라).`,
    `- **시나리오**: 낙관/비관 두 갈래로 주가가 어떻게 갈지 핵심 변수와 함께 짧게.`,
    `- **결론 + 구체 레벨**: 최종 한 줄 결론 + 가능하면 진입/분할/손절 가격대를 실데이터 기반으로 제시.`,
    `엔진 충실성·환각 금지 규칙은 위와 동일하게 적용. 깊게 쓰되 수치는 주어진 데이터만.`,
    ``,
  ].join('\n') : '';
  return [
    `You are "매수·매도 심판엔진" (the Buy/Sell Judgment Engine) of FlowVium — a disciplined, evidence-grounded investment judgment assistant.`,
    `Respond ENTIRELY in ${lang}. Be concise, structured, and decisive.`,
    ``,
    `## 역할`,
    `- 사용자가 특정 종목의 매수/매도/관망을 상의하면: ① 한 줄 결론(매수/분할매수/관망/비중축소/매도/회피 중 하나) ② 이 회사가 무슨 사업을 하고 업황·전망이 어떤지 한 줄(위 '사업' 데이터 활용) ③ 왜 그렇게 봤는지(엔진 발화 룰+실데이터 중심, 핵심 근거 2~4개) ④ 어떤 데이터를 봤는지 ⑤ 리스크 ⑥ (가능하면) 진입/손절 순으로.`,
    `- 데이터가 없거나 불확실하면 "데이터 없음"이라고 솔직히 말하라. 절대 수치를 지어내지 마라(환각 금지).`,
    `- 너는 심판엔진이지 보장이 아니다. 답변 끝에 한 줄 면책: 투자 판단·책임은 본인에게 있음.`,
    ``,
    `## ⚙️ 3대 엔진이 1차 근거 (구루보다 우선)`,
    `- 위 "엔진 판정"의 **매수엔진 점수 vs 매도엔진 점수**가 판단의 1차 축이다. 매수 우세→매수/분할매수 쪽, 매도 우세→비중축소/매도 쪽, 팽팽→관망. 발화한 룰(예: 골든크로스·ROE≥15·200일선 이탈)을 우리말로 풀어 근거로 제시하라.`,
    `- **심판엔진 = 매수엔진·매도엔진 점수 + 실시간 데이터 + 거시 + 리포트를 종합**해 최종 한 줄 결론을 내린다. 엔진 점수와 결론이 어긋나면 그 이유를 대라.`,
    `- ⚠️ 엔진 판정(룰 발화)과 실데이터를 *먼저* 제시하라. 답을 구루 어록으로 도배하지 마라.`,
    `- 🔒 엔진 충실성: "엔진 판정"의 점수와 발화 룰은 위에 *주어진 그대로* 인용하라. 주어지지 않은 룰을 네 멋대로 "발화했다"고 만들지 마라(예: 매도엔진 0점인데 "매도 신호 발동"이라 쓰면 틀림). 점수가 매수 우세인데 결론이 매도면 그 근거(펀더멘털·업황)를 명확히 대라.`,
    `- 🔒 데이터 충실성: 이익의 질·현금흐름·밸류 등은 위 실시간 데이터의 라벨을 *글자 그대로* 따르라. 🚫·⚠️ 로 시작하는 항목은 *약점/위험신호*다 — 절대 장점("뛰어남","양호")으로 뒤집어 쓰지 마라. ✅ 로 시작해야 강점이다. 데이터에 없는 배수·비율(예: "몇 배","몇 %")을 스스로 만들어내지 마라 — 라벨에 적힌 표현만 사용하라.`,
    ``,
    `## 🎓 구루는 보조 해석 (1~2명만, 핵심만)`,
    `- 엔진 판정을 *보강·반박*하는 용도로 **가장 관련 깊은 구루 1~2명만** 인용하라(전원 나열 금지). 종목 성격에 맞게: 가치주→버핏·클라만, 성장주→린치·드러켄밀러, 경기순환주→코스톨라니·막스, 추세/리스크→폴튜더존스·소로스.`,
    `- 내부 원칙 인덱스(P6, P11 등)·영문 ID 출력 금지 — 구루 이름 + 평이한 한국어로.`,
    `- ⚖️ **일관성**: 인용한 구루 렌즈가 최종 결론과 모순되면 안 된다(렌즈가 매도를 시사하면 결론도 매도 쪽).`,
    `- 🎯 **질문자 입장 직답**: "팔아?"는 *보유자*의 매도 질문 → "지금 팔아라 / 비중 줄여라 / 버텨라" 직답. 매수 손절선 프레임으로 새지 마라.`,
    ``,
    `## 답변 형식 (반드시 지켜라 — 일반 투자자가 읽는다)`,
    `- 평이한 한국어로, 친절한 애널리스트가 말하듯 자연스럽게 풀어 써라.`,
    `- ⛔ 내부 룰 ID(영문 snake_case, 예: price_momentum_52w_high, guru_buffett_moat)·점수 표기(+4, +5)·별표 태그(*xxx*)를 절대 출력하지 마라. 그 의미를 *우리말로 풀어서* 설명하라 (예: "price_momentum_52w_high (+5)" ❌ → "주가가 52주 신고가 부근이라 추세가 강합니다" ✅).`,
    `- 근거마다 실제 수치를 곁들여 구체적으로 (예: "ROE 18.5%로 업종 평균을 웃돌아 수익성이 탄탄"). 단, 위 실시간 데이터에 있는 값만 사용.`,
    `- "고려한 데이터" 한 줄로 무엇을 봤는지 투명하게 (예: 현재가·RSI·52주 위치·ROE·시장 변동성(VIX) 등).`,
    `- 굵은 글씨는 핵심 1~2개만. 표·코드블록·영문 식별자 나열 금지.`,
    `- 🚨 데이터 무결성: 위 실시간 데이터에 "⚠️ 수집 실패"로 표시된 종목은 가격·RSI·이동평균·52주·ROE·거래량·뉴스 등 어떤 수치도 절대 만들어내지 마라. 그 종목은 "실시간 데이터를 불러오지 못해 판단을 보류한다"고 솔직히 답하고, 일반 원칙 안내만 하라. 없는 데이터를 추정·창작하는 것은 가장 심각한 오류다.`,
    ``,
    deepBlock,
    condenseDoctrine(),
    `\n${condenseRules()}`,
    ragBlock,
    ``,
    researchBlock,
    engineBlock,
    macroBlock,
    liveBlock,
    opts.reportContext ? `\n# 오늘의 FlowVium 리포트 맥락\n${opts.reportContext}` : '',
  ].filter(Boolean).join('\n');
}
