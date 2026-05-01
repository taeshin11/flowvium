import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import {
  getAccountSummary,
  getTradeHistory,
  getSnapshots,
  checkStopLossAndTarget,
  resetAccount,
} from '@/lib/paper-trading';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? '';

  const redis = createRedis();
  if (!redis) {
    return NextResponse.json({ error: 'Redis unavailable' }, { status: 503 });
  }

  try {
    if (action === 'account') {
      const data = await getAccountSummary(redis);
      return NextResponse.json(data);
    }

    if (action === 'trades') {
      const limit = parseInt(searchParams.get('limit') ?? '50', 10);
      const data = await getTradeHistory(redis, isNaN(limit) ? 50 : limit);
      return NextResponse.json(data);
    }

    if (action === 'snapshots') {
      const days = parseInt(searchParams.get('days') ?? '30', 10);
      const data = await getSnapshots(redis, isNaN(days) ? 30 : days);
      return NextResponse.json(data);
    }

    if (action === 'check-stops') {
      const data = await checkStopLossAndTarget(redis);
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'Unknown action. Use: account | trades | snapshots | check-stops' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? '';

  if (action !== 'reset') {
    return NextResponse.json({ error: 'Unknown action. Use: reset' }, { status: 400 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const expectedToken = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (!process.env.CRON_SECRET || authHeader !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redis = createRedis();
  if (!redis) {
    return NextResponse.json({ error: 'Redis unavailable' }, { status: 503 });
  }

  try {
    await resetAccount(redis);
    return NextResponse.json({ ok: true, message: '가상계좌가 초기화되었습니다.' });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
