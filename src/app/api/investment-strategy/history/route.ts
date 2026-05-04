import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { InvestmentStrategy } from '@/app/api/investment-strategy/route';
import { memGetReport, memGetArray } from '@/lib/investment-strategy-memory';

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
    try {
      const report = await redis.get<InvestmentStrategy>(loadKey);
      if (report) return NextResponse.json({ report });
      // Redis miss — check in-process memory cache (covers Upstash daily limit exhaustion)
      const memReport = memGetReport(loadKey);
      if (memReport) return NextResponse.json({ report: memReport, fromMemory: true });
      // 전용 히스토리 키가 만료됐거나 session 키가 삭제된 경우
      return NextResponse.json({ report: null, expired: true });
    } catch {
      const memReport = memGetReport(loadKey);
      if (memReport) return NextResponse.json({ report: memReport, fromMemory: true });
      return NextResponse.json({ report: null, expired: true });
    }
  }

  // Return history (stored as array via loggedRedisSet — Upstash auto-deserializes)
  try {
    const raw = await redis.get(HISTORY_KEY);
    // E1 FIX: Upstash may return JSON string or auto-deserialized array
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const redisArr: HistoryMeta[] = Array.isArray(parsed) ? parsed : [];
    // Merge with in-memory items not yet flushed to Redis (covers limit-exhaustion gaps)
    const memArr = memGetArray() ?? [];
    const redisKeys = new Set(redisArr.map(e => e.key));
    const merged = [...redisArr, ...memArr.filter(e => !redisKeys.has(e.key))].slice(0, 30);
    const items: HistoryMeta[] = merged.flatMap(m => {
      if (!m?.key || !m?.generatedAt) return [];
      m.sessionLabel = SESSION_KO[m.session] ?? m.session;
      return [m];
    });
    return NextResponse.json({ items });
  } catch {
    // Full Redis failure — serve from memory
    const memArr = memGetArray();
    if (memArr?.length) {
      const items = memArr.flatMap(m => {
        if (!m?.key || !m?.generatedAt) return [];
        m.sessionLabel = SESSION_KO[m.session] ?? m.session;
        return [m];
      });
      return NextResponse.json({ items, fromMemory: true });
    }
    return NextResponse.json({ items: [] });
  }
}
