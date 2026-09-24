import { NextResponse, type NextRequest } from 'next/server';
import { getMemberEmail } from '@/lib/member-auth';
import { gateReport } from '@/lib/report-gate';
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

function isInternalReq(req: NextRequest): boolean {
  const sec = process.env.CRON_SECRET;
  if (!sec) return false;
  const h = req.headers.get('authorization') ?? '';
  return h === `Bearer ${sec}` || req.headers.get('x-cron-secret') === sec;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const loadKey = searchParams.get('key');
  const redis = createRedis();
  if (!redis) return NextResponse.json({ items: [], report: null });

  if (loadKey) {
    // serve-time 차단: 로드한 보고서 source 가 fallback 이면 노출하지 않음 (expired 처럼 처리)
    // 2026-09-24: 여기엔 **회원 잠금이 없었다.** 9/18 에 메인 라우트만 서버에서 잠갔고 이 라우트를 놓쳐서,
    //   비회원이 과거 회차 탭을 누르면 화면은 가입 안내를 띄웠지만 데이터는 전부 내려갔다
    //   (실측: noon portfolio 5건·evening 4건이 비회원에게 그대로). 메인 라우트와 **같은 함수**로 잠근다.
    //   회원 응답은 공유 캐시에 올리지 않는다 — 올리면 비회원이 그 캐시를 받는다.
    const isMember = !!getMemberEmail(req) || isInternalReq(req);
    const serve = (report: InvestmentStrategy | null, extra: Record<string, unknown> = {}) => {
      if (!report) return null;
      if (isFallbackSrc((report as { source?: string }).source)) return NextResponse.json({ report: null, expired: true, filtered: 'fallback-source' });
      const out = gateReport(report as unknown as Record<string, unknown>, isMember);
      const res = NextResponse.json({ report: out, ...extra });
      if (isMember) res.headers.set('Cache-Control', 'private, no-store');
      return res;
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
