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
// 2026-06-19 엔진 통합: 매수/매도 룰 평가기 단일 소스(보고서와 공유). 챗도 보고서의 자동튜닝 룰을 사용.
import { scoreBuy, scoreSell, adjudicate, hasHardSell, type EngineCtx } from '@/lib/buy-sell-engine';

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
  // 2c) 소문자/단일토큰 티커 — "nke","ko","aapl" 처럼 소문자나 동사없이 티커만 친 경우(2026-06-18 NKE 사건).
  //   문장 오탐 방지 위해: ① 메시지가 짧은 단일 토큰이면 통째로, ② 그 외엔 토큰별 대문자화해 meta 존재 시만.
  const trimmedTok = text.trim().toUpperCase();
  if (/^[A-Z]{1,5}$/.test(trimmedTok) && meta[trimmedTok]) found.add(trimmedTok);
  if (found.size < max) {
    for (const m of Array.from(text.matchAll(/\b([a-zA-Z]{2,5})\b/g))) {
      const up = m[1].toUpperCase();
      if (meta[up] && !/^(THE|AND|FOR|ARE|YOU|BUY|SELL|ETF|CEO|USD|KRW)$/.test(up)) found.add(up);
      if (found.size >= max) break;
    }
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
  high52w?: number | null; low52w?: number | null; high20d?: number | null; // high20d: 20일 신고가(돌파 룰)
  volRatio?: number | null; relVol?: number | null; // 거래량: 최근5일/직전30일, 당일/20일평균 (매수·매도엔진 발화)
  roe?: number | null; opMargin?: number | null; revenueGrowth?: number | null; peRatio?: number | null;
  netMargin?: number | null; debtRatio?: number | null; rdPct?: number | null; fcf?: number | null;
  ocf?: number | null; netIncome?: number | null; financingCF?: number | null; // 이익의 질·희석 forensic
  fiscalYear?: string | null; // 재무 데이터 회계연도(연도 환각 방지 — "2024년" 추정 차단)
  business?: string; industry?: string; products?: string;
  analystTarget?: number | null; rating?: string | null;
  newsSentiment?: string | null; newsHeadlines?: string[]; signalsRaw?: unknown;
  recentDisclosures?: string[] | null; // 최근 material DART 공시(수주·증자·실적 등) — deep 모드 KR (2026-06-19)
  filing?: FilingCtx | null; // 사업보고서 본문(DART/SEC) — 심층 모드에서만 적재
  accumulation?: { tier: string | null; phase: string | null; score: number | null; fewAccount: boolean; surveillance: string | null; flags: string[] } | null;
}
export interface FilingCtx {
  form?: string | null; filedDate?: string | null; market?: string | null;
  overview?: string | null; products?: string | null; salesMix?: string | null;
  rnd?: string | null; risk?: string | null; mdna?: string | null; resaleRatio?: number | null;
}

// Yahoo 일봉 차트 직접 fetch — 가격·전일대비·52주·OHLC closes (US·KR 동일 권위 소스).
//   batch-prices 가 KR 에 null 반환 + quote/price 엔드포인트 부재 사건(2026-06-18) → 리포트 엔진과
//   동일하게 Yahoo v8 chart 직결로 일원화. closes 로 SMA50/200·RSI14 결정론 계산.
async function fetchYahooChart(ticker: string): Promise<{ price: number | null; changePct: number | null; high52w: number | null; low52w: number | null; closes: number[]; volumes: number[] } | null> {
  try {
    // US 클래스주 포맷 정규화: BRK.B→BRK-B (Yahoo 는 하이픈). KR(.KS/.KQ)은 그대로.
    const yTicker = /\.(KS|KQ)$/.test(ticker) ? ticker : ticker.replace(/\./g, '-');
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yTicker)}?range=1y&interval=1d`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0' }, cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json() as { chart?: { result?: Array<{ meta?: Record<string, number>; indicators?: { quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }> } }> } };
    const res = d?.chart?.result?.[0];
    if (!res?.meta) return null;
    const meta = res.meta;
    const closes = (res.indicators?.quote?.[0]?.close ?? []).filter((v): v is number => typeof v === 'number' && v > 0);
    // 거래량 배열(2026-06-19, 사용자 "매수/매도엔진에 거래량도 들어가지?"). null/0 은 휴장/결측 → 그대로 두되
    //   ratio 계산 시 0 제외. closes 와 인덱스 정렬 위해 동일 길이 유지 후 signal 계산에서 필터.
    const volumes = (res.indicators?.quote?.[0]?.volume ?? []).map(v => (typeof v === 'number' && v > 0 ? v : 0));
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
      volumes,
    };
  } catch { return null; }
}

// 거래량 신호 — recent(최근 5일 평균) vs prior(직전 ~30일 평균) 비율 + 당일 상대거래량. 매수/매도엔진 발화용.
function volSignals(volumes: number[]): { volRatio: number | null; relVol: number | null } {
  const vs = (volumes ?? []).filter(v => v > 0);
  if (vs.length < 15) return { volRatio: null, relVol: null };
  const recent = vs.slice(-5);
  const prior = vs.slice(-35, -5);
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const recentAvg = avg(recent), priorAvg = avg(prior);
  const base20 = avg(vs.slice(-21, -1)); // 당일 제외 직전 20일 평균
  return {
    volRatio: priorAvg > 0 ? parseFloat((recentAvg / priorAvg).toFixed(2)) : null,   // 최근 5일 vs 직전 30일
    relVol: base20 > 0 ? parseFloat((vs[vs.length - 1] / base20).toFixed(2)) : null,  // 당일 vs 20일 평균
  };
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

// 최근 material DART 공시 — 수주/공급계약·증자·실적·배당·합병 등(routine 임원소유·정기보고서 제외). deep 모드 KR.
//   2026-06-19(사용자 "deep 답변 generic — 더 자세히 긁어와"): 사업보고서 본문은 과거, 공시는 *최신 catalyst*.
let _corpCodes: Record<string, { corpCode?: string }> | null = null;
function _corpCodeFor(ticker: string): string | null {
  const code6 = ticker.replace(/\.(KS|KQ)$/, '');
  if (!/^\d{6}$/.test(code6)) return null;
  if (!_corpCodes) _corpCodes = loadJson<Record<string, { corpCode?: string }>>('data/dart-corp-codes.json') ?? {};
  return _corpCodes[code6]?.corpCode ?? null;
}
const _MATERIAL_DISCLOSURE = /공급계약|수주|유상증자|무상증자|전환사채|신주인수권|실적|손익구조|현금[·ㆍ]?\s*현물배당|자기주식|합병|분할|영업양수|최대주주|투자판단|특허|임상|품목허가|국책과제/;
async function fetchDartDisclosures(ticker: string): Promise<string[] | null> {
  try {
    const corp = _corpCodeFor(ticker);
    const key = process.env.DART_API_KEY;
    if (!corp || !key) return null;
    const bgn = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
    const r = await fetch(`https://opendart.fss.or.kr/api/list.json?crtfc_key=${key}&corp_code=${corp}&bgn_de=${bgn}&page_count=30`, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json() as { status?: string; list?: Array<{ rcept_dt?: string; report_nm?: string }> };
    if (d.status !== '000' || !Array.isArray(d.list)) return null;
    const out: string[] = []; const seen = new Set<string>();
    for (const x of d.list) {
      const nm = (x.report_nm ?? '').replace(/ㆍ/g, '·').trim();
      if (!_MATERIAL_DISCLOSURE.test(nm)) continue;
      const k = nm.replace(/\s/g, '').slice(0, 18);
      if (seen.has(k)) continue; seen.add(k);
      const dt = (x.rcept_dt ?? '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
      out.push(`${dt} ${nm}`);
      if (out.length >= 5) break;
    }
    return out.length ? out : null;
  } catch { return null; }
}

export async function gatherTickerContext(ticker: string, origin: string, opts?: { withFiling?: boolean }): Promise<TickerCtx> {
  const { meta } = getData();
  const m = meta[ticker] ?? {};
  const isKr = /\.(KS|KQ)$/.test(ticker);
  const enc = encodeURIComponent(ticker);
  // Yahoo(가격·52주·기술) + 재무(DART/SEC) + 옵션 UOA + 뉴스 + 사업개요(무슨 사업·업종·주력제품)
  //   + (심층) 사업보고서 본문 섹션(filings DB — 제품/상품 매출·연구개발·전망).
  const [yh, signals, fin, newsRes, biz, filingRes, manipRes, disclosures] = await Promise.all([
    fetchYahooChart(ticker),
    safeJson(`${origin}/api/company-signals/${enc}`),
    isKr ? safeJson(`${origin}/api/company-kr/${enc}`) : safeJson(`${origin}/api/company-financials/${enc}`),
    safeJson(`${origin}/api/company-news?ticker=${enc}`),
    safeJson(`${origin}/api/company-business/${enc}`),
    opts?.withFiling ? safeJson(`${origin}/api/company-filing/${enc}?ondemand=1`, 28000) : Promise.resolve(null),
    safeJson(`${origin}/api/manipulation-risk/${enc}`),  // 소수계좌 거래집중·매집(accumulation) 공식 surveillance
    (opts?.withFiling && isKr) ? fetchDartDisclosures(ticker) : Promise.resolve(null),  // deep KR: 최신 material 공시(수주 등)
  ]);
  const filing = (filingRes?.filing as FilingCtx | undefined) ?? null;
  // 작전주/매집 신호: 소수계좌 거래집중(KRX surveillance)·매집 phase — "소수계좌 매집 있나" 류 질문 직답용.
  const sv = manipRes?.surveillance as { fewAccount?: boolean; leadLag?: string; category?: string; reason?: string | null; designatedDate?: string | null } | undefined;
  const accumulation = (manipRes && (manipRes.tier || sv)) ? {
    tier: (manipRes.tier as string) ?? null, phase: (manipRes.phase as string) ?? null, score: (manipRes.score as number) ?? null,
    fewAccount: !!sv?.fewAccount, surveillance: sv ? `${sv.category ?? ''}${sv.fewAccount ? '·소수계좌집중' : ''}${sv.leadLag ? `(${sv.leadLag === 'leading' ? '사전' : '사후'})` : ''}${sv.designatedDate ? ` [${sv.designatedDate}]` : ''}` : null,
    flags: Array.isArray(manipRes.flags) ? (manipRes.flags as string[]).slice(0, 3) : [],
  } : null;
  const finCore = (fin?.latestAnnual as Record<string, unknown>) ?? fin ?? {};  // 재무는 latestAnnual 중첩
  const closes = yh?.closes ?? [];
  const uoa = Array.isArray(signals?.uoa) ? (signals!.uoa as unknown[]) : [];

  // 재무 보강: R&D 집약도(매출대비)·부채비율·순마진·FCF — DART/SEC 가 주는데 미추출이던 값.
  // 🔑 통화 단위 일관성: DART(KR)=KRW만 보장, SEC(US)=USD. 필드마다 USD/KRW를 따로 고르면 비율(이익의 질 등)이
  //   단위혼선으로 깨진다 — 2026-06-18 제주반도체: ocf=KRW(25.5B), netIncome=USD(27M) → 938배 환각.
  //   같은 통화로 통일(KR→KRW 우선, US→USD 우선)해서 모든 파생비율을 같은 단위로 계산한다.
  const U = isKr ? 'KRW' : 'USD';
  const money = (base: string) => num(pick(finCore, `${base}${U}`, `${base}KRW`, `${base}USD`));
  const rev = money('revenue');
  const rd = money('rdExpense');
  const rdPct = rd != null && rev ? Math.round(rd / rev * 1000) / 10 : null;
  const debtRatio = num(pick(finCore, 'debtRatioPct'));
  const netInc = money('netIncome');
  const netMargin = num(pick(finCore, 'netMarginPct')) ?? (netInc != null && rev ? Math.round(netInc / rev * 1000) / 10 : null);
  const ocf = money('operatingCF');
  const capex = money('capex');
  const fcf = num(pick(finCore, `freeCashFlow${U}`, 'freeCashFlowKRW', 'freeCashFlowUSD')) ?? (ocf != null && capex != null ? ocf - capex : null);
  const financingCF = money('financingCF');

  // 뉴스: 엔드포인트가 티커 필터링이 약함(시장 전반 뉴스 혼입) → 회사명/별칭/티커가 제목에 *실제로*
  //   들어간 헤드라인만 채택(무관 뉴스 주입=환각 방지). 매칭 없으면 생략.
  const aliases = (companyNamesI18n[ticker] ?? []).map(a => a.toLowerCase());
  const baseSym = ticker.replace(/\.(KS|KQ)$/, '').toLowerCase();
  const nameToks = String(m.name ?? '').toLowerCase().split(/[\s/]+/).filter(x => x.length >= 3);
  const matchset = Array.from(new Set([baseSym, ...aliases, ...nameToks])).filter(Boolean);
  const newsArr = Array.isArray((newsRes as { news?: unknown[] } | null)?.news) ? (newsRes as { news: Array<{ title?: string }> }).news : [];
  const newsHeadlines = newsArr
    .filter(a => { const t = String(a?.title ?? '').toLowerCase(); return matchset.some(k => t.includes(k)); })
    .slice(0, 8).map(a => String(a.title).slice(0, 100));  // 2026-06-19: 3→8 (deep 답변 catalyst 풍부화)

  // 사업 개요: 무슨 사업·업종·주력제품 (사용자 '회사가 뭐하는지/업황 조사가 없다').
  const profile = (biz?.profile as Record<string, unknown>) ?? {};
  const bizDesc = String((biz?.desc as string) || (profile.summary as string) || '').slice(0, 280) || undefined;
  const industry = String((profile.industry as string) || (profile.sector as string) || m.sector || '') || undefined;
  const products = String((biz?.products as string) || '') || undefined;

  return {
    // 회사명: company-business(권위 SEC/큐레이션 name) 우선 → meta → ticker. (FTNT="FortiGate Firewalls" 제품명 오표기 fix)
    ticker, name: (typeof biz?.name === 'string' && biz.name.trim() ? biz.name.trim() : (m.name ?? ticker)), sector: m.sector, market: m.market,
    price: yh?.price ?? null,
    changePct: yh?.changePct ?? null,
    rsi: rsi14(closes),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    high52w: yh?.high52w ?? null,
    low52w: yh?.low52w ?? null,
    // 20일 신고가: *직전* 20완료봉(당일 종가 제외) — 당일 포함 시 price>high20d 불가라 돌파룰 死(2026-06-19 ChatGPT 지적).
    high20d: closes.length >= 21 ? Math.max(...closes.slice(-21, -1)) : null,
    ...volSignals(yh?.volumes ?? []),  // volRatio(최근5/직전30) · relVol(당일/20일) — 매수·매도엔진 거래량 발화

    roe: num(pick(finCore, 'roePct', 'roe')),
    opMargin: num(pick(finCore, 'operatingMarginPct', 'operatingMargin', 'opMargin')),
    netMargin, debtRatio, rdPct, fcf,
    ocf, netIncome: netInc, financingCF, filing, accumulation,
    fiscalYear: (finCore.fiscalYear ?? finCore.fy ?? fin?.fiscalYear) ? String(finCore.fiscalYear ?? finCore.fy ?? fin?.fiscalYear) : null,
    business: bizDesc, industry, products,
    newsHeadlines: newsHeadlines.length ? newsHeadlines : undefined,
    recentDisclosures: disclosures,  // deep KR 최신 material 공시(수주·증자·실적)
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
  // 거래량 수급(2026-06-19): 최근5/직전30 배율 + 당일/20일 상대거래량. 가격 신호의 신뢰도(수급 동반 여부) 근거.
  if (c.volRatio != null) L.push(`거래량 추세 ${c.volRatio}배(최근5일/직전30일)${c.relVol != null ? ` · 당일 ${c.relVol}배(20일평균 대비)` : ''}${c.volRatio >= 1.5 ? ' — 수급 유입' : c.volRatio <= 0.5 ? ' — 거래량 고갈' : ''}`);
  if (c.fiscalYear) L.push(`재무 회계연도 FY${c.fiscalYear}(이 연도로만 표기, 임의 연도 금지)`);
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
  // 소수계좌 거래집중·매집(작전주 선행 surveillance) — "소수계좌 매집 있나" 질문 직답 근거.
  const ac = c.accumulation;
  if (ac) {
    if (ac.fewAccount || ac.surveillance) L.push(`🚨 거래소 소수계좌/시장경보: ${ac.surveillance ?? '소수계좌 거래집중'}`);
    else L.push('소수계좌 거래집중 경보 없음(거래소 시장경보 미지정)');
    if (ac.phase === 'accumulation') L.push(`매집(accumulation) 단계 의심 (매집점수 ${ac.score ?? '?'}, ${ac.tier ?? ''})`);
    else if (ac.phase === 'markup') L.push('이미 상승(markup) 단계');
    if (ac.flags?.length) L.push(`작전주 신호: ${ac.flags.join('; ')}`);
  }
  if (c.newsHeadlines?.length) L.push(`관련 뉴스: ${c.newsHeadlines.map(h => `"${h}"`).join('; ')}`);
  if (c.recentDisclosures?.length) L.push(`📋 최근 공시(DART, 최신 catalyst): ${c.recentDisclosures.join(' / ')}`);
  return L.join(' · ');
}

// 사업보고서 본문(DART/SEC) 섹션 — 심층 모드에서 사업의 내용·제품vs상품매출·연구개발·전망 근거.
function fmtFiling(c: TickerCtx): string {
  const f = c.filing;
  if (!f) return '';
  const head = `[${c.name} (${c.ticker})] 사업보고서 본문 (${f.form ?? '정기보고서'}${f.filedDate ? `, ${f.filedDate}` : ''})`;
  const parts: string[] = [];
  if (f.overview) parts.push(`■ 사업의 내용/시장: ${f.overview}`);
  if (f.products) parts.push(`■ 주요 제품/서비스: ${f.products}`);
  if (f.salesMix) parts.push(`■ 매출 구성(제품=자체생산 vs 상품=되팔기): ${f.salesMix}`);
  if (f.resaleRatio != null) parts.push(`■ 되팔기(상품매출) 비중 ≈ ${Math.round(f.resaleRatio * 100)}% ${f.resaleRatio >= 0.4 ? '(자체생산 비중 낮음 — 부가가치·해자 약점)' : '(대부분 자체생산)'}`);
  if (f.rnd) parts.push(`■ 연구개발활동: ${f.rnd}`);
  if (f.mdna) parts.push(`■ 경영진 분석(MD&A): ${f.mdna}`);
  if (f.risk) parts.push(`■ 리스크 요인: ${f.risk}`);
  if (!parts.length) return '';
  return `${head}\n${parts.join('\n')}`;
}

// ── 결정론적 룰 발화 엔진 (매수엔진·매도엔진) — 챗에서 실제 룰을 데이터에 대고 발화·채점 ─────────
//   리포트 파이프라인(generate-report-local.mjs)의 룰 평가를, 챗에서 가용한 TickerCtx+거시 데이터로
//   평가 가능한 부분집합만 결정론 발화. (signals/holdings 의존 룰은 챗 데이터 부재로 미발화=보수적.)
export interface EngineVerdict { buyScore: number; sellScore: number; buy: Array<{ id: string; score: number; desc: string }>; sell: Array<{ id: string; score: number; desc: string }>; }
export function fireRules(c: TickerCtx, macro: { vix?: number | null; fg?: number | null }): EngineVerdict {
  // 2026-06-19 엔진 통합(사용자 "보고서 엔진이 더 정확하니 그쪽으로 통합"): 챗도 보고서와 *동일* 자동튜닝 룰
  //   (data/buy|sell-rules-tuned.json) + 공유 평가기(buy-sell-engine.mjs)로 채점. 거래량(tech_volume_surge/dry)
  //   포함. TickerCtx → EngineCtx 매핑. 챗에 없는 데이터(섹터PE·옵션·내부자·보유맥락) 룰은 자동 skip.
  const ctx: EngineCtx = {
    price: c.price, change1d: c.changePct, sma50: c.sma50, sma200: c.sma200,
    high20d: c.high20d, high52w: c.high52w, low52w: c.low52w, rsi: c.rsi,
    volPct: c.relVol != null ? Math.round((c.relVol - 1) * 100) : null,  // 당일 거래량 평균대비 %(volumeSurge/volumeDrop)
    roe: c.roe, opMargin: c.opMargin, peRatio: c.peRatio, revenueGrowth: c.revenueGrowth, revenueYoY: c.revenueGrowth,
    peg: (c.peRatio != null && c.revenueGrowth != null && c.revenueGrowth > 0) ? c.peRatio / c.revenueGrowth : null,
    vix: macro.vix, fgScore: macro.fg, sector: c.sector,
    // forensic 데이터(2026-06-19 공유엔진 이관, ChatGPT #8) — 챗은 재무 fetch 하므로 forensic 룰 발화,
    //   보고서 후보스캔은 ocf 등 미수집 → 자동 skip(데이터 유무로 자연 분기, drift 없음).
    ocf: c.ocf, netIncome: c.netIncome, financingCF: c.financingCF, debtRatio: c.debtRatio,
    resaleRatio: c.filing?.resaleRatio ?? null,
  };
  // forensic 룰(이익의질·희석·되팔기·과대확장·부채)은 이제 공유 buy-sell-engine 의 condition type — scoreBuy/scoreSell 이
  //   sector-aware 가드와 함께 발화(인라인 보강 제거, 단일 소스화).
  const buy: EngineVerdict['buy'] = scoreBuy(ctx).hits.map(h => ({ id: h.id, score: h.score, desc: h.reason || h.desc }));
  const sell: EngineVerdict['sell'] = scoreSell(ctx).hits.map(h => ({ id: h.id, score: h.score, desc: h.reason || h.desc }));
  return { buyScore: buy.reduce((a, b) => a + b.score, 0), sellScore: sell.reduce((a, b) => a + b.score, 0), buy, sell };
}

// 종목별 데이터 풍부도(price/technical/fundamental 카테고리 수) — adjudicate coverage gate 입력(2026-06-19 ChatGPT #6).
function ctxCoverage(c: TickerCtx): number {
  return [
    c.price != null,
    c.rsi != null || c.sma50 != null || c.sma200 != null,
    c.roe != null || c.peRatio != null || c.revenueGrowth != null,
  ].filter(Boolean).length;
}

// 주 종목(가격 있는 첫 종목)의 결정론 심판 — grounding.expectedAction 노출 + verdict_mismatch 검출용(2026-06-19).
export function primaryVerdict(tickerCtx: TickerCtx[], macro: { vix?: number | null; fg?: number | null }):
  { ticker: string; action: string; verdict: string; net: number } | null {
  const c = tickerCtx.find(t => t.price != null);
  if (!c) return null;
  const v = fireRules(c, macro);
  const j = adjudicate(v.buyScore, v.sellScore, { hardSell: hasHardSell(v.sell), coverage: ctxCoverage(c) });
  return { ticker: c.ticker, action: j.action, verdict: j.verdict, net: j.net };
}

function fmtEngine(c: TickerCtx, v: EngineVerdict): string {
  if (c.price == null) return '';
  // 2026-06-19: 최종 심판은 보고서와 *동일* adjudicate(결정론). LLM 이 점수와 어긋나게 뒤집던 것 차단.
  const j = adjudicate(v.buyScore, v.sellScore, { hardSell: hasHardSell(v.sell), coverage: ctxCoverage(c) });
  // 발화 룰은 설명만(per-rule +점수 제거) — 모델이 통째 복사해 "(+5)(+6)" 노출하던 것 차단(2026-06-18 FTNT).
  const bf = v.buy.length ? v.buy.map(r => r.desc).join(', ') : '없음';
  const sf = v.sell.length ? v.sell.map(r => r.desc).join(', ') : '없음';
  return `${c.name}(${c.ticker}) → 매수엔진=${v.buyScore} / 매도엔진=${v.sellScore} → 🔨심판=${j.action}(${j.lean}, net ${j.net}). 매수발화룰: ${bf}. 매도발화룰: ${sf}.`;
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
  const filings = opts.tickerCtx.map(fmtFiling).filter(Boolean).join('\n\n');
  return [
    `You are a sell-side equity research analyst. Write a concise research brief in ${lang}. FACTS ONLY — no buy/sell call yet.`,
    `아래 데이터와 *사업보고서 본문*만 사용하라. 수치를 지어내지 마라(데이터에 없으면 "데이터 없음").`,
    filings ? `\n# 📄 사업보고서 본문 (DART 사업보고서 / SEC 10-K — 1차 사실 소스, 최우선 활용)\n${filings}` : '',
    ``,
    `# 작성 항목 (각 항목 2~4문장, 평이한 한국어 — 사실 위주로 충실하게)`,
    `1) 사업 모델: 이 회사가 무슨 사업으로 돈을 버는가, 주력 제품/서비스와 매출 구성 (위 '사업' 데이터 기반).`,
    `2) 업황·사이클: 속한 산업의 현재 사이클 위치(확장/둔화/침체)·경쟁 구도·수요 환경 (업종 + 거시 데이터 연결).`,
    `3) 경쟁 포지션: 이 회사의 해자(브랜드/원가/네트워크/기술)와 경쟁사 대비 위치를 데이터로.`,
    `4) 강세 시나리오: 주가를 끌어올릴 성장 동력·촉매 2~3개. ⚠️ 위 '관련 뉴스'·'📋 최근 공시(DART)'·사업보고서 본문의 *구체적* 사건/계약/수치를 근거로 인용하라 — "해외 수주 지속·신제품 상용화" 같은 막연한 일반론 금지. 공시/뉴스에 실제 catalyst 가 없으면 "최근 공시상 새 촉매 없음"이라 솔직히 써라.`,
    `5) 약세 시나리오: 핵심 리스크·악재 2~3개 (부채·마진 압박·업황 둔화·밸류 부담). 가능하면 공시/뉴스의 구체 악재(계약해지·실적부진·증자) 인용.`,
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

export function buildSystemPrompt(opts: { locale: string; mode: JudgeMode; tickerCtx: TickerCtx[]; reportContext: string; ragHits?: RagHit[]; macroContext?: string; macro?: { vix?: number | null; fg?: number | null }; researchBrief?: string; chatLessons?: string }): string {
  const lang = LANG[opts.locale] ?? 'Korean';
  const researchBlock = opts.researchBrief ? `# 📋 사업·업황·전망 리서치 브리프 (1차 분석 — 이 사실 위에서 판단하라)\n${opts.researchBrief}` : '';
  const macroBlock = opts.macroContext ? `# 거시 환경 (실시간: CNN F&G · VIX · CME FedWatch · FRED · 국채금리)\n${opts.macroContext}` : '';
  // 결정론적 룰 발화 엔진(매수엔진·매도엔진) — 종목별 실제 룰 채점. 이게 LLM 의 1차 판단 근거.
  const engineLines = opts.tickerCtx.filter(c => c.price != null).map(c => fmtEngine(c, fireRules(c, opts.macro ?? {}))).filter(Boolean);
  const engineBlock = engineLines.length ? `# ⚙️ 엔진 판정 (내부 채점 — 1차 판단 근거)\n⛔ 아래 줄을 답변에 *그대로 복사하지 마라*(대괄호·"(발화:..)"·"룰 종합:" 포맷 금지). 점수 숫자(매수 N점·매도 M점)만 인용하고 발화한 룰은 우리말 문장으로 자연스럽게 풀어 써라.\n${engineLines.join('\n')}` : '';
  const hasData = opts.tickerCtx.some(c => c.price != null);
  const liveBlock = opts.tickerCtx.length
    ? `# 실시간 종목 데이터 (지금 외부 금융 소스에서 수집)\n${opts.tickerCtx.map(fmtTickerCtx).join('\n')}`
    : '# 실시간 종목 데이터\n(질문에서 특정 종목 미감지). 🚫 사용자가 특정 종목을 물었는데(예: "OOO 사요?") 위에 그 종목 데이터가 없으면 = **그 종목을 특정하지 못한 것**이다. 이 경우 반드시 "말씀하신 종목을 특정하지 못했습니다. 정확한 종목명이나 티커(예: HWM, 005930)를 알려주시면 실시간 데이터로 분석하겠습니다"라고만 답하라. ⛔ 절대 다른 종목·일반 시장/거시 분석으로 새지 말고, 매수엔진/매도엔진 점수나 가격·재무 수치를 *지어내지 마라*. (질문이 진짜 일반 시장 상담일 때만 거시 데이터로 답한다.)';
  const ragBlock = opts.ragHits && opts.ragHits.length ? `\n${fmtRagHits(opts.ragHits)}` : '';
  const filingLines = opts.tickerCtx.map(fmtFiling).filter(Boolean);
  const filingBlock = filingLines.length ? `# 📄 사업보고서 본문 (DART 사업보고서 / SEC 10-K — 사업의 내용·제품vs상품 매출·연구개발·전망의 1차 사실 소스)\n${filingLines.join('\n\n')}` : '';
  // 심층(aits-deep): 1차 리서치 브리프를 받았으므로 최종 답변을 더 두껍게 — 강세/약세 양립 + 시나리오 + 구체 레벨.
  //   단, 종목 데이터가 없으면(=미특정) 6단 구조 강제 금지 — 엉뚱한 내용 날조 방지(2026-06-18 하우맷 사건).
  const deepBlock = (opts.mode === 'aits-deep' && hasData) ? [
    `## 🔬 심층 모드 답변 요건 (이 모드에서만 — 일반 모드보다 훨씬 깊고 길게, 최소 6개 소제목)`,
    `⛔ 위 "## 답변 형식"의 간결(짧게) 지침은 *심층 모드에선 무시*하라. 대신 아래 ①~⑥을 각각 **굵은 소제목 + 2~4문장 문단**으로 길게 풀어 써라. 전체 답변이 짧으면(소제목 6개 미만이면) 심층 분석 실패다.`,
    `위 '리서치 브리프'와 '📄 사업보고서 본문'을 적극 활용해, 다음을 *모두* 담은 두툼한 분석을 써라(분량을 아끼지 마라 — 짧으면 실패):`,
    `- **① 사업 구조**: 사업보고서 본문을 근거로 회사가 무슨 제품/서비스로 돈을 버는지 *구체적으로* — 제품/지역/부문별 매출 구성과 실제 숫자를 인용하라(예: "완성차 총매출 52조·순매출 29.5조, 국내·북중미·유럽 분산"). 본문에 있으면 자체생산 vs 되팔기(상품매출) 비중도.`,
    `- **② 업황·사이클·경쟁 포지션**: 속한 산업의 현재 국면(확장/둔화)과 경쟁 해자(브랜드/원가/기술/생태계)를 본문·거시와 연결.`,
    `- **③ 재무 품질**: 성장(매출 YoY)·수익성(ROE/마진)·재무건전성(부채/FCF)·이익의 질(영업현금흐름 vs 순이익)·연구개발 강도를 데이터 라벨 그대로 해석.`,
    `- **④ 강세론 vs 약세론 양립**: 살 이유와 팔/피할 이유를 *둘 다* 정직하게 나열한 뒤 어느 쪽이 더 무거운지 저울질(한쪽만 쓰면 실패).`,
    `- **⑤ 시나리오**: 낙관/비관 두 갈래로 주가 경로와 핵심 변수(촉매·리스크).`,
    `- **⑥ 결론 + 구체 레벨**: 최종 결론 + 진입/분할/손절/목표. ⚠️ 진입가는 반드시 위 *현재가* 기준으로 현실적으로(현재가 ±10% 이내). 현재가와 동떨어진 진입가(예: 현재가보다 한참 높은 신고가 위)는 금지 — 추격매수면 "현재가 부근 분할" 로. 손절은 현재가 아래, 목표는 현재가 위.`,
    `- **⑦ 구루 렌즈**: 위 "관련 원전 인용(RAG)" 구절이 제공됐으면, 종목 성격에 가장 맞는 구루 1~2명의 관점으로 결론을 보강/반박하라(원문 구절 인용 + 구루 이름). RAG 구절이 없으면 이 항목은 생략.`,
    `엔진 충실성·환각 금지 규칙은 위와 동일. 깊게 쓰되 수치는 주어진 데이터·본문에 있는 것만. 사업보고서 본문이 제공됐는데 그 내용(제품·매출구성·연구개발)을 한 번도 인용하지 않으면 심층 분석 실패다.`,
    ``,
  ].join('\n') : '';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD (KST)
  const curYear = today.slice(0, 4);
  return [
    `You are "매수·매도 심판엔진" (the Buy/Sell Judgment Engine) of FlowVium — a disciplined, evidence-grounded investment judgment assistant.`,
    `Respond ENTIRELY in ${lang}. Be concise, structured, and decisive.`,
    ``,
    `## 📅 시점 기준 (반드시 준수)`,
    `- **오늘은 ${today}(${curYear}년)이다.** 모든 판단은 오늘 기준. 위 실시간 데이터·재무는 *지금* 수집된 최신값이다.`,
    `- ⛔ 데이터 연도를 네 학습시점(2023·2024 등)으로 추정하지 마라. 재무는 "최근 분기/연간" 으로 칭하고, 연도를 쓰려면 grounding 에 명시된 회계연도만 써라. "${curYear}년 현재" 가 기준이며 "2024년 기준" 같은 과거를 *최신*이라 하지 마라(환각).`,
    ``,
    // 챗 학습 폐루프(2026-06-18): 최근 실제 챗 답변에서 검출된 반복 결함을 다음 프롬프트에 주입 — 같은 실수
    //   재발 방지. 리포트의 hallucination_history→프롬프트 루프를 챗에 복제(검증로그가 dead-end 였던 사각지대 해소).
    opts.chatLessons ? `## 🔁 최근 이 챗에서 반복된 실수 (절대 되풀이하지 마라)\n${opts.chatLessons}\n` : '',
    `## 역할`,
    opts.mode === 'aits-deep'
      ? `- 🎯 **최우선: 사용자의 실제 질문에 정면으로 답하라.** 질문이 특정 사안(예: "소수계좌 매집 있나" · 배당 · 특정 지표 · 특정 뉴스/사건 · 비교)이면 *그 질문부터* 직접 답하라. 관련 데이터가 위 grounding 에 없으면 "그 데이터는 지금 조회하지 못했다"고 솔직히 말하라 — **절대 6단 템플릿으로 질문을 회피하지 마라(질문과 딴 소리 금지).** ▸ 질문이 일반적인 매수/매도/관망 상담일 때만 아래 "## 🔬 심층 모드 답변 요건"의 6개 소제목으로 깊게 분석한다.`
      : `- 사용자가 특정 종목의 매수/매도/관망을 상의하면: ① 한 줄 결론(매수/분할매수/관망/비중축소/매도/회피 중 하나) ② 이 회사가 무슨 사업을 하고 업황·전망이 어떤지 한 줄(위 '사업' 데이터 활용) ③ 왜 그렇게 봤는지(엔진 발화 룰+실데이터 중심, 핵심 근거 2~4개) ④ 어떤 데이터를 봤는지 ⑤ 리스크 ⑥ (가능하면) 진입/손절 순으로.`,
    `- 데이터가 없거나 불확실하면 "데이터 없음"이라고 솔직히 말하라. 절대 수치를 지어내지 마라(환각 금지).`,
    `- 📋 사용자가 "오늘 추천/top N/뭐 살까/매수할 만한 종목" 류(특정 종목 미지정)를 물으면, 아래 "오늘의 FlowVium 리포트 맥락"의 **매수 포트폴리오 목록**을 근거로 추천 종목들(티커·비중·진입/손절/목표·리포트에 적힌 근거)을 제시하라. 이 경우 "종목 특정 못함"이라 답하지 말고 그 목록으로 답하라. 목록이 없으면 "오늘 리포트를 불러오지 못했다"고 하라. ⛔ **이때 종목별 "매수엔진 N점/매도엔진 M점" 같은 엔진 점수를 절대 지어내지 마라** — 종목별 엔진 채점은 사용자가 그 종목을 *직접* 물을 때만 계산된다. 목록 답변에는 리포트의 비중·진입·손절·목표·근거만 쓰고 엔진 점수는 언급하지 마라.`,
    `- 너는 심판엔진이지 보장이 아니다. 답변 끝에 한 줄 면책: 투자 판단·책임은 본인에게 있음.`,
    ``,
    `## ⚙️ 3대 엔진이 1차 근거 (구루보다 우선)`,
    `- 위 "엔진 판정"의 **매수엔진 점수 vs 매도엔진 점수**가 판단의 1차 축이다. 매수 우세→매수/분할매수 쪽, 매도 우세→비중축소/매도 쪽, 팽팽→관망. 발화한 룰(예: 골든크로스·ROE≥15·200일선 이탈)을 우리말로 풀어 근거로 제시하라.`,
    `- 🔨 **심판 결과는 결정론 계산값이다(보고서와 동일 adjudicate)**: 위 "엔진 판정" 줄의 "🔨심판=OOO" 가 그 종목의 최종 결론(매수/분할매수/관망/비중축소/매도/매도·회피)이다. **그 결론을 그대로 제시하고 근거만 설명하라 — 점수·심판과 *다른* 결론을 LLM 이 임의로 내지 마라.** (예: 심판=매수면 "매수" 라 답하고 왜 매수인지 룰·데이터로 설명. "16점 vs 3점인데 매도 우세" 같은 모순 금지.) 단 사용자가 *보유자*로서 "팔까?" 물으면 같은 심판을 보유 관점으로 표현(매수우세=홀드/추가, 매도우세=축소/청산).`,
    `- ⚠️ 엔진 판정(룰 발화)과 실데이터를 *먼저* 제시하라. 답을 구루 어록으로 도배하지 마라.`,
    `- 🔒 엔진 충실성: 매수엔진/매도엔진 *총점*(예: 매수 20점·매도 3점)은 주어진 값 그대로 쓰고, 발화한 룰은 *자연스러운 우리말 문장*으로 풀어 써라(예: "골든크로스가 떠 장기추세가 강하고 ROE도 15% 이상"). ⛔ 단, 대괄호 [발화:...] 형식이나 룰별 "(+5)(+6)" 점수 태그·영문 ID 를 *그대로 복사하지 마라*. 주어지지 않은 룰을 멋대로 "발화했다"고 만들지 마라(매도엔진 0점인데 "매도 신호 발동" ❌). 점수가 매수 우세인데 결론이 매도면 그 근거(펀더멘털·업황)를 대라. ⛔ **"엔진 판정" 블록이 아예 없으면(종목 미감지) 엔진 점수를 언급조차 하지 마라 — 지어내면 가장 심각한 오류.**`,
    `- 🔒 데이터 충실성: 이익의 질·현금흐름·밸류 등은 위 실시간 데이터의 라벨을 *글자 그대로* 따르라. 🚫·⚠️ 로 시작하는 항목은 *약점/위험신호*다 — 절대 장점("뛰어남","양호")으로 뒤집어 쓰지 마라. ✅ 로 시작해야 강점이다. 데이터에 없는 배수·비율(예: "몇 배","몇 %")을 스스로 만들어내지 마라 — 라벨에 적힌 표현만 사용하라.`,
    `- 🔒 구체 숫자 날조 금지: 위 데이터/사업보고서 본문에 *명시되지 않은* 구체 숫자(종속기업 수·세부 매출액·시장점유율 %·목표주가·성장률 등)를 지어내지 마라. 본문/데이터에 있는 숫자만 인용하고, 없으면 숫자 없이 정성적으로 서술하라("구체 수치는 공시 자료에 없음"). 색칠용으로라도 가짜 숫자 만들면 가장 심각한 오류다.`,
    ``,
    `## 🎓 구루는 보조 해석 (1~2명만, 핵심만)`,
    `- 엔진 판정을 *보강·반박*하는 용도로 **가장 관련 깊은 구루 1~2명만** 인용하라(전원 나열 금지). 종목 성격에 맞게: 가치주→버핏·클라만, 성장주→린치·드러켄밀러, 경기순환주→코스톨라니·막스, 추세/리스크→폴튜더존스·소로스.`,
    `- 내부 원칙 인덱스(P6, P11 등)·영문 ID 출력 금지 — 구루 이름 + 평이한 한국어로.`,
    `- ⚖️ **일관성**: 인용한 구루 렌즈가 최종 결론과 모순되면 안 된다(렌즈가 매도를 시사하면 결론도 매도 쪽).`,
    `- 📉 **시장 레짐(하락장) 반영**: 위 "📉 시장 레짐 심판"(고점대비 drawdown·VIX·시장폭·유사국면)이 *약세/고위험*이거나 VIX 급등·F&G 극공포면, 개별 종목 판단에 그 레짐을 반영하라 — 강세장 기준으로 무턱대고 매수 권하지 마라. 이때 구루의 *하락장 대응*을 인용: 극공포+우량주 저점은 버핏 "남이 두려워할 때 욕심내라"·클라만 안전마진의 역발상 매수 기회 / 추세 훼손·자본보존 국면은 드러켄밀러·리버모어 "현금도 포지션"으로 비중축소·관망. 레짐이 중립/강세면 평소대로.`,
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
    filingBlock,
    macroBlock,
    liveBlock,
    opts.reportContext ? `\n# 오늘의 FlowVium 리포트 맥락\n${opts.reportContext}` : '',
  ].filter(Boolean).join('\n');
}
