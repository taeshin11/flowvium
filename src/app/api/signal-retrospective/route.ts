/**
 * /api/signal-retrospective
 * Read-only endpoint — returns the latest AI-generated signal retrospective from Redis.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { RETROSPECTIVE_KEY, type SignalRetrospective } from '@/lib/signal-accuracy';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const redis = createRedis();
  if (!redis) return NextResponse.json({ error: 'no redis' }, { status: 503 });

  try {
    const raw = await redis.get(RETROSPECTIVE_KEY);
    if (!raw) return NextResponse.json({ error: 'not_ready' }, { status: 404 });
    const data = typeof raw === 'string' ? JSON.parse(raw) as SignalRetrospective : raw as SignalRetrospective;
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
