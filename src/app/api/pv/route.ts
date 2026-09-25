/**
 * /api/pv — 페이지 조회 비콘 수신(자가호스팅 방문자 측정, 2026-09-25).
 * PageViewBeacon 이 sendBeacon 으로 {p, r, u} 를 보낸다. 봇은 visits-core 가 거른다.
 * 남용 방어: IP 당 분당 60건(메모리), 본문 1KB 컷. 응답은 204 — 본문 없음.
 */
import { NextRequest, NextResponse } from 'next/server';
import { recordView } from '@/lib/visits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const hits = new Map<string, { n: number; at: number }>();

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const now = Date.now();
    const h = hits.get(ip);
    if (h && now - h.at < 60_000) { if (++h.n > 60) return new NextResponse(null, { status: 429 }); }
    else hits.set(ip, { n: 1, at: now });
    if (hits.size > 5000) hits.clear();   // 메모리 상한 — 분당 제한이 잠깐 풀리는 편이 낫다

    const raw = await req.text();
    if (raw.length > 1024) return new NextResponse(null, { status: 413 });
    const b = JSON.parse(raw) as { p?: string; r?: string; u?: string };
    if (!b.p || typeof b.p !== 'string') return new NextResponse(null, { status: 400 });
    recordView({
      path: b.p, referrer: b.r, utm: b.u,
      ua: req.headers.get('user-agent') ?? '', ip,
      country: req.headers.get('cf-ipcountry') ?? undefined,
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 400 });
  }
}
