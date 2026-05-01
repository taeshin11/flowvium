/**
 * /api/cascade-events
 *
 * Returns AI-auto-logged cascade events from Redis.
 * Populated by /api/cron/log-cascade-events (weekly cron).
 *
 * Query params:
 *   sector (optional) — filter by leaderSector
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export interface CascadeEvent {
  date: string;
  leader: string;
  leaderSector: string;
  leaderMove: string;
  followers: string[];
  description: string;
  generatedAt: string;
}

const REDIS_KEY = 'flowvium:cascade:events:v1';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sectorFilter = searchParams.get('sector') ?? '';

  const redis = createRedis();
  if (!redis) {
    return NextResponse.json([], { status: 200 });
  }

  try {
    const raw: unknown[] = await redis.lrange(REDIS_KEY, 0, -1);
    const events: CascadeEvent[] = raw
      .map((item) => {
        try {
          return typeof item === 'string' ? (JSON.parse(item) as CascadeEvent) : (item as CascadeEvent);
        } catch {
          return null;
        }
      })
      .filter((e): e is CascadeEvent => e !== null);

    const filtered = sectorFilter
      ? events.filter(
          (e) => e.leaderSector?.toLowerCase() === sectorFilter.toLowerCase(),
        )
      : events;

    // Sort by date descending
    filtered.sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json(filtered, {
      headers: { 'Cache-Control': 'public, s-maxage=3600' },
    });
  } catch (err) {
    logger.error('cascade-events', 'redis_lrange_error', { error: err });
    return NextResponse.json([], { status: 200 });
  }
}
