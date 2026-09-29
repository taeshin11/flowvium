/**
 * mailer.mjs — Resend 로 메일 한 통. (2026-09-30, 사장님 선택: Resend)
 *   RESEND_API_KEY·MAIL_FROM 은 .env.local 에만(사장님이 가입·도메인 인증 후 넣는다). 없으면 부르지 않는다.
 *   API: POST https://api.resend.com/emails {from,to[],subject,html,text,headers} → {id}
 */
import { loadEnvLocal } from './llm-config.mjs';

export async function sendMail({ to, subject, html, text, headers = {} }, { env = loadEnvLocal(), fetchImpl = fetch } = {}) {
  const key = env.RESEND_API_KEY ?? process.env.RESEND_API_KEY;
  const from = env.MAIL_FROM ?? process.env.MAIL_FROM;
  if (!key) return { ok: false, reason: 'RESEND_API_KEY 없음(.env.local)' };
  if (!from) return { ok: false, reason: 'MAIL_FROM 없음(.env.local) — 예: FlowVium <report@flowvium.net>' };
  try {
    const r = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text, headers }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, reason: `Resend ${r.status}: ${j?.message ?? j?.name ?? '오류'}` };
    return { ok: true, id: j?.id ?? null };
  } catch (e) { return { ok: false, reason: `Resend 호출 실패: ${String(e?.message ?? e).slice(0, 80)}` }; }
}
