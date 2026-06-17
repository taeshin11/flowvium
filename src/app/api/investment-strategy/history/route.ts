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

// 2026-06-17 (전수조사 #2): serve-time fallback 차단 — in-memory 캐시(memGetReport/memGetArray)는
//   purge-fallback 의 Redis SCAN 이 닿지 못하는 사각지대(라우트 가드 회귀 시 사용자 노출 위험). serve
//   시점에 fallback-source 보고서/항목을 거른다(이중 방어). 모듈 스코프로 hoist 해 단일조회+목록 공용.
const isFallbackSrc = (s?: string) => !!s && (s === 'fallback' || s === 'data' || s.startsWith('fallback'));

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
    // serve-time 차단: 로드한 보고서 source 가 fallback 이면 노출하지 않음 (expired 처럼 처리)
    const serve = (report: InvestmentStrategy | null, extra: Record<string, unknown> = {}) => {
      if (!report) return null;
      if (isFallbackSrc((report as { source?: string }).source)) return NextResponse.json({ report: null, expired: true, filtered: 'fallback-source' });
      return NextResponse.json({ report, ...extra });
    };
    try {
      const r1 = serve(await redis.get<InvestmentStrategy>(loadKey));
      if (r1) return r1;
      // Redis miss — check in-process memory cache (covers Upstash daily limit exhaustion)
      const r2 = serve(memGetReport(loadKey), { fromMemory: true });
      if (r2) return r2;
      // 전용 히스토리 키가 만료됐거나 session 키가 삭제된 경우
      return NextResponse.json({ report: null, expired: true });
    } catch {
      const r2 = serve(memGetReport(loadKey), { fromMemory: true });
      if (r2) return r2;
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
    // 전수조사 #2: fallback-source 항목은 목록에서 제외 (Redis 는 purge 가 지우지만 in-memory 는 못 지움)
    const merged = [...redisArr, ...memArr.filter(e => !redisKeys.has(e.key))]
      .filter(e => !isFallbackSrc(e.source))
      .slice(0, 30);
    const items: HistoryMeta[] = merged.flatMap(m => {
      if (!m?.key || !m?.generatedAt) return [];
      m.sessionLabel = SESSION_KO[m.session] ?? m.session;
      return [m];
    });
    // dedup: 같은 (kstDate-day, session) 의 보고서가 여러 개면 더 최신 (generatedAt 큰) 우선
    const seen = new Map<string, HistoryMeta>();
    for (const m of items) {
      const key = `${(m.kstDate ?? '').slice(0, 10)}|${m.session}`;
      const prev = seen.get(key);
      if (!prev) { seen.set(key, m); continue; }
      // fallback 은 위에서 이미 제외됨 → 같은 (날짜, session) 이면 더 최신 (generatedAt 큰) 우선
      if (m.generatedAt > prev.generatedAt) seen.set(key, m);
    }
    const dedupped = Array.from(seen.values()).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    return NextResponse.json({ items: dedupped });
  } catch {
    // Full Redis failure — serve from memory (전수조사 #2: fallback-source 항목 제외)
    const memArr = memGetArray();
    if (memArr?.length) {
      const items = memArr.flatMap(m => {
        if (!m?.key || !m?.generatedAt || isFallbackSrc(m.source)) return [];
        m.sessionLabel = SESSION_KO[m.session] ?? m.session;
        return [m];
      });
      return NextResponse.json({ items, fromMemory: true });
    }
    return NextResponse.json({ items: [] });
  }
}
