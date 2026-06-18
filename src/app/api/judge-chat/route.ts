/**
 * /api/judge-chat — 매수·매도 심판엔진 채팅 (2026-06-18)
 *
 * LLM(vLLM 우선, callAI cascade) + RAG(doctrine/wisdom + buy/sell 룰) + 실시간 금융 API(종목별)
 * + 최신 리포트 종합. 비스트리밍.
 *
 * per-user 대화 히스토리(2026-06-18, 사용자 "접속 아이디별 + Gemini식 히스토리"):
 *   소유자 uid = 로그인 이메일(fv_member) 또는 익명 쿠키(fv_chat_uid). Redis 에 대화별 저장 +
 *   최근순 ZSET 인덱스. GET ?action=list / ?action=get&id= / POST(생성·추가) / DELETE ?id=.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { callAI } from '@/lib/ai-providers';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { getChatUid } from '@/lib/member-auth';
import {
  detectTickers, gatherTickerContext, buildSystemPrompt, tickerName,
  MODE_OPTS, type JudgeMode, type TickerCtx,
} from '@/lib/judge-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ChatMsg { role: 'user' | 'assistant'; content: string }
const CONV_TTL = 180 * 86400;
const uKey = (uid: string) => `flowvium:judge-chat:u:${uid}:convs`;          // ZSET updatedAt→convId
const cKey = (uid: string, id: string) => `flowvium:judge-chat:u:${uid}:c:${id}`;
const ANON_COOKIE = 'fv_chat_uid';

// uid 확정 — 비로그인+쿠키없음이면 익명ID 발급(응답에 쿠키 set 필요 시 newAnon 반환)
function resolveUid(req: NextRequest): { uid: string; isMember: boolean; newAnon: string | null } {
  const r = getChatUid(req);
  if (r.uid) return { uid: r.uid, isMember: r.isMember, newAnon: null };
  const anon = randomUUID();
  return { uid: `a:${anon}`, isMember: false, newAnon: anon };
}
function withAnonCookie(res: NextResponse, newAnon: string | null): NextResponse {
  if (newAnon) res.cookies.set(ANON_COOKIE, newAnon, { httpOnly: true, sameSite: 'lax', maxAge: 365 * 86400, path: '/' });
  return res;
}
const titleOf = (messages: ChatMsg[]) => (messages.find(m => m.role === 'user')?.content ?? '새 대화').slice(0, 60);

async function rateLimited(redis: ReturnType<typeof createRedis>, ip: string): Promise<boolean> {
  if (!redis) return false;
  try {
    const key = `flowvium:judge-chat:rl:${ip}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 3600);
    return n > 60;
  } catch { return false; }
}

async function fetchReportContext(origin: string, locale: string, tickers: string[]): Promise<string> {
  try {
    const r = await fetch(`${origin}/api/investment-strategy?locale=${encodeURIComponent(locale)}`, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!r.ok) return '';
    const rep = await r.json() as Record<string, unknown>;
    const stance = rep.stance ?? rep.riskLevel;
    const thesis = rep.thesis ?? rep.marketThesis;
    const lines: string[] = [];
    if (stance) lines.push(`현재 스탠스: ${stance}`);
    if (thesis) lines.push(`핵심 논지: ${String(thesis).slice(0, 220)}`);
    const port = (rep.portfolio as Array<Record<string, unknown>>) ?? [];
    const sells = [
      ...((rep.sellRecommendations as { us?: unknown[]; kr?: unknown[] })?.us ?? []),
      ...((rep.sellRecommendations as { us?: unknown[]; kr?: unknown[] })?.kr ?? []),
    ] as Array<Record<string, unknown>>;
    for (const t of tickers) {
      const inPort = port.find(p => p.ticker === t);
      if (inPort) lines.push(`· ${t} = 오늘 리포트 추천: action=${inPort.action}, 비중 ${inPort.allocation}%, 진입 ${inPort.entryZone ?? '?'}, 손절 ${inPort.stopLoss ?? '?'}, 목표 ${inPort.target ?? '?'}`);
      const inSell = sells.find(s => s.ticker === t);
      if (inSell) lines.push(`· ${t} = 오늘 매도추천: ${inSell.sellType ?? inSell.reason ?? ''} (urgency ${inSell.urgency ?? '?'})`);
    }
    return lines.join('\n');
  } catch { return ''; }
}

const transcript = (messages: ChatMsg[]) => messages.slice(-8).map(m => `${m.role === 'user' ? '사용자' : '심판엔진'}: ${m.content}`).join('\n');

// ── GET: 대화 목록 / 단일 조회 ────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { uid, isMember, newAnon } = resolveUid(req);
  const action = req.nextUrl.searchParams.get('action') ?? 'list';
  const redis = createRedis();
  if (!redis) return withAnonCookie(NextResponse.json({ conversations: [], isMember }), newAnon);
  try {
    if (action === 'get') {
      const id = req.nextUrl.searchParams.get('id') ?? '';
      const conv = id ? await redis.get(cKey(uid, id)) : null;
      return withAnonCookie(NextResponse.json({ conversation: conv ?? null, isMember }), newAnon);
    }
    // list (최근 50)
    const ids = newAnon ? [] : ((await redis.zrange(uKey(uid), 0, 49, { rev: true })) as string[]);
    const convs = ids.length ? await Promise.all(ids.map(async id => {
      const c = await redis.get(cKey(uid, id)) as { id?: string; title?: string; updatedAt?: number } | null;
      return c ? { id: c.id ?? id, title: c.title ?? '대화', updatedAt: c.updatedAt ?? 0 } : null;
    })) : [];
    return withAnonCookie(NextResponse.json({ conversations: convs.filter(Boolean), isMember }), newAnon);
  } catch {
    return withAnonCookie(NextResponse.json({ conversations: [], isMember }), newAnon);
  }
}

// ── DELETE: 대화 삭제 ─────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const { uid } = resolveUid(req);
  const id = req.nextUrl.searchParams.get('id') ?? '';
  const redis = createRedis();
  if (!redis || !id) return NextResponse.json({ ok: false }, { status: 400 });
  try { await redis.del(cKey(uid, id)); await redis.zrem(uKey(uid), id); } catch { /* non-fatal */ }
  return NextResponse.json({ ok: true });
}

// ── POST: 메시지 전송(대화 생성/추가) ────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { messages?: ChatMsg[]; mode?: JudgeMode; locale?: string; convId?: string };
    const messages = Array.isArray(body.messages) ? body.messages.filter(m => m && typeof m.content === 'string' && m.content.trim()) : [];
    const mode: JudgeMode = (['fast', 'standard', 'deep'].includes(body.mode as string) ? body.mode : 'standard') as JudgeMode;
    const locale = body.locale ?? 'ko';
    if (!messages.length) return NextResponse.json({ error: 'no messages' }, { status: 400 });

    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    if (!lastUser.trim()) return NextResponse.json({ error: 'no user message' }, { status: 400 });
    if (lastUser.length > 2000) return NextResponse.json({ error: 'message too long' }, { status: 413 });

    const { uid, newAnon } = resolveUid(request);
    const redis = createRedis();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'anon';
    if (await rateLimited(redis, ip)) {
      return withAnonCookie(NextResponse.json({ error: 'rate_limited', reply: '잠시 후 다시 시도해 주세요 (시간당 한도 도달).' }, { status: 429 }), newAnon);
    }

    const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
    const opts = MODE_OPTS[mode];
    const tickers = detectTickers(lastUser, opts.maxTickers);
    const [tickerCtx, reportContext] = await Promise.all([
      Promise.all(tickers.map(t => gatherTickerContext(t, origin).catch((): TickerCtx => ({ ticker: t, name: tickerName(t) })))),
      fetchReportContext(origin, locale, tickers),
    ]);

    const systemPrompt = buildSystemPrompt({ locale, mode, tickerCtx, reportContext });
    const userPrompt = `다음은 사용자와의 대화다. 마지막 사용자 질문에 심판엔진으로서 답하라.\n\n${transcript(messages)}\n\n심판엔진:`;
    const { text, source, durationMs, attempts } = await callAI(userPrompt, {
      systemPrompt, maxTokens: opts.maxTokens, temperature: opts.temperature,
      preferSmallModel: opts.preferSmallModel, tag: 'judge-chat', timeoutMs: 45000,
    });
    if (!text) {
      const reason = attempts?.find(a => a.error)?.error;
      logger.warn('judge-chat', 'all_providers_failed', { reason });
      return withAnonCookie(NextResponse.json({ error: 'llm_unavailable', reply: '지금 심판엔진이 응답할 수 없습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 }), newAnon);
    }
    logger.info('judge-chat', 'ok', { source, mode, tickers: tickers.join(','), len: text.length });

    const grounding = {
      tickers: tickerCtx.map(c => ({ ticker: c.ticker, name: c.name, price: c.price ?? null, rsi: c.rsi ?? null })),
      usedRules: mode !== 'fast', usedReport: !!reportContext,
    };
    const fullMessages = [...messages, { role: 'assistant' as const, content: text }];
    const convId = body.convId || `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    // per-user 영속 + 최근순 인덱스 + (학습/관리 검토용) 전역 인덱스
    if (redis) {
      try {
        const conv = { id: convId, uid, title: titleOf(fullMessages), createdAt: body.convId ? undefined : now, updatedAt: now, mode, source, messages: fullMessages };
        await loggedRedisSet(redis, 'judge-chat', cKey(uid, convId), conv, { ex: CONV_TTL });
        await redis.zadd(uKey(uid), { score: now, member: convId });
        await redis.expire(uKey(uid), CONV_TTL);
        await redis.lpush('flowvium:judge-chat:index', JSON.stringify({ ts: new Date(now).toISOString(), key: cKey(uid, convId), q: lastUser.slice(0, 120), tickers, source, uid }));
        await redis.ltrim('flowvium:judge-chat:index', 0, 4999);
      } catch { /* non-fatal */ }
    }

    return withAnonCookie(NextResponse.json({ reply: text, source, mode, durationMs, grounding, convId, title: titleOf(fullMessages) }), newAnon);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logger.error('judge-chat', 'failed', { error: msg });
    return NextResponse.json({ error: 'internal', reply: '오류가 발생했습니다. 다시 시도해 주세요.' }, { status: 500 });
  }
}
