#!/usr/bin/env node
/**
 * mail-invite.mjs — 기존 가입자에게 아침보고서 메일 수신 동의 요청을 **한 번** 보낸다. (2026-09-30 사장님 선택)
 *   가입(flowvium:members:emails)은 보고서를 보려고 이메일을 남긴 것이지 메일 수신 동의가 아니다.
 *   동의 버튼을 누른 사람만 active 가 된다(사이트 /ko/mail?a=confirm). 한 번 보낸 사람(invitedAt)에겐 다시 안 보낸다.
 * 사용: node scripts/mail-invite.mjs          (미리보기 — 몇 명에게 갈지만)
 *       node scripts/mail-invite.mjs --send   (실제 발송)
 */
import { listMembers, listSubs, upsertSub, deliverable } from './lib/mail-store.mjs';
import { buildInviteMail } from './lib/report-mail.mjs';
import { sendMail } from './lib/mailer.mjs';

const SEND = process.argv.includes('--send');
const SITE = process.env.PUBLIC_SITE_URL || 'https://flowvium.net';
const mask = (e) => e.replace(/^(.).*(@.*)$/, '$1***$2');
const members = (await listMembers()).map((e) => String(e).toLowerCase());
const subs = new Map((await listSubs()).map((s) => [s.email, s]));
const skipped = members.filter((e) => !deliverable(e));
if (skipped.length) console.log(`받을 수 없는 주소(예약 도메인) ${skipped.length}명은 건너뛴다: ${skipped.map(mask).join(', ')}`);
const todo = members.filter((e) => deliverable(e) && !subs.get(e)?.invitedAt && !['active', 'unsubscribed'].includes(subs.get(e)?.status));
console.log(`가입자 ${members.length}명 · 동의 요청 보낼 사람 ${todo.length}명: ${todo.map(mask).join(', ') || '-'}`);
if (!SEND) { console.log('미리보기 — 보내려면 --send'); process.exit(0); }
for (const e of todo) {
  const rec = await upsertSub(e, { status: subs.get(e)?.status ?? 'pending' });
  const m = buildInviteMail({ confirmUrl: `${SITE}/ko/mail?a=confirm&t=${encodeURIComponent(rec.token)}` });
  const r = await sendMail({ to: e, subject: m.subject, html: m.html, text: m.text });
  if (r.ok) { await upsertSub(e, { invitedAt: new Date().toISOString() }); console.log(`보냄 ${mask(e)}`); }
  else { console.log(`실패 ${mask(e)}: ${r.reason}`); if (/RESEND_API_KEY|MAIL_FROM/.test(r.reason)) break; }
}
