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

const CACHE_KEY = 'flowvium:korea-flow:v1';
const CACHE_TTL = 15 * 60;

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

const KOSPI_TICKERS = [
  '005930.KS', // 삼성전자
  '000660.KS', // SK하이닉스
  '005380.KS', // 현대차
  '035420.KS', // NAVER
  '005490.KS', // POSCO홀딩스
  '000270.KS', // 기아
  '035720.KS', // 카카오
  '051910.KS', // LG화학
  '028260.KS', // 삼성물산
  '003550.KS', // LG
  '012330.KS', // 현대모비스
  '096770.KS', // SK이노베이션
  '017670.KS', // SK텔레콤
  '030200.KS', // KT
  '055550.KS', // 신한지주
  '105560.KS', // KB금융
  '086790.KS', // 하나금융지주
  '032830.KS', // 삼성생명
  '018260.KS', // 삼성에스디에스
  '009150.KS', // 삼성전기
];

async function fetchYahooKoreaEntry(ticker: string): Promise<KoreaFlowEntry | null> {
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
    const chartPreviousClose = meta.chartPreviousClose as number | undefined;
    const changePct =
      regularMarketPrice != null && chartPreviousClose != null && chartPreviousClose !== 0
        ? ((regularMarketPrice - chartPreviousClose) / chartPreviousClose) * 100
        : null;
    return {
      ticker: ticker.replace('.KS', ''),
      name: (meta.shortName as string | undefined) ?? ticker.replace('.KS', ''),
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

export async function GET(req: Request) {
  const reqStart = Date.now();
  const redis = createRedis();
  const force = new URL(req.url).searchParams.get('refresh') === '1';

  if (redis && !force) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        logger.info('api.korea-flow', 'cache_hit');
        return NextResponse.json({ ...(cached as object), cached: true });
      }
    } catch (err) { logger.warn('api.korea-flow', 'cache_read_error', { error: err }); }
  }

  const [kospi, kosdaq] = await Promise.all([
    fetchKrxFlow('KOSPI'),
    fetchKrxFlow('KOSDAQ'),
  ]);

  const all = [...kospi.entries, ...kosdaq.entries];
  // pick the more recent trdDd (numeric comparison on YYYYMMDD works)
  const actualTradingDay = kospi.trdDd >= kosdaq.trdDd ? kospi.trdDd : kosdaq.trdDd;
  const tradingDayFmt = `${actualTradingDay.slice(0, 4)}-${actualTradingDay.slice(4, 6)}-${actualTradingDay.slice(6, 8)}`;

  // If KRX returned no data, fall back to Yahoo Finance price data
  if (all.length === 0) {
    logger.warn('api.korea-flow', 'krx_empty_yahoo_fallback', {});
    const yahooEntries = await fetchYahooKoreaFallback();
    logger.info('api.korea-flow', 'yahoo_fallback_fetched', { count: yahooEntries.length });

    // Sort by changePct for the four lists (no net buy data available)
    const byChangePctDesc = [...yahooEntries].sort(
      (a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)
    );
    const byChangePctAsc = [...yahooEntries].sort(
      (a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)
    );

    const fallbackPayload = {
      updatedAt: new Date().toISOString(),
      tradingDay: tradingDayFmt,
      topForeignBuy: byChangePctDesc.slice(0, 15),
      topForeignSell: byChangePctAsc.slice(0, 15),
      topInstBuy: byChangePctDesc.slice(0, 15),
      topInstSell: byChangePctAsc.slice(0, 15),
      totalTickers: yahooEntries.length,
      fallback: true,
      fallbackReason: 'KRX API unavailable — Yahoo Finance price data only',
    };

    await loggedRedisSet(redis, 'api.korea-flow', CACHE_KEY, fallbackPayload, { ex: CACHE_TTL });

    logger.info('api.korea-flow', 'served_fallback', { totalTickers: yahooEntries.length, durationMs: Date.now() - reqStart });
    return NextResponse.json({ ...fallbackPayload, cached: false });
  }

  // Top-N by absolute foreigner net buy
  const topForeignBuy = [...all]
    .filter(e => (e.foreignerNetBuy ?? 0) > 0)
    .sort((a, b) => (b.foreignerNetBuy ?? 0) - (a.foreignerNetBuy ?? 0))
    .slice(0, 15);
  const topForeignSell = [...all]
    .filter(e => (e.foreignerNetBuy ?? 0) < 0)
    .sort((a, b) => (a.foreignerNetBuy ?? 0) - (b.foreignerNetBuy ?? 0))
    .slice(0, 15);
  const topInstBuy = [...all]
    .filter(e => (e.institutionNetBuy ?? 0) > 0)
    .sort((a, b) => (b.institutionNetBuy ?? 0) - (a.institutionNetBuy ?? 0))
    .slice(0, 15);
  const topInstSell = [...all]
    .filter(e => (e.institutionNetBuy ?? 0) < 0)
    .sort((a, b) => (a.institutionNetBuy ?? 0) - (b.institutionNetBuy ?? 0))
    .slice(0, 15);

  const payload = {
    updatedAt: new Date().toISOString(),
    tradingDay: tradingDayFmt,
    topForeignBuy,
    topForeignSell,
    topInstBuy,
    topInstSell,
    totalTickers: all.length,
  };

  await loggedRedisSet(redis, 'api.korea-flow', CACHE_KEY, payload, { ex: CACHE_TTL });

  logger.info('api.korea-flow', 'served', { totalTickers: all.length, durationMs: Date.now() - reqStart });
  return NextResponse.json({ ...payload, cached: false });
}
