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
  detectTickers, gatherTickerContext, buildSystemPrompt, buildResearchPrompt, tickerName,
  MODE_OPTS, type JudgeMode, type TickerCtx,
} from '@/lib/judge-engine';
import { ragRetrieve, type RagHit } from '@/lib/rag';

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

// 거시 grounding — CNN F&G · VIX · CME FedWatch · FRED(CPI) · 국채금리곡선. 10분 모듈캐시(거시는 완만).
let _macroCache: { ts: number; text: string; vix: number | null; fg: number | null } | null = null;
async function fetchMacroContext(origin: string): Promise<{ text: string; vix: number | null; fg: number | null }> {
  if (_macroCache && Date.now() - _macroCache.ts < 600_000) return _macroCache;
  const g = async (p: string) => { try { const r = await fetch(`${origin}${p}`, { signal: AbortSignal.timeout(5000), cache: 'no-store' }); return r.ok ? await r.json() as Record<string, unknown> : null; } catch { return null; } };
  const [fg, vol, fw, macro, yc] = await Promise.all([g('/api/fear-greed'), g('/api/volatility'), g('/api/fedwatch'), g('/api/macro-indicators'), g('/api/yield-curve')]);
  const L: string[] = [];
  const us = (fg?.byCountry as Array<Record<string, unknown>>)?.find(c => c.id === 'us');
  if (us) L.push(`공포·탐욕(F&G) US ${us.score} (${us.level}${us.prevScore != null ? `, 전일 ${us.prevScore}` : ''})`);
  if (vol?.vix != null) L.push(`VIX ${vol.vix}${vol.regimeLabel ? ` (${vol.regimeLabel})` : ''}`);
  if (fw?.currentTargetLow != null) { const m = (fw.meetings as Array<Record<string, unknown>>)?.[0]; L.push(`연준 기준금리 ${fw.currentTargetLow}~${fw.currentTargetHigh}%${m ? ` · 다음(${m.label}) 동결 ${m.probHold}%/인하 ${(m.probCut25 as number ?? 0) + (m.probCut50 as number ?? 0)}%` : ''}`); }
  const cpi = (macro?.indicators as Array<Record<string, unknown>>)?.find(i => i.id === 'cpi');
  if (cpi) L.push(`CPI ${cpi.actual}% (예상 ${cpi.forecast}%, ${cpi.rateImpact})`);
  const t = yc?.today as Array<Record<string, unknown>>;
  if (t) { const y2 = t.find(p => p.label === '2Y')?.value as number; const y10 = t.find(p => p.label === '10Y')?.value as number; if (y2 != null && y10 != null) L.push(`국채 2Y ${y2}% / 10Y ${y10}% (장단기차 ${(y10 - y2).toFixed(2)}%p)`); }
  const text = L.join(' · ');
  const vixVal = vol?.vix != null ? Number(vol.vix) : null;
  const fgVal = us?.score != null ? Number(us.score) : null;
  _macroCache = { ts: Date.now(), text, vix: vixVal, fg: fgVal };
  return _macroCache;
}

// vLLM OpenAI SSE 스트리밍 — 토큰 단위 delta 를 onDelta 로 흘리고 전체 텍스트 반환 (2026-06-18, 사용자 "스트리밍 부드럽게").
async function streamVllm(system: string, user: string, opts: { maxTokens: number; temperature: number }, onDelta: (s: string) => void): Promise<string> {
  const base = (process.env.VLLM_URL || 'http://localhost:8000').replace(/\/v1\/?$/, '');
  const model = process.env.OLLAMA_TRANSLATE_MODEL || 'flowvium-local';
  const r = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: opts.maxTokens, temperature: opts.temperature, stream: true }),
    signal: AbortSignal.timeout(55000),
  });
  if (!r.ok || !r.body) throw new Error(`vllm stream ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const ln of lines) {
      const t = ln.trim();
      if (!t.startsWith('data:')) continue;
      const d = t.slice(5).trim();
      if (d === '[DONE]') continue;
      try { const j = JSON.parse(d); const delta = j?.choices?.[0]?.delta?.content; if (delta) { full += delta; onDelta(delta); } } catch { /* partial */ }
    }
  }
  return full;
}

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
    const body = await request.json() as { messages?: ChatMsg[]; mode?: JudgeMode; locale?: string; convId?: string; stream?: boolean };
    const messages = Array.isArray(body.messages) ? body.messages.filter(m => m && typeof m.content === 'string' && m.content.trim()) : [];
    const mode: JudgeMode = (['aits', 'aits-rag', 'aits-deep'].includes(body.mode as string) ? body.mode : 'aits-rag') as JudgeMode;
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
    const [tickerCtx, reportContext, ragHits, macroContext] = await Promise.all([
      Promise.all(tickers.map(t => gatherTickerContext(t, origin).catch((): TickerCtx => ({ ticker: t, name: tickerName(t) })))),
      fetchReportContext(origin, locale, tickers),
      opts.useRag ? ragRetrieve(lastUser, 4).catch((): RagHit[] => []) : Promise.resolve([] as RagHit[]),
      fetchMacroContext(origin).catch(() => ({ text: '', vix: null, fg: null })),
    ]);

    // TAISN 심층(2-pass): ① 사업·업황·전망 리서치 브리프 생성(사실 정리) → ② 그 위에 판단.
    let researchBrief = '';
    if (opts.deep && tickerCtx.some(c => c.price != null)) {
      try {
        const rp = buildResearchPrompt({ locale, tickerCtx, macroContext: macroContext.text });
        const rr = await callAI('위 데이터로 사업·업황·전망 리서치 브리프를 작성하라.', { systemPrompt: rp, maxTokens: 900, temperature: 0.4, tag: 'judge-research', timeoutMs: 40000 });
        researchBrief = rr.text || '';
      } catch { /* 리서치 실패 시 브리프 없이 진행 */ }
    }

    const systemPrompt = buildSystemPrompt({ locale, mode, tickerCtx, reportContext, ragHits, macroContext: macroContext.text, macro: { vix: macroContext.vix, fg: macroContext.fg }, researchBrief });
    const userPrompt = `다음은 사용자와의 대화다. 마지막 사용자 질문에 심판엔진으로서 답하라.\n\n${transcript(messages)}\n\n심판엔진:`;

    const grounding = {
      tickers: tickerCtx.map(c => ({ ticker: c.ticker, name: c.name, price: c.price ?? null, rsi: c.rsi ?? null })),
      usedRules: true, usedReport: !!reportContext, usedMacro: !!macroContext,
      usedRag: ragHits.length > 0,
      ragSources: ragHits.map(h => ({ source: h.source, year: h.year ?? null, score: Number(h.score.toFixed(2)) })),
    };
    const convId = body.convId || `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

    // 대화 영속(완성된 답변 text 로) — 스트림/논스트림 공용
    const persist = async (text: string, source: string) => {
      if (!redis || !text) return;
      const now = Date.now();
      const fullMessages = [...messages, { role: 'assistant' as const, content: text }];
      try {
        const conv = { id: convId, uid, title: titleOf(fullMessages), createdAt: body.convId ? undefined : now, updatedAt: now, mode, source, messages: fullMessages };
        await loggedRedisSet(redis, 'judge-chat', cKey(uid, convId), conv, { ex: CONV_TTL });
        await redis.zadd(uKey(uid), { score: now, member: convId });
        await redis.expire(uKey(uid), CONV_TTL);
        await redis.lpush('flowvium:judge-chat:index', JSON.stringify({ ts: new Date(now).toISOString(), key: cKey(uid, convId), q: lastUser.slice(0, 120), tickers, source, uid }));
        await redis.ltrim('flowvium:judge-chat:index', 0, 4999);
      } catch { /* non-fatal */ }
    };

    // ── 스트리밍 경로 (SSE) — meta 먼저, 그 다음 토큰 delta, 마지막 done ──────────
    if (body.stream) {
      const encoder = new TextEncoder();
      const sse = new ReadableStream({
        async start(controller) {
          const send = (o: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
          send({ type: 'meta', convId, grounding, mode, title: titleOf([...messages]) });
          let full = '', source = 'vllm-local';
          try {
            full = await streamVllm(systemPrompt, userPrompt, opts, (d) => send({ type: 'delta', text: d }));
            if (!full.trim()) throw new Error('empty stream');
          } catch (e) {
            logger.warn('judge-chat', 'stream_fallback', { error: e instanceof Error ? e.message : 'x' });
            const res = await callAI(userPrompt, { systemPrompt, maxTokens: opts.maxTokens, temperature: opts.temperature, preferSmallModel: opts.preferSmallModel, tag: 'judge-chat', timeoutMs: 45000 });
            full = res.text || '지금 심판엔진이 응답할 수 없습니다. 잠시 후 다시 시도해 주세요.';
            source = res.source || 'fallback';
            send({ type: 'delta', text: full });
          }
          await persist(full, source);
          logger.info('judge-chat', 'ok', { source, mode, tickers: tickers.join(','), len: full.length, stream: true });
          send({ type: 'done', source });
          controller.close();
        },
      });
      const res = new NextResponse(sse, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
      return withAnonCookie(res, newAnon);
    }

    // ── 논스트림 경로 (기존) ──────────────────────────────────────────────────────
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
    await persist(text, source);
    return withAnonCookie(NextResponse.json({ reply: text, source, mode, durationMs, grounding, convId, title: titleOf([...messages, { role: 'assistant', content: text }]) }), newAnon);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logger.error('judge-chat', 'failed', { error: msg });
    return NextResponse.json({ error: 'internal', reply: '오류가 발생했습니다. 다시 시도해 주세요.' }, { status: 500 });
  }
}
