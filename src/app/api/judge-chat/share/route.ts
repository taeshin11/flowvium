/**
 * /api/judge-chat/share — 채팅 대화 공개 링크 공유 (2026-06-18 사용자 "채팅 링크 공유").
 *   POST { convId } → 현재 사용자의 대화를 읽기전용 스냅샷으로 복제 → { shareId } (URL: /{locale}/share/{shareId})
 *   GET  ?id=shareId → 공개 스냅샷 반환(인증 불필요, 읽기전용).
 * 저장: flowvium:judge-chat:share:<id> (90일 TTL). 원본과 분리된 스냅샷이라 원본 수정/삭제와 무관.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createRedis } from '@/lib/redis';
import { loggedRedisSet } from '@/lib/logger';
import { getChatUid } from '@/lib/member-auth';

const SHARE_TTL = 90 * 86400;
const cKey = (uid: string, id: string) => `flowvium:judge-chat:u:${uid}:c:${id}`;
const sKey = (id: string) => `flowvium:judge-chat:share:${id}`;

interface Conv { title?: string; mode?: string; messages?: Array<{ role: string; content: string }>; createdAt?: number }

export async function POST(req: NextRequest) {
  const redis = createRedis();
  if (!redis) return NextResponse.json({ error: 'no_store' }, { status: 503 });
  const { uid } = getChatUid(req);
  let convId = '';
  try { ({ convId } = await req.json() as { convId: string }); } catch { /* */ }
  if (!convId) return NextResponse.json({ error: 'missing_convId' }, { status: 400 });

  const conv = await redis.get<Conv>(cKey(uid, convId));
  if (!conv || !conv.messages?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const shareId = `${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
  const snapshot = {
    title: conv.title ?? '심판엔진 대화',
    mode: conv.mode ?? null,
    messages: conv.messages.map(m => ({ role: m.role, content: m.content })), // 읽기전용 본문만(uid·source 제외)
    createdAt: conv.createdAt ?? Date.now(),
    sharedAt: Date.now(),
  };
  await loggedRedisSet(redis, 'judge-share', sKey(shareId), snapshot, { ex: SHARE_TTL });
  return NextResponse.json({ shareId });
}

export async function GET(req: NextRequest) {
  const redis = createRedis();
  if (!redis) return NextResponse.json({ error: 'no_store' }, { status: 503 });
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!/^[a-z0-9]{6,40}$/.test(id)) return NextResponse.json({ error: 'bad_id' }, { status: 400 });
  const snap = await redis.get(sKey(id));
  if (!snap) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(snap);
}
