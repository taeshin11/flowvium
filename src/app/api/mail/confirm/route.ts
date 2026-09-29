/**
 * POST /api/mail/confirm {t} — 아침보고서 메일 수신 동의(기존 가입자에게 보낸 동의 요청의 버튼). (2026-09-30)
 *   메일 링크는 /{locale}/mail?a=confirm&t=… 페이지로 간다. 동의는 그 페이지의 버튼(POST)으로만 —
 *   메일 보안 검사기가 링크를 미리 열어 보는 것만으로 동의가 되면 안 된다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { setStatusByToken } from '@/lib/mail-subs';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { t } = await req.json() as { t?: string };
    const email = await setStatusByToken(String(t ?? ''), 'active', 'invite');
    if (!email) return NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 400 });
    logger.info('api.mail', 'confirmed', { domain: email.split('@')[1] });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }
}
