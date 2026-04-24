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
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=720, stale-while-revalidate=60' };

// Per-period cache configuration
const PERIOD_CONFIGS = {
  '1d':  { tradingDays: 1,  ttl: 15 * 60,      sMaxAge: 720,   key: 'flowvium:korea-flow:v3:1d'  },
  '1w':  { tradingDays: 5,  ttl: 30 * 60,      sMaxAge: 1800,  key: 'flowvium:korea-flow:v3:1w'  },
  '4w':  { tradingDays: 20, ttl: 60 * 60,      sMaxAge: 3600,  key: 'flowvium:korea-flow:v3:4w'  },
  '13w': { tradingDays: 65, ttl: 4 * 60 * 60,  sMaxAge: 14400, key: 'flowvium:korea-flow:v3:13w' },
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

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
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
    name: nameMap.get(ticker) ?? ticker,
    market,
    foreignerNetBuy:   sums.fb   || null,
    institutionNetBuy: sums.ib   || null,
    individualNetBuy:  sums.indi || null,
    closePrice:  priceMap.get(ticker)?.closePrice ?? null,
    changePct:   priceMap.get(ticker)?.changePct  ?? null,
  })).filter(e => e.name !== e.ticker);

  return { entries, trdDd: mostRecentDate || tradingDays[0] };
}

async function fetchKrxFlowForDate(market: 'KOSPI' | 'KOSDAQ', trdDd: string): Promise<KoreaFlowEntry[]> {
  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT02301',
    mktId: market === 'KOSPI' ? 'STK' : 'KSQ',
    invstTpCd: '9000',
    trdDd,
    share: '1',
    money: '1',
    csvxls_isNo: 'false',
  });
  const start = Date.now();
  try {
    const res = await fetch('https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd', {
      method: 'POST',
      headers: { ...KRX_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      logger.warn('krx.flow', 'http_error', { market, trdDd, status: res.status, durationMs: Date.now() - start });
      return [];
    }
    const json = await res.json();
    const rows = (json?.output ?? []) as Array<Record<string, string>>;
    logger.info('krx.flow', 'fetched', { market, trdDd, rows: rows.length, durationMs: Date.now() - start });
    return rows.map(r => ({
      ticker: r.ISU_SRT_CD,
      name: r.ISU_ABBRV,
      market,
      foreignerNetBuy: Number((r.FORN_NETBY_TRDVAL ?? '0').replace(/,/g, '')) || null,
      institutionNetBuy: Number((r.ORGN_NETBY_TRDVAL ?? '0').replace(/,/g, '')) || null,
      individualNetBuy: Number((r.IND_NETBY_TRDVAL ?? '0').replace(/,/g, '')) || null,
      closePrice: Number((r.TDD_CLSPRC ?? '0').replace(/,/g, '')) || null,
      changePct: Number((r.FLUC_RT ?? '0').replace(/,/g, '')) || null,
    })).filter(e => e.ticker && e.name);
  } catch (err) {
    logger.error('krx.flow', 'fetch_exception', { market, trdDd, error: err, durationMs: Date.now() - start });
    return [];
  }
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

const KO_NAMES: Record<string, string> = {
  '005930': '삼성전자',   '000660': 'SK하이닉스',  '005380': '현대차',
  '035420': 'NAVER',      '005490': 'POSCO홀딩스', '000270': '기아',
  '035720': '카카오',     '051910': 'LG화학',       '028260': '삼성물산',
  '003550': 'LG',         '012330': '현대모비스',   '096770': 'SK이노베이션',
  '017670': 'SK텔레콤',   '030200': 'KT',           '055550': '신한지주',
  '105560': 'KB금융',     '086790': '하나금융지주', '032830': '삼성생명',
  '018260': '삼성에스디에스','009150': '삼성전기',
};

const KOSPI_TICKERS = Object.keys(KO_NAMES).map(c => `${c}.KS`);

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
      name: KO_NAMES[code] ?? (meta.shortName as string | undefined) ?? code,
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

function buildPayload(all: KoreaFlowEntry[], trdDd: string, extra?: object) {
  const tradingDayFmt = `${trdDd.slice(0, 4)}-${trdDd.slice(4, 6)}-${trdDd.slice(6, 8)}`;
  const topForeignBuy  = [...all].filter(e => (e.foreignerNetBuy   ?? 0) > 0).sort((a,b) => (b.foreignerNetBuy   ?? 0) - (a.foreignerNetBuy   ?? 0)).slice(0, 15);
  const topForeignSell = [...all].filter(e => (e.foreignerNetBuy   ?? 0) < 0).sort((a,b) => (a.foreignerNetBuy   ?? 0) - (b.foreignerNetBuy   ?? 0)).slice(0, 15);
  const topInstBuy     = [...all].filter(e => (e.institutionNetBuy ?? 0) > 0).sort((a,b) => (b.institutionNetBuy ?? 0) - (a.institutionNetBuy ?? 0)).slice(0, 15);
  const topInstSell    = [...all].filter(e => (e.institutionNetBuy ?? 0) < 0).sort((a,b) => (a.institutionNetBuy ?? 0) - (b.institutionNetBuy ?? 0)).slice(0, 15);
  // Aggregate totals for verify-metrics probes (kr.foreign / kr.institution / kr.retail)
  const hasFlow = all.some(e => e.foreignerNetBuy != null);
  const foreignNet  = hasFlow ? all.reduce((s, e) => s + (e.foreignerNetBuy   ?? 0), 0) : null;
  const institutionNet = hasFlow ? all.reduce((s, e) => s + (e.institutionNetBuy ?? 0), 0) : null;
  const retailNet   = hasFlow ? all.reduce((s, e) => s + (e.individualNetBuy  ?? 0), 0) : null;
  return { updatedAt: new Date().toISOString(), tradingDay: tradingDayFmt,
    topForeignBuy, topForeignSell, topInstBuy, topInstSell, totalTickers: all.length,
    foreignNet, institutionNet, retailNet,
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

  if (redis && !force) {
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

  if (period === '1d') {
    // Single-day with fallback scan (original behaviour)
    const [kospi, kosdaq] = await Promise.all([fetchKrxFlow('KOSPI'), fetchKrxFlow('KOSDAQ')]);
    all = [...kospi.entries, ...kosdaq.entries];
    trdDd = kospi.trdDd >= kosdaq.trdDd ? kospi.trdDd : kosdaq.trdDd;

    if (all.length === 0) {
      const yahooEntries = await fetchYahooKoreaFallback();
      logger.warn('api.korea-flow', 'krx_empty_yahoo_fallback', { period });
      const byDesc = [...yahooEntries].sort((a,b) => (b.changePct ?? 0) - (a.changePct ?? 0));
      const byAsc  = [...yahooEntries].sort((a,b) => (a.changePct ?? 0) - (b.changePct ?? 0));
      const fp = { updatedAt: new Date().toISOString(), tradingDay: `${trdDd.slice(0,4)}-${trdDd.slice(4,6)}-${trdDd.slice(6,8)}`,
        topForeignBuy: byDesc.slice(0,15), topForeignSell: byAsc.slice(0,15),
        topInstBuy: byDesc.slice(0,15), topInstSell: byAsc.slice(0,15),
        totalTickers: yahooEntries.length, fallback: true, period,
        fallbackReason: 'KRX API unavailable — Yahoo Finance price data only' };
      await loggedRedisSet(redis, 'api.korea-flow', cfg.key, fp, { ex: cfg.ttl });
      return NextResponse.json({ ...fp, cached: false }, { headers: cdnHeaders });
    }
  } else {
    // Multi-day accumulated
    const tradingDays = getLastNTradingDays(cfg.tradingDays);
    const [kospi, kosdaq] = await Promise.all([
      fetchKrxFlowAccumulated('KOSPI',  tradingDays),
      fetchKrxFlowAccumulated('KOSDAQ', tradingDays),
    ]);
    all = [...kospi.entries, ...kosdaq.entries];
    trdDd = kospi.trdDd >= kosdaq.trdDd ? kospi.trdDd : kosdaq.trdDd;
    logger.info('api.korea-flow', 'accumulated', { period, days: tradingDays.length, tickers: all.length });
  }

  const payload = buildPayload(all, trdDd, { period });
  await loggedRedisSet(redis, 'api.korea-flow', cfg.key, payload, { ex: cfg.ttl });
  logger.info('api.korea-flow', 'served', { period, totalTickers: all.length, durationMs: Date.now() - reqStart });
  return NextResponse.json({ ...payload, cached: false }, { headers: cdnHeaders });
}
