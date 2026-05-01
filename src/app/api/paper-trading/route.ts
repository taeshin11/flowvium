import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import {
  getAccountSummary,
  getTradeHistory,
  getSnapshots,
  checkStopLossAndTarget,
  resetAccount,
  executeReportTrades,
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

  const authHeader = req.headers.get('authorization') ?? '';
  const expectedToken = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  const authed = !process.env.CRON_SECRET || authHeader === expectedToken;

  // execute: 리포트 포트폴리오로 가상 매매 실행 (로컬 스크립트 + cron에서 호출)
  if (action === 'execute') {
    const redis = createRedis();
    if (!redis) return NextResponse.json({ error: 'Redis unavailable' }, { status: 503 });
    const body = await req.json().catch(() => ({})) as { portfolio?: unknown[]; reportDate?: string };
    const portfolio = body.portfolio ?? [];
    const reportDate = body.reportDate ?? new Date().toISOString().slice(0, 10);
    if (!Array.isArray(portfolio) || portfolio.length === 0)
      return NextResponse.json({ error: 'portfolio required' }, { status: 400 });
    const result = await executeReportTrades(redis, portfolio as Parameters<typeof executeReportTrades>[1], reportDate);
    return NextResponse.json(result);
  }

  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (action !== 'reset') {
    return NextResponse.json({ error: 'Unknown action. Use: execute | reset' }, { status: 400 });
  }

  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized for reset' }, { status: 401 });
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
