#!/usr/bin/env node
/**
 * mail-store.test.mjs — 메일 수신자 기록(Redis)과 Resend 발송. 네트워크·운영 Redis 를 건드리지 않는다(가짜 cmd·fetch).
 *   기록: flowvium:mail:subs  HASH email → {status: active|pending|unsubscribed, token, consentAt, consentSource, invitedAt, unsubAt}
 *         flowvium:mail:tokens HASH token → email (수신거부·동의 링크는 이메일이 아니라 추측 불가능한 토큰으로)
 */
import { listSubs, upsertSub, markSent, sentSet, deliverable } from './mail-store.mjs';
import { sendMail } from './mailer.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// 가짜 Redis — 명령 배열을 받는 REST 모양
const db = new Map();
const cmd = async ([op, key, ...a]) => {
  const h = db.get(key) ?? new Map();
  if (op === 'HGETALL') return [...h.entries()].flat();
  if (op === 'HGET') return h.get(a[0]) ?? null;
  if (op === 'HSET') { for (let i = 0; i < a.length; i += 2) h.set(a[i], a[i + 1]); db.set(key, h); return 1; }
  if (op === 'SADD') { const s = db.get(key) ?? new Set(); a.forEach((x) => s.add(x)); db.set(key, s); return 1; }
  if (op === 'SMEMBERS') return [...(db.get(key) ?? new Set())];
  if (op === 'EXPIRE') return 1;
  throw new Error(`op ${op}`);
};
{
  const a = await upsertSub('A@X.com', { status: 'pending', invitedAt: 't0' }, { cmd });
  const b = await upsertSub('a@x.com', { status: 'active', consentAt: 't1', consentSource: 'invite' }, { cmd });
  const subs = await listSubs({ cmd });
  (a.token && a.token === b.token && a.token.length >= 32 && subs.length === 1 && subs[0].status === 'active' && subs[0].invitedAt === 't0')
    ? ok('[1] 소문자로 합치고, 토큰은 한 번 만들어 유지, 필드는 덧붙인다') : bad(`[1] ${JSON.stringify(subs)}`);
  const tok = await cmd(['HGET', 'flowvium:mail:tokens', a.token]);
  tok === 'a@x.com' ? ok('[2] 토큰 → 이메일 찾기') : bad(`[2] ${tok}`);
  await markSent('2026-09-30', 'a@x.com', { cmd });
  (await sentSet('2026-09-30', { cmd })).has('a@x.com') ? ok('[3] 오늘 보낸 사람 기록') : bad('[3]');
}
// [4] Resend: 키 없으면 부르지 않고 실패 · 있으면 올바른 요청 · 오류는 사유로
{
  let called = 0;
  const r0 = await sendMail({ to: 'a@x.com', subject: 's', html: 'h', text: 't' }, { env: {}, fetchImpl: async () => { called++; } });
  (!r0.ok && /RESEND_API_KEY/.test(r0.reason) && called === 0) ? ok('[4] 키 없으면 안 부른다') : bad(`[4] ${JSON.stringify(r0)}`);
  let req = null;
  const r1 = await sendMail({ to: 'a@x.com', subject: 's', html: 'h', text: 't', headers: { 'List-Unsubscribe': '<u>' } },
    { env: { RESEND_API_KEY: 'k', MAIL_FROM: 'FlowVium <report@flowvium.net>' }, fetchImpl: async (url, o) => { req = { url, o }; return { ok: true, status: 200, json: async () => ({ id: 'e1' }) }; } });
  const body = JSON.parse(req?.o?.body ?? '{}');
  (r1.ok && r1.id === 'e1' && req.url === 'https://api.resend.com/emails' && req.o.headers.Authorization === 'Bearer k'
    && body.to[0] === 'a@x.com' && body.from.includes('flowvium.net') && body.headers['List-Unsubscribe'] === '<u>')
    ? ok('[4b] 요청 모양(주소·인증·받는이·보낸이·헤더)') : bad(`[4b] ${JSON.stringify({ r1, body })}`);
  const r2 = await sendMail({ to: 'a@x.com', subject: 's', html: 'h', text: 't' },
    { env: { RESEND_API_KEY: 'k', MAIL_FROM: 'x@flowvium.net' }, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ name: 'validation_error', message: 'domain not verified' }) }) });
  (!r2.ok && /403/.test(r2.reason) && /domain not verified/.test(r2.reason)) ? ok(`[4c] 오류는 사유로(${r2.reason})`) : bad(`[4c] ${JSON.stringify(r2)}`);
  const r3 = await sendMail({ to: 'a@x.com', subject: 's', html: 'h', text: 't' }, { env: { RESEND_API_KEY: 'k' }, fetchImpl: async () => ({ ok: true }) });
  (!r3.ok && /MAIL_FROM/.test(r3.reason)) ? ok('[4d] 보낸이 주소 없으면 안 보낸다') : bad(`[4d] ${JSON.stringify(r3)}`);
}
// [5] 예약 도메인은 받을 수 없다
{
  const good = ['a@gmail.com', 'b@naver.com', 'c@sub.example-co.kr'].every(deliverable);
  const badOnes = ['g@example.com', 'x@mail.example.org', 'y@foo.test', 'z@a.invalid', 'w@localhost', 'noat'].some(deliverable);
  (good && !badOnes) ? ok('[5] 예약 도메인(example.com·.test·.invalid·localhost)은 빼고, 실제 도메인은 남긴다') : bad('[5]');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
