/**
 * mail-store.mjs — 아침보고서 메일 수신자 기록(Upstash Redis). 사이트(src/lib/mail-subs.ts)와 같은 키·모양을 쓴다.
 *   flowvium:mail:subs   HASH email → JSON {status, token, consentAt, consentSource, invitedAt, unsubAt}
 *   flowvium:mail:tokens HASH token → email
 *   flowvium:mail:sent:<KST날짜> SET email (같은 날 두 번 안 보낸다, 7일 보관)
 */
import { randomBytes } from 'crypto';
import { loadEnvLocal } from './llm-config.mjs';

export const SUBS_KEY = 'flowvium:mail:subs';
export const TOKENS_KEY = 'flowvium:mail:tokens';
export const MEMBERS_KEY = 'flowvium:members:emails';
const sentKey = (d) => `flowvium:mail:sent:${d}`;

/** 운영 Redis REST 명령. 테스트는 opts.cmd 로 바꿔 끼운다. */
export async function redisCmd(args, { env = loadEnvLocal() } = {}) {
  const r = await fetch(env.UPSTASH_REDIS_REST_URL, {
    method: 'POST', headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`redis ${args[0]}: ${j.error}`);
  return j.result;
}

export async function listSubs({ cmd = redisCmd } = {}) {
  const flat = (await cmd(['HGETALL', SUBS_KEY])) ?? [];
  const out = [];
  for (let i = 0; i < flat.length; i += 2) { try { out.push({ email: flat[i], ...JSON.parse(flat[i + 1]) }); } catch { /* 깨진 줄은 건너뛴다 */ } }
  return out;
}

export async function upsertSub(email, patch, { cmd = redisCmd } = {}) {
  const e = String(email).trim().toLowerCase();
  let cur = {};
  try { cur = JSON.parse((await cmd(['HGET', SUBS_KEY, e])) ?? '{}'); } catch { cur = {}; }
  const next = { ...cur, ...patch, token: cur.token ?? randomBytes(24).toString('base64url') };
  await cmd(['HSET', SUBS_KEY, e, JSON.stringify(next)]);
  if (!cur.token) await cmd(['HSET', TOKENS_KEY, next.token, e]);
  return next;
}

export async function listMembers({ cmd = redisCmd } = {}) { return (await cmd(['SMEMBERS', MEMBERS_KEY])) ?? []; }
export async function sentSet(day, { cmd = redisCmd } = {}) { return new Set((await cmd(['SMEMBERS', sentKey(day)])) ?? []); }
export async function markSent(day, email, { cmd = redisCmd } = {}) {
  await cmd(['SADD', sentKey(day), email]);
  await cmd(['EXPIRE', sentKey(day), String(7 * 86400)]);
}

/**
 * 실제로 받을 수 있는 주소인가 — RFC 2606/6761 예약 도메인(example.*, *.test, *.invalid, *.localhost, *.example)은
 *   받는 서버가 없다. 가입 게이트 시험에 쓴 g…@example.com 이 가입자 명단에 있었다(9/30). 보내면 반송돼 발송 평판만 깎인다.
 */
export function deliverable(email) {
  const d = String(email ?? '').toLowerCase().split('@')[1] ?? '';
  if (!d || !d.includes('.')) return false;
  return !/(^|\.)example\.(com|net|org)$|\.(test|invalid|localhost|example)$|^localhost$/.test(d);
}
