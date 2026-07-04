/**
 * /api/korea-flow
 *
 * KRX 외국인·기관·개인 순매수 — 한국 증시는 미국과 달리 수급을 **장중 실시간**
 * 공시합니다 (15분 지연 무료). KRX 공식 데이터 API 사용.
 *
 * Source: KRX 정보데이터시스템 (data.krx.co.kr)
 *   - OTP 발급: /comm/fileDn/GenerateOTP/generate.cmd
 *   - 수급 CSV 다운: /comm/fileDn/download_csv/download.cmd
 *
 * 간단 버전으로 시작: KOSPI 전체 투자자별 순매수 상위 종목만.
 * Redis 15분 캐시.
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=720, stale-while-revalidate=60' };

// Module-level cache per period — without Redis hits KRX API (or 20 Yahoo calls as fallback) every request
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const KOREA_MEMORY_CACHE = new Map<string, { data: any; expiresAt: number }>();
const KOREA_MEMORY_TTLS: Record<string, number> = {
  '1d': 15 * 60 * 1000,
  '1w': 30 * 60 * 1000,
  '4w': 60 * 60 * 1000,
  '13w': 4 * 60 * 60 * 1000,
};

// Per-period cache configuration
const PERIOD_CONFIGS = {
  '1d':  { tradingDays: 1,  ttl: 15 * 60,      sMaxAge: 720,   key: 'flowvium:korea-flow:v4:1d'  },
  '1w':  { tradingDays: 5,  ttl: 30 * 60,      sMaxAge: 1800,  key: 'flowvium:korea-flow:v4:1w'  },
  '4w':  { tradingDays: 20, ttl: 60 * 60,      sMaxAge: 3600,  key: 'flowvium:korea-flow:v4:4w'  },
  '13w': { tradingDays: 65, ttl: 4 * 60 * 60,  sMaxAge: 14400, key: 'flowvium:korea-flow:v4:13w' },
} as const;
type KoreaPeriod = keyof typeof PERIOD_CONFIGS;

export interface KoreaFlowEntry {
  ticker: string;          // 종목코드 (e.g., 005930)
  name: string;
  market: 'KOSPI' | 'KOSDAQ';
  foreignerNetBuy: number | null;    // 외국인 순매수 (KRW)
  institutionNetBuy: number | null;  // 기관 순매수 (KRW)
  individualNetBuy: number | null;   // 개인 순매수 (KRW)
  closePrice: number | null;
  changePct: number | null;
}

const KRX_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Referer': 'https://data.krx.co.kr/',
  'Accept': 'application/json, text/plain, */*',
};

/** Format a KST date (offset +9h from current) as YYYYMMDD, optionally with a day-offset. */
function kstDateStr(daysAgo = 0): string {
  const ts = Date.now() + 9 * 3600000 - daysAgo * 86400000;
  return new Date(ts).toISOString().slice(0, 10).replace(/-/g, '');
}

/** Last N non-weekend KST calendar days as YYYYMMDD strings, most recent first. */
function getLastNTradingDays(n: number): string[] {
  const days: string[] = [];
  let offset = 0;
  while (days.length < n && offset < n * 3) {
    const ts = Date.now() + 9 * 3600000 - offset * 86400000;
    const dow = new Date(ts).getDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(ts).toISOString().slice(0, 10).replace(/-/g, ''));
    offset++;
  }
  return days;
}

/** Parallel-fetch multiple trading days, accumulate net buy/sell by ticker. */
async function fetchKrxFlowAccumulated(
  market: 'KOSPI' | 'KOSDAQ',
  tradingDays: string[],
): Promise<{ entries: KoreaFlowEntry[]; trdDd: string }> {
  const results = await Promise.allSettled(tradingDays.map(d => fetchKrxFlowForDate(market, d)));

  const nameMap = new Map<string, string>();
  const acc = new Map<string, { fb: number; ib: number; indi: number }>();

  // Accumulate all days
  results.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    for (const e of r.value) {
      if (!nameMap.has(e.ticker)) nameMap.set(e.ticker, e.name);
      const ex = acc.get(e.ticker);
      if (ex) {
        ex.fb   += e.foreignerNetBuy   ?? 0;
        ex.ib   += e.institutionNetBuy ?? 0;
        ex.indi += e.individualNetBuy  ?? 0;
      } else {
        acc.set(e.ticker, { fb: e.foreignerNetBuy ?? 0, ib: e.institutionNetBuy ?? 0, indi: e.individualNetBuy ?? 0 });
      }
    }
  });

  // Most recent successful day's price data
  let mostRecent: KoreaFlowEntry[] = [];
  let mostRecentDate = '';
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length > 0 && tradingDays[i] > mostRecentDate) {
      mostRecent = r.value;
      mostRecentDate = tradingDays[i];
    }
  });
  const priceMap = new Map(mostRecent.map(e => [e.ticker, { closePrice: e.closePrice, changePct: e.changePct }]));

  const entries: KoreaFlowEntry[] = Array.from(acc.entries()).map(([ticker, sums]) => ({
    ticker,
    name: EN_NAMES[ticker] ?? nameMap.get(ticker) ?? ticker,
    market,
    // 2026-07-04 (ChatGPT 리뷰): `|| null` 은 순매수 *0원*(관망)을 결측으로 둔갑 — Number.isFinite 로 교정.
    foreignerNetBuy:   Number.isFinite(sums.fb)   ? sums.fb   : null,
    institutionNetBuy: Number.isFinite(sums.ib)   ? sums.ib   : null,
    individualNetBuy:  Number.isFinite(sums.indi) ? sums.indi : null,
    closePrice:  priceMap.get(ticker)?.closePrice ?? null,
    changePct:   priceMap.get(ticker)?.changePct  ?? null,
  })).filter(e => e.name !== e.ticker);

  return { entries, trdDd: mostRecentDate || tradingDays[0] };
}

const num = (v: string | undefined) => Number((v ?? '0').replace(/,/g, '')) || null;
// KRX MDCSTAT02301 은 invstTpCd 로 "선택한 투자자 1종"의 순매수 랭킹만 반환한다.
// 9000=외국인(FORN_*), 7050=기관합계(ORGN_*) — 한 번 호출로 3주체가 다 오지 않으므로
// 외국인+기관 두 invstTpCd 를 각각 호출해 ticker 로 머지해야 기관 순매수가 채워진다.
type RawNet = { name: string; net: number | null; closePrice: number | null; changePct: number | null };

async function fetchKrxInvestorRanking(
  market: 'KOSPI' | 'KOSDAQ',
  trdDd: string,
  invstTpCd: string,
): Promise<Map<string, RawNet>> {
  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT02301',
    mktId: market === 'KOSPI' ? 'STK' : 'KSQ',
    invstTpCd,
    trdDd,
    share: '1',
    money: '1',
    csvxls_isNo: 'false',
  });
  const start = Date.now();
  const out = new Map<string, RawNet>();
  try {
    const res = await fetch('https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd', {
      method: 'POST',
      headers: { ...KRX_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      logger.warn('krx.flow', 'http_error', { market, trdDd, invstTpCd, status: res.status, durationMs: Date.now() - start });
      return out;
    }
    const json = await res.json();
    const rows = (json?.output ?? []) as Array<Record<string, string>>;
    logger.info('krx.flow', 'fetched', { market, trdDd, invstTpCd, rows: rows.length, durationMs: Date.now() - start });
    for (const r of rows) {
      const ticker = r.ISU_SRT_CD;
      if (!ticker) continue;
      // 선택 투자자의 순매수 컬럼: 투자자별로 FORN_/ORGN_/NETBY_ 중 하나만 채워짐 — 우선순위로 robust 추출.
      const net = num(r.NETBY_TRDVAL) ?? num(r.FORN_NETBY_TRDVAL) ?? num(r.ORGN_NETBY_TRDVAL) ?? num(r.IND_NETBY_TRDVAL);
      out.set(ticker, {
        name: EN_NAMES[ticker] ?? r.ISU_ABBRV,
        net,
        closePrice: num(r.TDD_CLSPRC),
        changePct: num(r.FLUC_RT),
      });
    }
  } catch (err) {
    logger.error('krx.flow', 'fetch_exception', { market, trdDd, invstTpCd, error: err, durationMs: Date.now() - start });
  }
  return out;
}

async function fetchKrxFlowForDate(market: 'KOSPI' | 'KOSDAQ', trdDd: string): Promise<KoreaFlowEntry[]> {
  // 외국인(9000) + 기관합계(7050) 동시 호출 → ticker union 머지.
  const [foreign, inst] = await Promise.all([
    fetchKrxInvestorRanking(market, trdDd, '9000'),
    fetchKrxInvestorRanking(market, trdDd, '7050'),
  ]);
  const tickers = new Set(Array.from(foreign.keys()).concat(Array.from(inst.keys())));
  const entries: KoreaFlowEntry[] = [];
  for (const ticker of Array.from(tickers)) {
    const f = foreign.get(ticker);
    const i = inst.get(ticker);
    const meta = f ?? i;
    if (!meta) continue;
    entries.push({
      ticker,
      name: EN_NAMES[ticker] ?? meta.name,
      market,
      foreignerNetBuy: f?.net ?? null,
      institutionNetBuy: i?.net ?? null,
      individualNetBuy: null,
      closePrice: f?.closePrice ?? i?.closePrice ?? null,
      changePct: f?.changePct ?? i?.changePct ?? null,
    });
  }
  return entries.filter(e => e.ticker && e.name);
}

/**
 * Fetch KRX flow with trading-day fallback.
 * 한국은 장 시작 전(09:00 KST 이전) / 주말 / 공휴일에 당일 데이터가 비어 있다.
 * 최근 7거래일까지 역으로 스캔해서 첫 번째 non-empty 결과 사용.
 * Returns {entries, trdDd} so caller knows which date produced the data.
 */
async function fetchKrxFlow(market: 'KOSPI' | 'KOSDAQ'): Promise<{ entries: KoreaFlowEntry[]; trdDd: string }> {
  for (let daysAgo = 0; daysAgo <= 7; daysAgo++) {
    const trdDd = kstDateStr(daysAgo);
    const entries = await fetchKrxFlowForDate(market, trdDd);
    if (entries.length > 0) return { entries, trdDd };
  }
  return { entries: [], trdDd: kstDateStr(0) };
}

const EN_NAMES: Record<string, string> = {
  '005930': 'Samsung Electronics', '000660': 'SK Hynix',          '005380': 'Hyundai Motor',
  '035420': 'NAVER',               '005490': 'POSCO Holdings',     '000270': 'Kia',
  '035720': 'Kakao',               '051910': 'LG Chem',            '028260': 'Samsung C&T',
  '003550': 'LG',                  '012330': 'Hyundai Mobis',      '096770': 'SK Innovation',
  '017670': 'SK Telecom',          '030200': 'KT',                 '055550': 'Shinhan Financial',
  '105560': 'KB Financial',        '086790': 'Hana Financial',     '032830': 'Samsung Life',
  '018260': 'Samsung SDS',         '009150': 'Samsung Electro-Mechanics',
};

const KOSPI_TICKERS = Object.keys(EN_NAMES).map(c => `${c}.KS`);

async function fetchYahooKoreaEntry(ticker: string): Promise<KoreaFlowEntry | null> {
  const code = ticker.replace('.KS', '');
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }
    );
    if (!res.ok) return null;
    const json = await res.json() as Record<string, unknown>;
    const result = (json?.chart as Record<string, unknown>)?.result as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(result) || result.length === 0) return null;
    const meta = result[0].meta as Record<string, unknown> | undefined;
    if (!meta) return null;
    const regularMarketPrice = meta.regularMarketPrice as number | undefined;
    // chartPreviousClose with range=5d = 5-trading-day-ago close, NOT yesterday.
    // Use second-to-last bar for actual daily changePct (same fix as sector-pe + stock-supply).
    const indicators = result[0].indicators as Record<string, unknown> | undefined;
    const quote = (indicators?.quote as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
    const closes: (number | null)[] = (quote?.close as (number | null)[] | undefined) ?? [];
    const validCloses = closes.filter((c): c is number => c != null && !isNaN(c));
    const prevDayClose = validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null;
    const changePct =
      regularMarketPrice != null && prevDayClose != null && prevDayClose > 0
        ? ((regularMarketPrice - prevDayClose) / prevDayClose) * 100
        : null;
    return {
      ticker: code,
      name: EN_NAMES[code] ?? (meta.shortName as string | undefined) ?? code,
      market: 'KOSPI',
      foreignerNetBuy: null,
      institutionNetBuy: null,
      individualNetBuy: null,
      closePrice: regularMarketPrice ?? null,
      changePct: changePct != null ? Math.round(changePct * 100) / 100 : null,
    };
  } catch {
    return null;
  }
}

async function fetchYahooKoreaFallback(): Promise<KoreaFlowEntry[]> {
  const results = await Promise.all(KOSPI_TICKERS.map(t => fetchYahooKoreaEntry(t)));
  return results.filter((e): e is KoreaFlowEntry => e !== null);
}

/**
 * Naver Finance frgn.naver — per-stock 외국인·기관 순매매량 (shares × close = KRW approx).
 * Accessible from all IPs; KRX getJsonData 가 anti-bot LOGOUT 로 막혀 이게 1차 소스.
 * 셀 레이아웃(span.tah, 헤더 검증): [0]날짜 [1]종가 [2]전일비 [3]등락률 [4]거래량
 *   [5]기관 순매매량 [6]외국인 순매매량 [7]외국인 보유주수 [8]보유율.
 *   ⚠️ row[5]=기관, row[6]=외국인 — 과거 코드가 row[5]를 외국인으로 잘못 라벨해 기관 데이터 전체 누락.
 * 개인(individual)은 이 페이지에 없음.
 */
async function fetchNaverFrgnEntry(code: string, days = 1): Promise<(KoreaFlowEntry & { actualDays: number }) | null> {
  try {
    const res = await fetch(`https://finance.naver.com/item/frgn.naver?code=${code}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://finance.naver.com/',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const html = new TextDecoder('euc-kr').decode(buf);

    const raw = Array.from(html.matchAll(/<span class="tah[^"]*">([\s\S]*?)<\/span>/g))
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/[,\s\n]/g, '').trim())
      .filter(v => v.length > 0);

    const dateIdx = raw.findIndex(v => /^\d{4}\.\d{2}\.\d{2}$/.test(v));
    if (dateIdx < 0) return null;

    // 2026-06-04: frgn.naver 테이블은 ~20+ 일별 행. period(1d/1w/4w/13w) 만큼 행을 합산해
    //   진짜 multi-day 차별화 (이전엔 1행만 읽어 모든 period 가 동일값이던 버그).
    // row layout: [0]date [1]close [2]change [3]changePct% [4]volume [5]기관 [6]외국인 [7]보유주수 [8]보유율
    const sharesToKrw = (close: number | null, s: string | undefined) => {
      const shares = Number((s ?? '0').replace('+', '')) || 0;
      return close && shares !== 0 ? Math.round(close * shares) : 0;
    };
    let instSum = 0, forSum = 0, actualDays = 0;
    let latestClose: number | null = null, latestChangePct: number | null = null;
    for (let d = 0; d < days; d++) {
      const off = dateIdx + d * 9;
      const row = raw.slice(off, off + 9);
      if (!row[0] || !/^\d{4}\.\d{2}\.\d{2}$/.test(row[0])) break; // 더 이상 일별 행 없음
      const close = Number(row[1]) || null;
      if (d === 0) { latestClose = close; latestChangePct = Number((row[3] ?? '0').replace('%', '')) || null; }
      instSum += sharesToKrw(close, row[5]);
      forSum += sharesToKrw(close, row[6]);
      actualDays++;
    }
    if (actualDays === 0) return null;

    return {
      ticker: code,
      name: EN_NAMES[code] ?? code,
      market: 'KOSPI',
      foreignerNetBuy: forSum || null,
      institutionNetBuy: instSum || null,
      individualNetBuy: null,
      closePrice: latestClose,
      changePct: latestChangePct,
      actualDays,
    };
  } catch {
    return null;
  }
}

async function fetchNaverForeignFlow(days = 1): Promise<{ entries: KoreaFlowEntry[]; trdDd: string; effectiveDays: number } | null> {
  const tickers = Object.keys(EN_NAMES);
  const results = await Promise.all(tickers.map(c => fetchNaverFrgnEntry(c, days)));
  const valid = results.filter((e): e is KoreaFlowEntry & { actualDays: number } => e !== null && (e.foreignerNetBuy !== null || e.institutionNetBuy !== null));
  const entries: KoreaFlowEntry[] = valid.map(({ actualDays: _d, ...e }) => e);
  if (entries.length === 0) return null;
  const effectiveDays = Math.max(1, ...valid.map(e => e.actualDays));
  // Derive tradingDay from the raw HTML date (YYYY.MM.DD → YYYYMMDD)
  // All entries share the same date; pick first valid one
  const sampleRes = await fetch(`https://finance.naver.com/item/frgn.naver?code=${tickers[0]}`, {
    cache: 'no-store', signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.naver.com/' },
  }).catch(() => null);
  let trdDd = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
  if (sampleRes?.ok) {
    const buf = await sampleRes.arrayBuffer();
    const html = new TextDecoder('euc-kr').decode(buf);
    const raw = Array.from(html.matchAll(/<span class="tah[^"]*">([\s\S]*?)<\/span>/g))
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/[,\s\n]/g, '').trim());
    const dateStr = raw.find(v => /^\d{4}\.\d{2}\.\d{2}$/.test(v));
    if (dateStr) trdDd = dateStr.replace(/\./g, '');
  }
  return { entries, trdDd, effectiveDays };
}

function buildPayload(all: KoreaFlowEntry[], trdDd: string, extra?: object) {
  const tradingDayFmt = `${trdDd.slice(0, 4)}-${trdDd.slice(4, 6)}-${trdDd.slice(6, 8)}`;
  const topForeignBuy  = [...all].filter(e => (e.foreignerNetBuy   ?? 0) > 0).sort((a,b) => (b.foreignerNetBuy   ?? 0) - (a.foreignerNetBuy   ?? 0)).slice(0, 15);
  const topForeignSell = [...all].filter(e => (e.foreignerNetBuy   ?? 0) < 0).sort((a,b) => (a.foreignerNetBuy   ?? 0) - (b.foreignerNetBuy   ?? 0)).slice(0, 15);
  const topInstBuy     = [...all].filter(e => (e.institutionNetBuy ?? 0) > 0).sort((a,b) => (b.institutionNetBuy ?? 0) - (a.institutionNetBuy ?? 0)).slice(0, 15);
  const topInstSell    = [...all].filter(e => (e.institutionNetBuy ?? 0) < 0).sort((a,b) => (a.institutionNetBuy ?? 0) - (b.institutionNetBuy ?? 0)).slice(0, 15);
  // Aggregate totals for verify-metrics probes (kr.foreign / kr.institution / kr.retail)
  // 2026-07-04 (ChatGPT 리뷰): 주체별 관측 여부를 각각 판정 — 종전엔 외국인만 있으면 기관/개인 미관측이 0 으로 둔갑.
  const hasForeign = all.some(e => e.foreignerNetBuy != null);
  const hasInst    = all.some(e => e.institutionNetBuy != null);
  const hasRetail  = all.some(e => e.individualNetBuy != null);
  const foreignNet     = hasForeign ? all.reduce((s, e) => s + (e.foreignerNetBuy   ?? 0), 0) : null;
  const institutionNet = hasInst    ? all.reduce((s, e) => s + (e.institutionNetBuy ?? 0), 0) : null;
  const retailNet      = hasRetail  ? all.reduce((s, e) => s + (e.individualNetBuy  ?? 0), 0) : null;
  return { updatedAt: new Date().toISOString(), tradingDay: tradingDayFmt,
    topForeignBuy, topForeignSell, topInstBuy, topInstSell, totalTickers: all.length,
    foreignNet, institutionNet, retailNet,
    measurement: 'measured_investor_net_buy',  // 2026-07-04: 진짜 실측 flow 임을 타입으로 명시(가격 proxy 와 구분)
    ...extra };
}

export async function GET(req: Request) {
  const reqStart = Date.now();
  const redis = createRedis();
  const url = new URL(req.url);
  const force = url.searchParams.get('refresh') === '1';
  const rawPeriod = url.searchParams.get('period') ?? '1d';
  const period: KoreaPeriod = (rawPeriod in PERIOD_CONFIGS ? rawPeriod : '1d') as KoreaPeriod;
  const cfg = PERIOD_CONFIGS[period];
  const cdnHeaders = { 'Cache-Control': `public, s-maxage=${cfg.sMaxAge}, stale-while-revalidate=60` };

  const fullReq = url.searchParams.get('full') === '1';  // 2026-07-04: full 은 캐시 우회(요약 캐시엔 entries 없음)
  const memEntry = KOREA_MEMORY_CACHE.get(period);
  if (!redis && !force && !fullReq && memEntry && Date.now() < memEntry.expiresAt) {
    return NextResponse.json({ ...memEntry.data, cached: true }, { headers: cdnHeaders });
  }

  if (redis && !force && !fullReq) {
    try {
      const cached = await redis.get(cfg.key);
      if (cached) {
        logger.info('api.korea-flow', 'cache_hit', { period });
        return NextResponse.json({ ...(cached as object), cached: true }, { headers: cdnHeaders });
      }
    } catch (err) { logger.warn('api.korea-flow', 'cache_read_error', { error: err }); }
  }

  let all: KoreaFlowEntry[];
  let trdDd: string;
  let dataSource: 'krx' | 'naver-fallback' | 'yahoo-price-only' = 'krx';
  let naverEffectiveDays = 0; // Naver 폴백이 실제 합산한 거래일 수 (multi-day 차별화)

  if (period === '1d') {
    // Single-day with fallback scan (original behaviour)
    const [kospi, kosdaq] = await Promise.all([fetchKrxFlow('KOSPI'), fetchKrxFlow('KOSDAQ')]);
    all = [...kospi.entries, ...kosdaq.entries];
    trdDd = kospi.trdDd >= kosdaq.trdDd ? kospi.trdDd : kosdaq.trdDd;

    if (all.length === 0) {
      // KRX unavailable → Naver frgn (1일)
      const naverFlow = await fetchNaverForeignFlow(1);
      if (naverFlow && naverFlow.entries.length > 0) {
        logger.info('api.korea-flow', 'krx_empty_naver_fallback', { period, tickers: naverFlow.entries.length });
        all = naverFlow.entries;
        trdDd = naverFlow.trdDd;
        dataSource = 'naver-fallback';
        naverEffectiveDays = naverFlow.effectiveDays;
      } else {
        // Final fallback: Yahoo price data only
        const yahooEntries = await fetchYahooKoreaFallback();
        logger.warn('api.korea-flow', 'krx_naver_empty_yahoo_fallback', { period });
        const byDesc = [...yahooEntries].sort((a,b) => (b.changePct ?? 0) - (a.changePct ?? 0));
        const byAsc  = [...yahooEntries].sort((a,b) => (a.changePct ?? 0) - (b.changePct ?? 0));
        const fp = { updatedAt: new Date().toISOString(), tradingDay: `${trdDd.slice(0,4)}-${trdDd.slice(4,6)}-${trdDd.slice(6,8)}`,
          topForeignBuy: byDesc.slice(0,15), topForeignSell: byAsc.slice(0,15),
          topInstBuy: [] as KoreaFlowEntry[], topInstSell: [] as KoreaFlowEntry[],
          totalTickers: yahooEntries.length, fallback: true, period,
          source: 'yahoo-price-only' as const,
          fallbackReason: 'KRX + Naver unavailable — Yahoo Finance price data only' };
        await loggedRedisSet(redis, 'api.korea-flow', cfg.key, fp, { ex: cfg.ttl });
        return NextResponse.json({ ...fp, cached: false }, { headers: cdnHeaders });
      }
    }
  } else {
    // Multi-day accumulated (KRX only; Naver frgn doesn't support multi-day ranking)
    const tradingDays = getLastNTradingDays(cfg.tradingDays);
    const [kospi, kosdaq] = await Promise.all([
      fetchKrxFlowAccumulated('KOSPI',  tradingDays),
      fetchKrxFlowAccumulated('KOSDAQ', tradingDays),
    ]);
    all = [...kospi.entries, ...kosdaq.entries];
    trdDd = kospi.trdDd >= kosdaq.trdDd ? kospi.trdDd : kosdaq.trdDd;
    logger.info('api.korea-flow', 'accumulated', { period, days: tradingDays.length, tickers: all.length });

    if (all.length === 0) {
      // 2026-06-04: KRX multi-day 불가 시 Naver frgn.naver 테이블에서 period 만큼 일별 합산 →
      //   진짜 multi-day 차별화 (이전엔 Naver 1일을 모든 period 에 써서 1d=1w=4w=13w 동일값 버그).
      const naverFlow = await fetchNaverForeignFlow(cfg.tradingDays);
      if (naverFlow && naverFlow.entries.length > 0) {
        logger.info('api.korea-flow', 'krx_empty_naver_multiday', { period, days: cfg.tradingDays, effectiveDays: naverFlow.effectiveDays });
        all = naverFlow.entries;
        trdDd = naverFlow.trdDd;
        dataSource = 'naver-fallback';
        naverEffectiveDays = naverFlow.effectiveDays;
      } else {
        const yahooEntries = await fetchYahooKoreaFallback();
        logger.warn('api.korea-flow', 'krx_naver_empty_yahoo_fallback', { period });
        const byDesc = [...yahooEntries].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
        const byAsc  = [...yahooEntries].sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0));
        const fp = {
          updatedAt: new Date().toISOString(),
          tradingDay: `${trdDd.slice(0, 4)}-${trdDd.slice(4, 6)}-${trdDd.slice(6, 8)}`,
          topForeignBuy: byDesc.slice(0, 15), topForeignSell: byAsc.slice(0, 15),
          topInstBuy: [] as KoreaFlowEntry[], topInstSell: [] as KoreaFlowEntry[],
          totalTickers: yahooEntries.length, fallback: true, period,
          source: 'yahoo-price-only' as const,
          fallbackReason: 'KRX + Naver unavailable — Yahoo Finance price data only',
        };
        await loggedRedisSet(redis, 'api.korea-flow', cfg.key, fp, { ex: cfg.ttl });
        return NextResponse.json({ ...fp, cached: false }, { headers: cdnHeaders });
      }
    }
  }

  // effectiveTradingDays: Naver 폴백은 실제 합산 거래일(naverEffectiveDays), KRX 는 목표 일수.
  //   Naver 가 목표보다 적게 합산했으면(테이블 행 부족) fallback:true 로 라벨 모순 표시.
  const effDays = dataSource === 'naver-fallback' ? naverEffectiveDays : cfg.tradingDays;
  const naverShort = dataSource === 'naver-fallback' && cfg.tradingDays > 1 && naverEffectiveDays < cfg.tradingDays;
  // 2026-07-04 (ChatGPT 리뷰): full=1 — 상위 15 요약이 아닌 전체 entries 노출(엔진 per-ticker 수급 feature 용).
  const full = fullReq;
  const payload = buildPayload(all, trdDd, {
    period,
    source: dataSource,
    effectiveTradingDays: effDays,
    ...(full ? { entries: all } : {}),
    ...(naverShort
      ? { fallback: true, fallbackReason: `KRX ${cfg.tradingDays}거래일 불가 — Naver ${effDays}거래일 누적` }
      : {}),
  });
  if (!full) {  // full=1(전체 entries) 은 캐시 미기록 — 요약 캐시(cfg.key) 페이로드 오염 방지(내부 엔진 전용 호출)
    await loggedRedisSet(redis, 'api.korea-flow', cfg.key, payload, { ex: cfg.ttl });
    if (!redis) KOREA_MEMORY_CACHE.set(period, { data: payload, expiresAt: Date.now() + (KOREA_MEMORY_TTLS[period] ?? 15 * 60 * 1000) });
  }
  logger.info('api.korea-flow', 'served', { period, totalTickers: all.length, durationMs: Date.now() - reqStart });
  return NextResponse.json({ ...payload, cached: false }, { headers: cdnHeaders });
}
