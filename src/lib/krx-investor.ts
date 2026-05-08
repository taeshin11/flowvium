/**
 * src/lib/krx-investor.ts
 *
 * KRX 투자자별 매매동향 (한국 주식 전용, 인증 불필요)
 * POST https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd
 *
 * 신호: 최근 5일 기관+외국인 순매도 합계가 큰 경우 분산(distribution) 신호
 * 캐시: Redis 1시간
 */

import { createRedis } from '@/lib/redis';
import { loggedFetch, loggedRedisSet, logger } from '@/lib/logger';

const SOURCE = 'krx.investor';
const ENDPOINT = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
const CACHE_TTL = 60 * 60; // 1 hour

export interface KrxInvestorFlow {
  date: string;
  instNetBuy: number;    // 기관 순매수 (원, 음수=순매도)
  frgnNetBuy: number;    // 외국인 순매수
  indvNetBuy: number;    // 개인 순매수
}

function toYYYYMMDD(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function parseKrxNum(v: unknown): number {
  if (v == null) return 0;
  const s = String(v).replace(/,/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export async function fetchKrxInvestorFlow(
  stockCode: string,
  days: number = 5,
): Promise<KrxInvestorFlow[]> {
  const cacheKey = `krx:investor:${stockCode}:${days}`;
  const redis = createRedis();

  // Redis 캐시 히트
  if (redis) {
    try {
      const cached = await redis.get<KrxInvestorFlow[]>(cacheKey);
      if (cached) {
        logger.info(SOURCE, 'cache_hit', { stockCode });
        return cached;
      }
    } catch { /* ignore */ }
  }

  const today = new Date();
  // 주말을 포함해 충분히 여유있게 날짜 범위 확장
  const startDate = addDays(today, -(days + 4));
  const endDd = toYYYYMMDD(today);
  const strtDd = toYYYYMMDD(startDate);

  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT02301',
    tboxisuCd_finder_stkisu0_0: stockCode,
    isuCd: stockCode,
    isuCd2: stockCode,
    strtDd,
    endDd,
  });

  try {
    const res = await loggedFetch(
      SOURCE,
      'fetch_investor_flow',
      ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://data.krx.co.kr/',
          'Origin': 'https://data.krx.co.kr',
        },
        body: body.toString(),
      },
      8000,
    );

    if (!res || !res.ok) {
      logger.warn(SOURCE, 'fetch_failed', { stockCode, status: res?.status });
      return [];
    }

    const json = await res.json() as { OutBlock_1?: Array<Record<string, unknown>> };

    // 응답 구조 디버그
    if (process.env.NODE_ENV !== 'production') {
      console.log('[KRX] sample row:', JSON.stringify(json?.OutBlock_1?.[0])?.slice(0, 200));
    }

    const rows = json?.OutBlock_1?? [];
    const result: KrxInvestorFlow[] = rows.slice(0, days).map(row => ({
      date: String(row.TRD_DD ?? row.trd_dd ?? '').replace(/\//g, '-'),
      instNetBuy: parseKrxNum(row.INST_NETBUY ?? row.inst_netbuy),
      frgnNetBuy: parseKrxNum(row.FRGN_NETBUY ?? row.frgn_netbuy),
      indvNetBuy: parseKrxNum(row.INDV_NETBUY ?? row.indv_netbuy),
    }));

    await loggedRedisSet(redis, SOURCE, cacheKey, result, { ex: CACHE_TTL });
    return result;
  } catch (err) {
    logger.error(SOURCE, 'fetch_error', { stockCode, error: err });
    return [];
  }
}
