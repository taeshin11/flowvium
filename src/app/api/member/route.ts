/**
 * /api/member — 경량 이메일 회원 (2026-06-13, 사용자 "장중 보고서는 회원가입 해야 보이게").
 *
 * v1 설계: 비밀번호/결제 없는 가입 유도형 — 이메일 등록 → HMAC 서명 쿠키 발급 → 게이트 해제.
 *   - 저장: Upstash Redis SET flowvium:members:emails (SQLite 는 보고서 파이프라인과 writer 경합 회피)
 *   - 쿠키: fv_member = base64(email).hmac (MEMBER_SECRET 또는 CRON_SECRET 파생)
 *   - POST { email } → 등록 + 쿠키 / GET → { member: boolean }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { createRedis } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const MEMBERS_KEY = 'flowvium:members:emails';
const COOKIE = 'fv_member';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

function secret(): string {
  return process.env.MEMBER_SECRET ?? process.env.CRON_SECRET ?? 'flowvium-member-v1';
}
function sign(email: string): string {
  const b64 = Buffer.from(email.toLowerCase()).toString('base64url');
  const mac = createHmac('sha256', secret()).update(b64).digest('base64url').slice(0, 24);
  return `${b64}.${mac}`;
}
function verify(token: string | undefined): string | null {
  if (!token) return null;
  const [b64, mac] = token.split('.');
  if (!b64 || !mac) return null;
  const expect = createHmac('sha256', secret()).update(b64).digest('base64url').slice(0, 24);
  if (mac !== expect) return null;
  try { return Buffer.from(b64, 'base64url').toString('utf8'); } catch { return null; }
}

export async function GET(req: NextRequest) {
  const email = verify(req.cookies.get(COOKIE)?.value);
  return NextResponse.json({ member: !!email });
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json() as { email?: string };
    const e = (email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 254) {
      return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
    }
    const redis = createRedis();
    if (redis) {
      try { await redis.sadd(MEMBERS_KEY, e); } catch (err) { logger.warn('api.member', 'sadd_failed', { error: err }); }
    }
    logger.info('api.member', 'registered', { domain: e.split('@')[1] });
    const res = NextResponse.json({ ok: true, member: true });
    res.cookies.set(COOKIE, sign(e), { httpOnly: true, sameSite: 'lax', maxAge: COOKIE_MAX_AGE, path: '/' });
    return res;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
}
