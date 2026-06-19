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

// 2026-06-19 보안: 공개 하드코딩 폴백 제거 — env 비밀키 없으면 throw(fail-closed). 이전엔 env 분실 시
//   소스에 박힌 'flowvium-member-v1' 로 서명해 *누구나 임의 이메일 쿠키 위조 가능* 했음. 미설정은 위조보다
//   가입 불가가 안전. (운영 .env.local 엔 CRON_SECRET 존재 → 평시 영향 없음, 오설정 방어.)
function secret(): string {
  const s = process.env.MEMBER_SECRET ?? process.env.CRON_SECRET;
  if (!s) throw new Error('MEMBER_SECRET/CRON_SECRET unset — refuse public-fallback signing');
  return s;
}
function sign(email: string): string {
  const b64 = Buffer.from(email.toLowerCase()).toString('base64url');
  const mac = createHmac('sha256', secret()).update(b64).digest('base64url').slice(0, 24);
  return `${b64}.${mac}`;
}
function verify(token: string | undefined): string | null {
  if (!token) return null;
  try {  // secret() throw·디코드 실패 등 모든 오류 → 비회원(fail-closed)
    const [b64, mac] = token.split('.');
    if (!b64 || !mac) return null;
    const expect = createHmac('sha256', secret()).update(b64).digest('base64url').slice(0, 24);
    if (mac !== expect) return null;
    return Buffer.from(b64, 'base64url').toString('utf8');
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const email = verify(req.cookies.get(COOKIE)?.value);
  // 이메일 일부 마스킹해 프로필 표시용 반환 (a***@domain)
  const masked = email ? email.replace(/^(.).*(@.*)$/, (_, a, d) => `${a}***${d}`) : null;
  return NextResponse.json({ member: !!email, email: masked });
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json() as { email?: string };
    const e = (email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 254) {
      return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
    }
    const redis = createRedis();
    // 2026-06-19 보안: 가입 레이트리밋(IP 시간당 10) — 비인증 POST 가 Redis SET 에 쓰므로 명단 bloat·남용 방지.
    //   내부/loopback 직호출은 면제(테스트). cloudflared 가 공인 client IP 를 XFF 로 넣음.
    const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const ip = xff || req.headers.get('x-real-ip') || '127.0.0.1';
    const internal = (!xff && !req.headers.get('x-real-ip')) || /^(::1|::ffff:127\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
    if (redis && !internal) {
      try {
        const rlKey = `flowvium:member:rl:${ip}`;
        const n = await redis.incr(rlKey);
        if (n === 1) await redis.expire(rlKey, 3600);
        if (n > 10) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
      } catch { /* rl 실패는 비치명 — 가입 막지 않음 */ }
    }
    if (redis) {
      try { await redis.sadd(MEMBERS_KEY, e); } catch (err) { logger.warn('api.member', 'sadd_failed', { error: err }); }
    }
    logger.info('api.member', 'registered', { domain: e.split('@')[1] });
    const res = NextResponse.json({ ok: true, member: true });
    // secure: 운영은 HTTPS(cloudflared) → Secure 플래그로 평문 HTTP 전송 차단(best practice).
    res.cookies.set(COOKIE, sign(e), { httpOnly: true, secure: true, sameSite: 'lax', maxAge: COOKIE_MAX_AGE, path: '/' });
    return res;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
}
