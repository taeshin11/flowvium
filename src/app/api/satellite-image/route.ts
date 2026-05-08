/**
 * /api/satellite-image?id={factoryId}
 *
 * Sentinel-2 위성 이미지를 Redis에서 읽어 PNG로 반환.
 * 이미지는 scripts/satellite-factory-scan.mjs 가 스캔 시 저장.
 * Redis 키: flowvium:satellite:img:{factoryId} (7일 TTL)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !/^[a-z0-9\-]+$/.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const redis = createRedis();
    const key = `flowvium:satellite:img:${id}`;
    const base64 = await redis.get<string>(key);

    if (!base64) {
      return NextResponse.json({ error: 'image not found — run npm run scan:satellite first' }, { status: 404 });
    }

    const buffer = Buffer.from(base64, 'base64');
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400', // 24h browser cache
        'X-Factory-Id': id,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
