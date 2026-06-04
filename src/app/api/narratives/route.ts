/**
 * /api/narratives
 *
 * macro-narratives 의 8개 구조적 테마 정의(정적·시간불변 — 규제포획/칸티용효과/다크풀 등)에
 * **라이브 intensity** 를 overlay 한다. 정의 자체는 구조/교육 데이터라 정적이 정당하지만,
 * 각 테마의 *현재 강도*(관련 종목 모멘텀 + 관련 섹터 자금흐름)는 매일 변하는 동적 신호.
 *
 * intensity 산출:
 *   - relatedTickers 평균 changePct (stooq 배치) → tickerMomentum
 *   - relatedSectors 평균 ret4w (capital-flows sectorPerformance) → sectorMomentum
 *   - intensity = clamp(50 + (0.6*sectorMomentum + 0.4*tickerMomentum*5), 5, 100)
 *   - direction: heating(>=58) / cooling(<=42) / neutral
 *
 * source: 'live'(시세 수신) | 'static'(전부 실패 — 정의만). check-data-quality 가 감지.
 * 캐시: Redis 4h + 모듈 메모리 30m. 56개 ticker stooq 배치 1회라 요청당 부하 제한.
 */

import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { macroNarratives } from '@/data/macro-narratives';
import { fetchStooqQuotes } from '@/lib/stooq';
import { logger, loggedRedisSet } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const REDIS_KEY = 'flowvium:narratives:v1';
const CACHE_TTL_S = 4 * 60 * 60;
const MEM_TTL_MS = 30 * 60 * 1000;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=3600' };

// narrative relatedSectors id → capital-flows sectorPerformance id (SPDR 11 섹터 기준).
//   defense/real-estate 등 비-SPDR 은 가장 가까운 SPDR 섹터로 매핑.
const SECTOR_MAP: Record<string, string> = {
  defense: 'industrials',
  financials: 'financials',
  healthcare: 'healthcare',
  'real-estate': 'real-estate',
  energy: 'energy',
  tech: 'tech',
  technology: 'tech',
  materials: 'materials',
  utilities: 'utilities',
  industrials: 'industrials',
  'consumer-disc': 'consumer-disc',
  'consumer-staples': 'consumer-staples',
  communication: 'communication',
};

interface NarrativeIntensity {
  id: string;
  intensity: number;        // 0-100
  direction: 'heating' | 'cooling' | 'neutral';
  tickerMomentum: number;   // 평균 changePct
  sectorMomentum: number;   // 평균 ret4w
  topMovers: Array<{ ticker: string; changePct: number }>;
  liveData: boolean;
}

interface NarrativesResponse {
  intensities: NarrativeIntensity[];
  source: 'live' | 'static';
  liveCount: number;
  updatedAt: string;
  cached?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MEM_CACHE: { data: any; expiresAt: number } | null = null;

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

async function fetchSectorPerf(): Promise<Record<string, number>> {
  // capital-flows 의 sectorPerformance(ret4w) 를 sector id → ret4w 맵으로.
  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const res = await fetch(`${base}/api/capital-flows`, { signal: AbortSignal.timeout(12000), cache: 'no-store' });
    if (!res.ok) return {};
    const j = await res.json();
    const out: Record<string, number> = {};
    for (const s of (j.sectorPerformance ?? [])) {
      if (s?.id && typeof s.ret4w === 'number') out[s.id] = s.ret4w;
    }
    return out;
  } catch { return {}; }
}

async function buildNarratives(): Promise<NarrativesResponse> {
  // 8개 narrative 의 전체 relatedTickers 합집합 → stooq 배치 1회.
  const allTickers = Array.from(new Set(macroNarratives.flatMap(n => n.relatedTickers)));
  const [quotes, sectorPerf] = await Promise.all([
    fetchStooqQuotes(allTickers).catch(() => []),
    fetchSectorPerf(),
  ]);
  const quoteMap = new Map(quotes.map(q => [q.symbol, q.changePct]));

  const intensities: NarrativeIntensity[] = macroNarratives.map(n => {
    const tickerPcts = n.relatedTickers
      .map(t => quoteMap.get(t))
      .filter((v): v is number => typeof v === 'number');
    const tickerMomentum = tickerPcts.length
      ? parseFloat((tickerPcts.reduce((a, b) => a + b, 0) / tickerPcts.length).toFixed(2)) : 0;

    const sectorRets = n.relatedSectors
      .map(s => sectorPerf[SECTOR_MAP[s] ?? s])
      .filter((v): v is number => typeof v === 'number');
    const sectorMomentum = sectorRets.length
      ? parseFloat((sectorRets.reduce((a, b) => a + b, 0) / sectorRets.length).toFixed(2)) : 0;

    const liveData = tickerPcts.length > 0 || sectorRets.length > 0;
    const intensity = clamp(Math.round(50 + 0.6 * sectorMomentum + 0.4 * tickerMomentum * 5), 5, 100);
    const direction = intensity >= 58 ? 'heating' : intensity <= 42 ? 'cooling' : 'neutral';

    const topMovers = n.relatedTickers
      .map(t => ({ ticker: t, changePct: quoteMap.get(t) }))
      .filter((m): m is { ticker: string; changePct: number } => typeof m.changePct === 'number')
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, 3);

    return { id: n.id, intensity, direction, tickerMomentum, sectorMomentum, topMovers, liveData };
  });

  const liveCount = intensities.filter(i => i.liveData).length;
  return {
    intensities,
    source: liveCount > 0 ? 'live' : 'static',
    liveCount,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  if (MEM_CACHE && Date.now() < MEM_CACHE.expiresAt) {
    return NextResponse.json({ ...MEM_CACHE.data, cached: true }, { headers: CDN_HEADERS });
  }
  const redis = createRedis();
  if (redis) {
    try {
      const cached = await redis.get<NarrativesResponse>(REDIS_KEY);
      if (cached) {
        MEM_CACHE = { data: cached, expiresAt: Date.now() + MEM_TTL_MS };
        return NextResponse.json({ ...cached, cached: true }, { headers: CDN_HEADERS });
      }
    } catch { /* non-fatal */ }
  }

  let response: NarrativesResponse;
  try {
    response = await buildNarratives();
  } catch (err) {
    logger.error('narratives', 'build_failed', { error: err });
    // 시계열 신호 실패 → 정적 정의만(intensity 미산출). 빈 overlay, source=static.
    response = { intensities: [], source: 'static', liveCount: 0, updatedAt: new Date().toISOString() };
  }

  MEM_CACHE = { data: response, expiresAt: Date.now() + MEM_TTL_MS };
  if (redis && response.source === 'live') {
    try { await loggedRedisSet(redis, 'api.narratives', REDIS_KEY, response, { ex: CACHE_TTL_S }); }
    catch (err) { logger.error('narratives', 'save_failed', { error: err }); }
  }
  return NextResponse.json(response, { headers: CDN_HEADERS });
}
