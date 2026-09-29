/**
 * POST /api/mail/unsubscribe — 아침보고서 메일 수신거부. (2026-09-30)
 *   ① 페이지 버튼: body {t}  ② 메일 앱의 원클릭(RFC 8058): ?t=… 로 POST, 본문 "List-Unsubscribe=One-Click".
 *   GET 으로는 바꾸지 않는다 — 링크를 미리 열어 보는 검사기가 수신거부를 누르게 된다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { setStatusByToken } from '@/lib/mail-subs';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let t = req.nextUrl.searchParams.get('t') ?? '';
  if (!t) { try { t = String(((await req.json()) as { t?: string }).t ?? ''); } catch { /* 원클릭은 form 본문 */ } }
  const email = await setStatusByToken(t, 'unsubscribed', 'unsubscribe');
  if (!email) return NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 400 });
  logger.info('api.mail', 'unsubscribed', { domain: email.split('@')[1] });
  return NextResponse.json({ ok: true });
}
