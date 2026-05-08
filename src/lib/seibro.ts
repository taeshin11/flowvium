/**
 * src/lib/seibro.ts
 *
 * SEIBRO 공매도/대차잔고 API (한국 주식 전용)
 * Base URL: https://openapi.seibro.or.kr/openapi/rest
 * API Key: SEIBRO_API_KEY 환경변수
 *
 * 인증: serviceKey 쿼리파라미터 (실패시 Authorization: Bearer 헤더)
 * 캐시: Redis 6시간
 */

import { createRedis } from '@/lib/redis';
import { loggedFetch, loggedRedisSet, logger } from '@/lib/logger';

const SOURCE = 'seibro';
const BASE_URL = 'https://openapi.seibro.or.kr/openapi/rest';
const CACHE_TTL = 6 * 60 * 60; // 6 hours

export interface SeibroShortData {
  stockCode: string;
  shortBalQty: number | null;      // 공매도 잔고 수량
  shortBalAmt: number | null;      // 공매도 잔고 금액 (원)
  shortBalRatio: number | null;    // 공매도 비율 (%)
  borrowBalQty: number | null;     // 대차잔고 수량
  date: string;
}

function parseNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

/** SEIBRO OpenAPI 응답에서 SeibroShortData 파싱 */
function parseResponse(stockCode: string, shortData: unknown, borrowData: unknown): SeibroShortData {
  // SEIBRO 응답은 JSON 또는 XML 가능. JSON 가정 시 items 배열 첫 번째 항목 사용.
  // 필드명은 실제 응답에 따라 다를 수 있음 (scrtItemCode, balQty, balAmt, balRat, baseDd 등)
  const sd = (shortData as Record<string, unknown>) ?? {};
  const bd = (borrowData as Record<string, unknown>) ?? {};

  const shortBalQty = parseNum(sd.balQty ?? sd.shortBalQty ?? sd.SHORT_BAL_QTY ?? null);
  const shortBalAmt = parseNum(sd.balAmt ?? sd.shortBalAmt ?? sd.SHORT_BAL_AMT ?? null);
  const shortBalRatio = parseNum(sd.balRat ?? sd.shortBalRatio ?? sd.SHORT_BAL_RAT ?? null);
  const borrowBalQty = parseNum(bd.balQty ?? bd.borrowBalQty ?? bd.BORROW_BAL_QTY ?? null);
  const date = String(sd.baseDd ?? sd.date ?? sd.BASE_DD ?? new Date().toISOString().slice(0, 10));

  return { stockCode, shortBalQty, shortBalAmt, shortBalRatio, borrowBalQty, date };
}

/** 단일 엔드포인트 호출 (serviceKey 쿼리파라미터) */
async function callEndpoint(path: string, stockCode: string, apiKey: string): Promise<unknown | null> {
  const url = `${BASE_URL}${path}?serviceKey=${encodeURIComponent(apiKey)}&isinCd=${stockCode}&numOfRows=1&pageNo=1`;
  const res = await loggedFetch(SOURCE, `fetch_${path.split('/').pop()}`, url, {
    headers: { Accept: 'application/json' },
  }, 8000);
  if (!res || !res.ok) {
    // fallback: Authorization Bearer
    const url2 = `${BASE_URL}${path}?isinCd=${stockCode}&numOfRows=1&pageNo=1`;
    const res2 = await loggedFetch(SOURCE, `fetch_bearer_${path.split('/').pop()}`, url2, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    }, 8000);
    if (!res2 || !res2.ok) return null;
    try { return await res2.json(); } catch { return null; }
  }
  try { return await res.json(); } catch { return null; }
}

/** 응답 body에서 첫 번째 데이터 행 추출 */
function extractFirstItem(body: unknown): unknown | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  // 일반적인 공공 OpenAPI 구조: response.body.items.item[]
  const items = (b.response as Record<string, unknown>)?.body as Record<string, unknown>;
  if (items) {
    const itemList = (items.items as Record<string, unknown>)?.item;
    if (Array.isArray(itemList)) return itemList[0] ?? null;
    if (itemList && typeof itemList === 'object') return itemList;
  }
  // flat 배열
  if (Array.isArray(b.items)) return b.items[0] ?? null;
  if (Array.isArray(b.data)) return b.data[0] ?? null;
  // 최상위 자체가 단건
  return b;
}

export async function fetchSeibroShort(stockCode: string): Promise<SeibroShortData | null> {
  const apiKey = process.env.SEIBRO_API_KEY;
  if (!apiKey) {
    logger.warn(SOURCE, 'missing_api_key', { stockCode });
    return null;
  }

  const cacheKey = `seibro:short:${stockCode}`;
  const redis = createRedis();

  // Redis 캐시 히트
  if (redis) {
    try {
      const cached = await redis.get<SeibroShortData>(cacheKey);
      if (cached) {
        logger.info(SOURCE, 'cache_hit', { stockCode });
        return cached;
      }
    } catch { /* ignore */ }
  }

  try {
    const [shortRaw, borrowRaw] = await Promise.all([
      callEndpoint('/shortsale/getStockSrtSelBal', stockCode, apiKey),
      callEndpoint('/shortsale/getStockBorBal', stockCode, apiKey),
    ]);

    const shortItem = extractFirstItem(shortRaw);
    const borrowItem = extractFirstItem(borrowRaw);

    // 응답 구조 디버그 (개발 중 확인용)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SEIBRO] shortRaw sample:', JSON.stringify(shortItem)?.slice(0, 200));
      console.log('[SEIBRO] borrowRaw sample:', JSON.stringify(borrowItem)?.slice(0, 200));
    }

    if (!shortItem && !borrowItem) {
      logger.warn(SOURCE, 'no_data', { stockCode });
      return null;
    }

    const result = parseResponse(stockCode, shortItem ?? {}, borrowItem ?? {});

    await loggedRedisSet(redis, SOURCE, cacheKey, result, { ex: CACHE_TTL });
    return result;
  } catch (err) {
    logger.error(SOURCE, 'fetch_error', { stockCode, error: err });
    return null;
  }
}
