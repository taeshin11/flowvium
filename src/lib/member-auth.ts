/**
 * member-auth.ts — fv_member HMAC 쿠키 검증 재사용 헬퍼 (2026-06-18 신설)
 * /api/member/route.ts 의 sign/verify 와 동일 비밀키·형식. 여러 라우트가 현재 회원을 식별할 때 사용.
 */
import type { NextRequest } from 'next/server';
import { createHmac } from 'crypto';

const COOKIE = 'fv_member';
// 2026-06-19(ChatGPT #16): dual-key rotation — 검증은 [CURRENT, PREVIOUS, CRON] 모두 시도(무중단 키교체).
//   공개 하드코딩 폴백 제거(위조 방지). /api/member 와 동일 정책. 미설정이면 빈 배열 → 전부 null(fail-closed).
function verifySecrets(): string[] {
  return [process.env.MEMBER_SECRET, process.env.MEMBER_SECRET_PREVIOUS, process.env.CRON_SECRET].filter((x): x is string => !!x);
}

/** fv_member 쿠키 → 로그인 이메일(소문자). 비로그인/위조/비밀키미설정 시 null(fail-closed). */
export function getMemberEmail(req: NextRequest): string | null {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const [b64, mac] = token.split('.');
    if (!b64 || !mac) return null;
    const ok = verifySecrets().some(sec => mac === createHmac('sha256', sec).update(b64).digest('base64url').slice(0, 24));
    if (!ok) return null;
    return Buffer.from(b64, 'base64url').toString('utf8');
  } catch { return null; }
}

/** 채팅 히스토리 소유자 ID — 로그인 시 email, 아니면 익명 쿠키 ID(없으면 null → 호출측이 발급). */
export function getChatUid(req: NextRequest): { uid: string; isMember: boolean; anonId: string | null } {
  const email = getMemberEmail(req);
  if (email) return { uid: `m:${email}`, isMember: true, anonId: null };
  const anon = req.cookies.get('fv_chat_uid')?.value || null;
  return { uid: anon ? `a:${anon}` : '', isMember: false, anonId: anon };
}
