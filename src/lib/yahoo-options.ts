/**
 * src/lib/yahoo-options.ts
 *
 * Yahoo Finance Options 데이터 — P/C Ratio, ATM IV (미국 주식 전용)
 * GET https://query1.finance.yahoo.com/v7/finance/options/{TICKER}
 *
 * 신호: P/C ratio > 1.5 = 베어리시 포지션 과다
 * 캐시: Redis 30분
 */

import { createRedis } from '@/lib/redis';
import { loggedFetch, loggedRedisSet, logger } from '@/lib/logger';

const SOURCE = 'yahoo.options';
const CACHE_TTL = 30 * 60; // 30 minutes

export interface OptionsData {
  ticker: string;
  putCallRatio: number | null;     // > 1.5 = 베어리시
  totalPutOI: number | null;
  totalCallOI: number | null;
  impliedVolatility: number | null; // ATM IV (소수점, 예: 0.25 = 25%)
}

interface YahooOptionContract {
  openInterest?: number;
  impliedVolatility?: number;
  strike?: number;
  inTheMoney?: boolean;
}

interface YahooOptionsResponse {
  optionChain?: {
    result?: Array<{
      underlyingSymbol?: string;
      quote?: { regularMarketPrice?: number };
      options?: Array<{
        calls?: YahooOptionContract[];
        puts?: YahooOptionContract[];
      }>;
    }>;
  };
}

function sumOI(contracts: YahooOptionContract[]): number {
  return contracts.reduce((s, c) => s + (c.openInterest ?? 0), 0);
}

/** ATM 주변 계약들(전체의 상위 5% strike 근처)의 평균 IV 계산 */
function calcAtmIV(contracts: YahooOptionContract[], spotPrice: number | undefined): number | null {
  if (!spotPrice || contracts.length === 0) return null;
  // spot 기준 ±5% 범위 계약 필터
  const atm = contracts.filter(c => {
    if (!c.strike) return false;
    const diff = Math.abs(c.strike - spotPrice) / spotPrice;
    return diff <= 0.05;
  });
  if (!atm.length) return null;
  const ivVals = atm.map(c => c.impliedVolatility).filter((v): v is number => typeof v === 'number' && isFinite(v));
  if (!ivVals.length) return null;
  return parseFloat((ivVals.reduce((s, v) => s + v, 0) / ivVals.length).toFixed(4));
}

export async function fetchOptionsData(ticker: string): Promise<OptionsData | null> {
  const cacheKey = `yahoo:options:${ticker.toUpperCase()}`;
  const redis = createRedis();

  // Redis 캐시 히트
  if (redis) {
    try {
      const cached = await redis.get<OptionsData>(cacheKey);
      if (cached) {
        logger.info(SOURCE, 'cache_hit', { ticker });
        return cached;
      }
    } catch { /* ignore */ }
  }

  const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`;

  try {
    const res = await loggedFetch(
      SOURCE,
      'fetch_options',
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        cache: 'no-store',
      },
      8000,
    );

    if (!res || !res.ok) {
      logger.warn(SOURCE, 'fetch_failed', { ticker, status: res?.status });
      return null;
    }

    const json = await res.json() as YahooOptionsResponse;
    const result = json?.optionChain?.result?.[0];
    if (!result) {
      logger.warn(SOURCE, 'no_options_data', { ticker });
      return null;
    }

    const spotPrice = result.quote?.regularMarketPrice;
    const chain = result.options?.[0];
    const calls = chain?.calls ?? [];
    const puts = chain?.puts ?? [];

    const totalCallOI = sumOI(calls);
    const totalPutOI = sumOI(puts);
    const putCallRatio = totalCallOI > 0
      ? parseFloat((totalPutOI / totalCallOI).toFixed(3))
      : null;

    // ATM IV: 콜과 풋 평균
    const callIV = calcAtmIV(calls, spotPrice);
    const putIV = calcAtmIV(puts, spotPrice);
    const impliedVolatility =
      callIV != null && putIV != null
        ? parseFloat(((callIV + putIV) / 2).toFixed(4))
        : callIV ?? putIV ?? null;

    const data: OptionsData = {
      ticker: ticker.toUpperCase(),
      putCallRatio,
      totalPutOI: totalPutOI || null,
      totalCallOI: totalCallOI || null,
      impliedVolatility,
    };

    await loggedRedisSet(redis, SOURCE, cacheKey, data, { ex: CACHE_TTL });
    return data;
  } catch (err) {
    logger.error(SOURCE, 'fetch_error', { ticker, error: err });
    return null;
  }
}
