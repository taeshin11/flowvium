/**
 * /api/satellite-signals
 *
 * Sentinel-2 위성사진 기반 공장 활동 지수.
 * 데이터는 scripts/satellite-factory-scan.mjs 가 매일 Redis에 저장.
 *
 * Cache: Redis 48h, CDN 6h
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

interface FactorySignal {
  id: string;
  ticker: string;
  name: string;
  country: string;
  tags: string[];
  significance: 'critical' | 'major' | 'moderate';
  activityScore: number | null;
  vehicleDensity: 'low' | 'medium' | 'high' | null;
  cloudCoverage: 'clear' | 'partial' | 'heavy' | null;
  loadingActivity: 'inactive' | 'normal' | 'busy' | null;
  constructionVisible: boolean | null;
  confidence: 'low' | 'medium' | 'high' | null;
  summary: string | null;
  imageDate: string | null;
  scannedAt: string;
  error?: string;
}

const REDIS_KEY_PREFIX = 'flowvium:satellite:v1';
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=3600' };

export async function GET() {
  const redis = createRedis();
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

  // Try today → yesterday → 2 days ago
  let signals: FactorySignal[] | null = null;
  let dataDate: string | null = null;

  for (let d = 0; d <= 5 && !signals; d++) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const key = `${REDIS_KEY_PREFIX}:${date}`;
    try {
      const raw = await redis?.get<string>(key);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        signals = parsed.results ?? null;
        dataDate = date;
      }
    } catch { /* continue */ }
  }

  if (!signals) {
    return NextResponse.json(
      {
        signals: [],
        dataDate: null,
        message: 'satellite scan 데이터 없음. scripts/satellite-factory-scan.mjs 실행 필요.',
        source: 'none',
      },
      { headers: CDN_HEADERS }
    );
  }

  // 히스토리 enrichment (factory별 30일 점수 시계열)
  const enriched = await Promise.all(signals.map(async (s) => {
    try {
      const raw = await redis?.get<string>(`flowvium:satellite:history:${s.id}`);
      const hist = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      return { ...s, history: (hist as { points?: unknown[] } | null)?.points ?? [] };
    } catch {
      return { ...s, history: [] };
    }
  }));

  return NextResponse.json(
    {
      signals: enriched,
      dataDate,
      count: enriched.length,
      source: 'sentinel-1-sar-copernicus',
      updatedAt: new Date().toISOString(),
    },
    { headers: CDN_HEADERS }
  );
}
