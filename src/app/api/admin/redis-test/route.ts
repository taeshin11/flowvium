import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { loggedRedisSet } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const redis = createRedis();
  if (!redis) return NextResponse.json({ error: 'no redis' });

  const TEST_KEY = 'flowvium:test:array:v1';
  const testData = [{ id: 1, ts: new Date().toISOString(), msg: 'test' }];

  try {
    // Write
    await loggedRedisSet(redis, 'test', TEST_KEY, testData, { ex: 300 });

    // Read back
    const read1 = await redis.get(TEST_KEY);
    const read2 = await redis.get<typeof testData>(TEST_KEY);

    // Also test history key
    const HIST_KEY = 'flowvium:investment-strategy:history:arr:v1';
    const histRaw = await redis.get(HIST_KEY);

    return NextResponse.json({
      write: testData,
      read1_typeof: typeof read1,
      read1_isArray: Array.isArray(read1),
      read1: read1,
      read2_typeof: typeof read2,
      read2_isArray: Array.isArray(read2),
      read2: read2,
      histKey_typeof: typeof histRaw,
      histKey_isArray: Array.isArray(histRaw),
      histKey_length: Array.isArray(histRaw) ? histRaw.length : 'N/A',
      histKey_raw: histRaw,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
