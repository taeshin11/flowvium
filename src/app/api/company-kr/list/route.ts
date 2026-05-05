/**
 * GET /api/company-kr/list
 *
 * KOSPI 200 + KOSDAQ 150 기업 목록 및 기본 정보를 반환합니다.
 * companies-kr.ts의 정적 메타데이터 + DART corp_code (Redis 캐시)를 결합.
 *
 * 쿼리 파라미터:
 *   market = 'KOSPI' | 'KOSDAQ' | 'all' (기본: all)
 *   sector = 섹터명 (기본: all)
 *
 * Redis 캐시 7일.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { loggedRedisSet, logger } from '@/lib/logger';
import { getDartCorpInfo } from '@/lib/dart-financials';
import { companiesKR } from '@/data/companies-kr';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LIST_TTL = 7 * 24 * 3600;
const CDN_HEADERS = {
  'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const marketFilter = searchParams.get('market')?.toUpperCase() ?? 'ALL';
  const sectorFilter = searchParams.get('sector') ?? '';

  const redis = createRedis();
  const cacheKey = `flowvium:dart:kr-list:v1:${marketFilter}:${sectorFilter || 'all'}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
      }
    } catch { /* non-fatal */ }
  }

  let filtered = companiesKR;
  if (marketFilter !== 'ALL') {
    filtered = filtered.filter(c => c.market === marketFilter);
  }
  if (sectorFilter) {
    filtered = filtered.filter(c => c.sector.toLowerCase().includes(sectorFilter.toLowerCase()));
  }

  // corp_code는 캐시에서 조회 (DART API 호출은 첫 조회 시에만)
  const items = await Promise.all(
    filtered.map(async (c) => {
      let corpCode: string | null = null;
      let corpCls: string | null = null;
      if (redis) {
        try {
          const info = await getDartCorpInfo(c.stockCode, redis);
          corpCode = info?.corpCode ?? null;
          corpCls  = info?.corpCls  ?? null;
        } catch { /* non-fatal */ }
      }
      return { ...c, corpCode, corpCls };
    })
  );

  const result = {
    total: items.length,
    marketFilter,
    sectorFilter: sectorFilter || null,
    companies: items,
    updatedAt: new Date().toISOString(),
    source: 'dart+static',
  };

  if (redis) {
    await loggedRedisSet(redis, 'api.company-kr.list', cacheKey, result, { ex: LIST_TTL });
  } else {
    logger.warn('dart.api', 'redis_unavailable', 'Redis 없음 — company-kr list 캐시 불가');
  }

  return NextResponse.json(result, { headers: CDN_HEADERS });
}
