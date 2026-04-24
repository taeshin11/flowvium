import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;

    if (webhookUrl) {
      const t0 = Date.now();
      logger.info('collect', 'upload_start', { endpoint: webhookUrl });
      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000),
          body: JSON.stringify({
            ...data,
            timestamp: new Date().toISOString(),
          }),
        });
        logger.info('collect', 'upload_ok', { status: res.status, durationMs: Date.now() - t0 });
      } catch (e) {
        logger.error('collect', 'upload_failed', { error: e });
        // Silently fail webhook — we always return 200
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}
