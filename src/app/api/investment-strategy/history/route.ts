import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { InvestmentStrategy } from '@/app/api/investment-strategy/route';

export const dynamic = 'force-dynamic';

const HISTORY_KEY = 'flowvium:investment-strategy:history:arr:v1'; // JSON array stored via loggedRedisSet
const SESSION_KO: Record<string, string> = {
  morning: '오전 (미국장 마감 후)',
  afternoon: '오후 (아시아장 마감 후)',
  evening: '저녁 (미국장 개장 전)',
};

export interface HistoryMeta {
  key: string;
  generatedAt: string;
  session: string;
  kstDate: string;
  stance: 'bullish' | 'neutral' | 'bearish';
  thesis: string;
  riskLevel: 'low' | 'medium' | 'high';
  source?: string;
  sessionLabel?: string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const loadKey = searchParams.get('key');
  const redis = createRedis();
  if (!redis) return NextResponse.json({ items: [], report: null });

  if (loadKey) {
    // Load full report by key
    try {
      const report = await redis.get<InvestmentStrategy>(loadKey);
      return NextResponse.json({ report: report ?? null });
    } catch {
      return NextResponse.json({ report: null });
    }
  }

  // Return history (stored as array via loggedRedisSet — Upstash auto-deserializes)
  try {
    const raw = await redis.get(HISTORY_KEY);
    // E1 FIX: Upstash may return JSON string or auto-deserialized array
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const arr: HistoryMeta[] = Array.isArray(parsed) ? parsed : [];
    const items: HistoryMeta[] = arr.flatMap(m => {
      if (!m?.key || !m?.generatedAt) return [];
      m.sessionLabel = SESSION_KO[m.session] ?? m.session;
      return [m];
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
