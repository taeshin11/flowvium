/**
 * /api/judge-chat — 매수·매도 심판엔진 채팅 (2026-06-18 신설)
 *
 * LLM(vLLM 우선, callAI cascade) + RAG(judgment-doctrine/investor-wisdom + buy/sell 룰)
 * + 실시간 금융 API(종목별 수집) + 최신 리포트(내부 /api/investment-strategy) 를 종합해
 * 사용자와 매수/매도 판단을 상의한다. 비스트리밍(callAI 가 full text 반환).
 */
import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai-providers';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import {
  detectTickers, gatherTickerContext, buildSystemPrompt, tickerName,
  MODE_OPTS, type JudgeMode, type TickerCtx,
} from '@/lib/judge-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ChatMsg { role: 'user' | 'assistant'; content: string }

// 간단 레이트리밋 — 무료 로컬 LLM 남용 방지(IP 시간당 N). Redis 없으면 skip(non-fatal).
async function rateLimited(redis: ReturnType<typeof createRedis>, ip: string): Promise<boolean> {
  if (!redis) return false;
  try {
    const key = `flowvium:judge-chat:rl:${ip}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 3600);
    return n > 40; // 시간당 40 메시지
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
    // 감지된 종목이 포트폴리오/매도추천에 있는지
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

function transcript(messages: ChatMsg[]): string {
  // 최근 8턴만 — 토큰 절약
  const recent = messages.slice(-8);
  return recent.map(m => `${m.role === 'user' ? '사용자' : '심판엔진'}: ${m.content}`).join('\n');
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { messages?: ChatMsg[]; mode?: JudgeMode; locale?: string };
    const messages = Array.isArray(body.messages) ? body.messages.filter(m => m && typeof m.content === 'string' && m.content.trim()) : [];
    const mode: JudgeMode = (['fast', 'standard', 'deep'].includes(body.mode as string) ? body.mode : 'standard') as JudgeMode;
    const locale = body.locale ?? 'ko';
    if (!messages.length) return NextResponse.json({ error: 'no messages' }, { status: 400 });

    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    if (!lastUser.trim()) return NextResponse.json({ error: 'no user message' }, { status: 400 });
    if (lastUser.length > 2000) return NextResponse.json({ error: 'message too long' }, { status: 413 });

    const redis = createRedis();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'anon';
    if (await rateLimited(redis, ip)) {
      return NextResponse.json({ error: 'rate_limited', reply: '잠시 후 다시 시도해 주세요 (시간당 한도 도달).' }, { status: 429 });
    }

    // 내부 API 호출은 localhost 직결 — 공개 URL(cloudflare 터널) 루프백은 느리거나 막힘.
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
      systemPrompt,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      preferSmallModel: opts.preferSmallModel,
      tag: 'judge-chat',
      timeoutMs: 45000,
    });

    if (!text) {
      const reason = attempts?.find(a => a.error)?.error;
      logger.warn('judge-chat', 'all_providers_failed', { reason });
      return NextResponse.json({ error: 'llm_unavailable', reply: '지금 심판엔진이 응답할 수 없습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 });
    }

    logger.info('judge-chat', 'ok', { source, mode, tickers: tickers.join(','), len: text.length });

    const grounding = {
      tickers: tickerCtx.map(c => ({ ticker: c.ticker, name: c.name, price: c.price ?? null, rsi: c.rsi ?? null })),
      usedRules: mode !== 'fast',
      usedReport: !!reportContext,
    };

    // 전체 대화 저장 (사용자 "전체 대화 저장 — 검토·학습용", 2026-06-18). 질문+답변+전체히스토리+
    //   감지종목+모드+소스+grounding 을 conv 키(180일)에 저장 + index 리스트(최근 5000 capped)로 열람.
    //   검토: node scripts/judge-chat-log.mjs [N]. 신원(IP)은 미저장 — 대화내용 중심.
    if (redis) {
      try {
        const ts = new Date().toISOString();
        const convKey = `flowvium:judge-chat:conv:${Date.now()}`;
        const fullConv = { ts, mode, source, durationMs, tickers, grounding,
          messages: [...messages, { role: 'assistant', content: text }] };
        await loggedRedisSet(redis, 'judge-chat', convKey, fullConv, { ex: 180 * 86400 });
        await redis.lpush('flowvium:judge-chat:index', JSON.stringify({ ts, key: convKey, q: lastUser.slice(0, 120), tickers, source }));
        await redis.ltrim('flowvium:judge-chat:index', 0, 4999);
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({ reply: text, source, mode, durationMs, grounding });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logger.error('judge-chat', 'failed', { error: msg });
    return NextResponse.json({ error: 'internal', reply: '오류가 발생했습니다. 다시 시도해 주세요.' }, { status: 500 });
  }
}
