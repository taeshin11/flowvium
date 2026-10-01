#!/usr/bin/env node
/**
 * send-morning-mail.mjs — 오늘 아침보고서를 수신 동의한 사람에게 보낸다. (2026-09-30 사장님 "매일매일 아침보고서만 메일로 보내줘")
 *
 * 언제: 아침보고서 업로드 직후 generate-report-local 이 띄운다(session=morning·ko). 라이브 재검(post-publish-recheck)이
 *   이 보고서의 사이트 반영을 확인할 때까지 기다린다(최대 40분) — 메일은 되돌릴 수 없으니 확인된 것만 보낸다.
 * 누구에게: flowvium:mail:subs 에서 status=active(동의함)이고 오늘 아직 안 받은 사람. 사람마다 수신거부 토큰이 다르다.
 * 사용: node scripts/send-morning-mail.mjs [--dry] [--file reports/report-…-morning-ko.json] [--no-wait]
 *   --dry: 보내지 않고 logs/morning-mail-preview.html 에 미리보기, 받을 사람 수만 찍는다.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { buildMorningMail, recipientsFor, mailBlockReason } from './lib/report-mail.mjs';
import { listSubs, sentSet, markSent } from './lib/mail-store.mjs';
import { sendMail } from './lib/mailer.mjs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[mail]', ...a);
const SITE = process.env.PUBLIC_SITE_URL || 'https://flowvium.net';
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

const file = arg('--file') ? resolve(ROOT, arg('--file')) : resolve(ROOT, 'reports', `report-${today}-morning-ko.json`);
if (!existsSync(file)) { log(`오늘 아침보고서 파일이 없다: ${file}`); process.exit(0); }
const report = JSON.parse(readFileSync(file, 'utf8'));

const readRecheck = () => { try { return JSON.parse(readFileSync(resolve(ROOT, 'logs/recheck-status.json'), 'utf8')); } catch { return null; } };
let why = mailBlockReason({ report, file, kstDate: today, recheck: readRecheck() });
// 재검이 아직 안 끝났으면 기다린다(다른 사유면 기다려도 소용없다)
const WAIT_MS = argv.includes('--no-wait') ? 0 : 40 * 60_000;
for (const t0 = Date.now(); why && /재검/.test(why) && Date.now() - t0 < WAIT_MS;) {
  await new Promise((r) => setTimeout(r, 30_000));
  why = mailBlockReason({ report, file, kstDate: today, recheck: readRecheck() });
}
if (why) { log(`보내지 않는다 — ${why}`); process.exit(0); }

const subs = await listSubs();
const sent = await sentSet(today);
const to = recipientsFor(subs, sent);
log(`받을 사람 ${to.length}명 (동의 ${subs.filter((s) => s.status === 'active').length} · 오늘 이미 ${sent.size})`);
const links = (token) => ({
  reportUrl: `${SITE}/ko/report?utm_source=email&utm_medium=morning-mail`,   // 2026-10-02 출처 꼬리표
  unsubUrl: `${SITE}/ko/mail?a=unsubscribe&t=${encodeURIComponent(token)}`,
  oneClickUrl: `${SITE}/api/mail/unsubscribe?t=${encodeURIComponent(token)}`,
});
if (DRY) {
  const m = buildMorningMail(report, links('PREVIEW'));
  writeFileSync(resolve(ROOT, 'logs/morning-mail-preview.html'), m.html);
  log(`--dry — 보내지 않았다. 제목 "${m.subject}" · 미리보기 logs/morning-mail-preview.html`);
  process.exit(0);
}
let ok = 0, bad = 0;
for (const s of to) {
  const m = buildMorningMail(report, links(s.token));
  const r = await sendMail({ to: s.email, subject: m.subject, html: m.html, text: m.text, headers: m.headers });
  if (r.ok) { ok++; await markSent(today, s.email); }
  else { bad++; log(`실패 ${s.email.replace(/^(.).*(@.*)$/, '$1***$2')}: ${r.reason}`); if (/RESEND_API_KEY|MAIL_FROM/.test(r.reason)) break; }
}
log(`끝 — 보냄 ${ok} · 실패 ${bad}`);
