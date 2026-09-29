/**
 * mail-subs.ts — 아침보고서 메일 수신자 기록(서버). scripts/lib/mail-store.mjs 와 같은 키·모양. (2026-09-30)
 *   flowvium:mail:subs   HASH email → JSON {status: active|pending|unsubscribed, token, consentAt, consentSource, invitedAt, unsubAt}
 *   flowvium:mail:tokens HASH token → email
 * 링크는 이메일이 아니라 추측할 수 없는 토큰으로 — 남의 수신을 바꾸지 못하게.
 */
import { randomBytes } from 'crypto';
import { createRedis } from '@/lib/redis';

export const SUBS_KEY = 'flowvium:mail:subs';
export const TOKENS_KEY = 'flowvium:mail:tokens';

export interface MailSub {
  status?: 'active' | 'pending' | 'unsubscribed';
  token?: string; consentAt?: string; consentSource?: string; invitedAt?: string; unsubAt?: string;
}

const parse = (v: unknown): MailSub => {
  if (!v) return {};
  if (typeof v === 'object') return v as MailSub;   // @upstash/redis 가 JSON 을 풀어 줄 때가 있다
  try { return JSON.parse(String(v)) as MailSub; } catch { return {}; }
};

export async function upsertMailSub(email: string, patch: MailSub): Promise<MailSub | null> {
  const redis = createRedis();
  if (!redis) return null;
  const e = email.trim().toLowerCase();
  const cur = parse(await redis.hget(SUBS_KEY, e));
  const next: MailSub = { ...cur, ...patch, token: cur.token ?? randomBytes(24).toString('base64url') };
  await redis.hset(SUBS_KEY, { [e]: JSON.stringify(next) });
  if (!cur.token) await redis.hset(TOKENS_KEY, { [next.token!]: e });
  return next;
}

/** 토큰으로 상태를 바꾼다. 모르는 토큰이면 null. */
export async function setStatusByToken(token: string, status: 'active' | 'unsubscribed', source: string): Promise<string | null> {
  const redis = createRedis();
  if (!redis || !token || token.length > 100) return null;
  const email = await redis.hget<string>(TOKENS_KEY, token);
  if (!email) return null;
  const now = new Date().toISOString();
  await upsertMailSub(String(email), status === 'active'
    ? { status, consentAt: now, consentSource: source }
    : { status, unsubAt: now });
  return String(email);
}
