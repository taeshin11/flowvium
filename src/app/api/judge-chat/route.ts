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
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { callAI } from '@/lib/ai-providers';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { getChatUid } from '@/lib/member-auth';
import {
  detectTickers, gatherTickerContext, buildSystemPrompt, buildResearchPrompt, tickerName,
  MODE_OPTS, type JudgeMode, type TickerCtx,
} from '@/lib/judge-engine';
import { ragRetrieve, type RagHit } from '@/lib/rag';
import { acquireLlm, waitMessage } from '@/lib/llm-gate';

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

async function fetchReportContext(origin: string, locale: string, tickers: string[], opts?: { includeList?: boolean }): Promise<string> {
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
    // 추천/top/뭐 살까 류 질문(특정 종목 미지정) → 오늘 리포트 매수 포트폴리오 전체 목록 노출.
    if (opts?.includeList && port.length) {
      lines.push(`\n# 오늘 리포트 매수 포트폴리오 (실제 발행 추천 — 이 목록으로 답하라):`);
      for (const p of port.slice(0, 14)) {
        lines.push(`· ${p.ticker}${p.name ? ` (${p.name})` : ''}: ${p.action ?? '매수'}, 비중 ${p.allocation ?? '?'}%, 진입 ${p.entryZone ?? '?'}, 손절 ${p.stopLoss ?? '?'}, 목표 ${p.target ?? '?'}`);
      }
    }
    return lines.join('\n');
  } catch { return ''; }
}

const transcript = (messages: ChatMsg[]) => messages.slice(-8).map(m => `${m.role === 'user' ? '사용자' : '심판엔진'}: ${m.content}`).join('\n');

// 답변 자동검증 — 매 답변 후 질문+답변을 grounding 에 대조해 결함 탐지(2026-06-18 사용자 "질문로그·답변로그 함께 검증").
//   결정론 체크(환각/누출/근거이탈). 결과는 Redis 로그(flowvium:judge-chat:verify)로 적재해 추세 추적.
interface ChatDefect { type: string; detail?: string }
function checkChatDefects(question: string, answer: string, grounding: { tickers?: Array<{ ticker: string; price: number | null }>; usedFiling?: boolean } | undefined): ChatDefect[] {
  const d: ChatDefect[] = [];
  const a = answer || '';
  const hasEngineData = (grounding?.tickers ?? []).some(t => t.price != null);
  // 1) 룰 ID·점수태그 누출 (price_momentum_52w_high, (+5) 등)
  if (/\(\+\d+\)/.test(a)) d.push({ type: 'score_tag_leak', detail: (a.match(/\(\+\d+\)/) ?? [''])[0] });
  if (/\b[a-z]+_[a-z]+_[a-z0-9]+\b/.test(a)) d.push({ type: 'rule_id_leak', detail: (a.match(/\b[a-z]+_[a-z]+_[a-z0-9]+\b/) ?? [''])[0] });
  // 1b) 엔진 블록 통째 복사 — "[이름 (티커)] 매수엔진 총점 N점 (발화:" 또는 "· 룰 종합:" 날것 포맷 노출
  if (/\[[^\]]*\([0-9A-Z.]{1,10}\)\]\s*매수엔진/.test(a) || /\(발화\s*:/.test(a) || /·\s*룰\s*종합\s*:/.test(a)) d.push({ type: 'engine_line_verbatim', detail: '엔진 블록 원문 복사' });
  // 2) 종목 데이터 없는데 엔진 점수 날조 (하우맷 사건)
  if (!hasEngineData && /(매수|매도)\s*엔진\s*(총점|점수)?\s*\d+\s*점/.test(a)) d.push({ type: 'engine_score_no_data' });
  // 3) 변동폭 과장 — N%(<3) 급락/급등
  for (const m of Array.from(a.matchAll(/([\d.]+)\s*%\s*(급락|급등|폭락|폭등)/g))) if (Math.abs(Number(m[1])) < 3) d.push({ type: 'magnitude_overstate', detail: m[0] });
  // 4) 가짜 배수 (이익의 질 938배 류)
  for (const m of Array.from(a.matchAll(/순이익의\s*([\d,]+)\s*배/g))) if (Number(m[1].replace(/,/g, '')) >= 10) d.push({ type: 'fake_multiple', detail: m[0] });
  // 5) stale 연도 환각 — 과거 연도(올해-2 이하)를 "기준/최신/현재"라 칭함 (2026인데 "2024년 기준" 사건)
  const curYear = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0, 4));
  for (const m of Array.from(a.matchAll(/20(\d\d)\s*년[^.\n]{0,14}(기준|최신|현재)/g))) {
    if (Number('20' + m[1]) <= curYear - 2) { d.push({ type: 'stale_year', detail: m[0].slice(0, 24) }); break; }
  }
  // 6) 진입가 현재가 괴리 — 단일 종목 답변에서 진입가가 현재가 ±15% 밖이면 환각 의심
  const priced = (grounding?.tickers ?? []).filter(t => t.price != null);
  if (priced.length === 1 && priced[0].price) {
    const P = priced[0].price;
    const em = a.match(/진입가?[^\d]{0,8}([\d,]+(?:\.\d+)?)\s*[~\-–]\s*([\d,]+(?:\.\d+)?)/);
    if (em) {
      const mid = (Number(em[1].replace(/,/g, '')) + Number(em[2].replace(/,/g, ''))) / 2;
      if (mid > 0 && Math.abs(mid / P - 1) > 0.15) d.push({ type: 'entry_far_from_price', detail: `진입중앙 ${Math.round(mid)} vs 현재 ${Math.round(P)} (${Math.round((mid / P - 1) * 100)}%)` });
    }
  }
  return d;
}
// 결정론 sanitize — 검출된 결함을 *답변 반환 전* 자동 제거(2026-06-18 사용자 "검증해서 고칠게 있으면 고쳐라·시스템화").
//   base 모델이 프롬프트를 무시해도 사용자는 정상 답변만 보게. checkChatDefects 와 같은 결함류를 기계적으로 교정.
function sanitizeAnswer(text: string, grounding: { tickers?: Array<{ ticker: string; price: number | null }> } | undefined): string {
  let a = text || '';
  const hasData = (grounding?.tickers ?? []).some(t => t.price != null);
  a = a.replace(/\s*\(\+\d+\)/g, '');                                   // (+5) 점수태그 제거
  a = a.replace(/^\s*[-•]?\s*\[[^\]]*\([0-9A-Z.]{1,10}\)\]\s*매수엔진[^\n]*\n?/gm, ''); // 엔진 원문라인 제거
  a = a.replace(/([\d.]+)\s*%\s*(급락|폭락)/g, (m, n) => Math.abs(Number(n)) < 3 ? `${n}% 하락` : m); // <3% 급락→하락
  a = a.replace(/([\d.]+)\s*%\s*(급등|폭등)/g, (m, n) => Math.abs(Number(n)) < 3 ? `${n}% 상승` : m);
  if (!hasData) {  // 종목별 엔진 미실행(추천목록·미특정)인데 엔진점수 날조 시 제거
    a = a.replace(/[→·\-\s]*\*{0,2}매수엔진\s*(?:점수|총점)?\s*\d+\s*점\*{0,2}\s*[,·/]?\s*\*{0,2}매도엔진\s*(?:점수|총점)?\s*\d+\s*점\*{0,2}\s*[.→]?/g, '');
    a = a.replace(/\*{0,2}(?:매수|매도)\s*엔진\s*(?:점수|총점)?\s*\d+\s*점\*{0,2}/g, '');
  }
  return a.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function verifyChatAndLog(redis: ReturnType<typeof createRedis>, p: { uid: string; question: string; answer: string; grounding: Record<string, unknown>; mode: string; source: string; corrected?: boolean }): Promise<void> {
  try {
    const defects = checkChatDefects(p.question, p.answer, p.grounding as { tickers?: Array<{ ticker: string; price: number | null }>; usedFiling?: boolean });
    if (redis) {
      await redis.lpush('flowvium:judge-chat:verify', JSON.stringify({ ts: new Date().toISOString(), uid: p.uid, q: p.question.slice(0, 120), mode: p.mode, source: p.source, len: p.answer.length, defectCount: defects.length, defects, corrected: !!p.corrected }));
      await redis.ltrim('flowvium:judge-chat:verify', 0, 4999);
    }
    if (defects.length) logger.warn('judge-chat', 'verify_defects', { mode: p.mode, count: defects.length, types: defects.map(x => x.type).join(',') });
    else logger.info('judge-chat', 'verify_clean', { mode: p.mode });
  } catch { /* 검증 실패는 비치명적 */ }
}

// ── 챗 학습 폐루프(2026-06-18): 검증로그(flowvium:judge-chat:verify) 의 최근 반복 결함 → 다음 프롬프트 anti-pattern.
//   리포트의 hallucination_history→프롬프트 루프를 챗에 복제. *검증로그가 소비처 없는 dead-end* 였던 사각지대 해소.
//   결함유형→교훈 매핑. 최근 N건 중 실제로 발생한 상위 유형만 surface(프롬프트 비대화 방지). 모듈캐시 10분.
const DEFECT_LESSON: Record<string, string> = {
  score_tag_leak: '룰 점수 태그 "(+5)" 류를 답변에 그대로 노출하지 마라 — 우리말 문장으로 풀어 써라.',
  rule_id_leak: '영문 룰 ID(snake_case, 예: price_momentum_52w_high)를 출력하지 마라 — 의미를 우리말로 풀어라.',
  engine_line_verbatim: '"엔진 판정" 블록의 대괄호·"(발화:..)"·"룰 종합:" 줄을 그대로 복사하지 마라.',
  engine_score_no_data: '종목 데이터가 없을 때(추천목록·미특정) "매수엔진 N점/매도엔진 M점" 을 절대 지어내지 마라.',
  magnitude_overstate: '3% 미만 변동에 "급락/급등/폭락/폭등" 을 쓰지 마라 — "소폭 하락/상승" 으로.',
  fake_multiple: '"순이익의 N배" 같은 과장 배수를 만들지 마라 — 라벨에 있는 수치만 인용.',
  stale_year: '"2024년 기준" 처럼 과거 연도를 최신이라 하지 마라 — 오늘 기준 "최근 분기/연간" 으로.',
  entry_far_from_price: '진입가는 반드시 현재가 ±10% 이내로 — 현재가와 동떨어진 진입가 금지.',
};
let _lessonCache: { ts: number; text: string } | null = null;
async function recentChatAntiPatterns(redis: ReturnType<typeof createRedis>): Promise<string> {
  if (_lessonCache && Date.now() - _lessonCache.ts < 600_000) return _lessonCache.text;
  let text = '';
  try {
    if (redis) {
      const raw = (await redis.lrange('flowvium:judge-chat:verify', 0, 199)) as string[];
      const counts: Record<string, number> = {};
      for (const s of raw) {
        try {
          const e = JSON.parse(s) as { defects?: Array<{ type: string }> };
          for (const d of e.defects ?? []) if (DEFECT_LESSON[d.type]) counts[d.type] = (counts[d.type] ?? 0) + 1;
        } catch { /* skip */ }
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      text = top.map(([t, n]) => `- ${DEFECT_LESSON[t]} (최근 ${n}회 발생)`).join('\n');
    }
  } catch { /* non-fatal — 교훈 없이 진행 */ }
  _lessonCache = { ts: Date.now(), text };
  return text;
}

// 종목질문 패턴 — detectTickers 가 못 잡았을 때 LLM 해석 fallback 발동 조건(하우맷→HWM 사건).
const STOCK_Q = /사요|살까|사도\s*[돼되]|팔까|팔아|매수|매도|비중|진입|손절|목표가|전망|어때|괜찮|투자\s*해|들어가|담아/;
// 추천목록 요청 패턴 — 특정 종목이 아니라 "오늘 뭐 살까/top/추천" → 리포트 portfolio 노출(특정종목 해석과 구분).
const RECO_Q = /추천|top\s*\d|뭐\s*(사|살|매수)|살\s*만한|매수할\s*만한|포트폴리오|portfolio|픽\b|picks?\b|오늘\s*(뭐|종목)/i;
// 한글 종목명 → 티커 LLM 해석 + Yahoo 검증(환각 티커 차단). 사전 alias 부재(하우맷·엔비디아 등) 보완.
// Yahoo 검색 — 회사명→티커(권위). LLM 의 6자리 KR 코드 추측이 틀리는 문제(하이닉스→233740 오류) 회피.
async function yahooSearch(q: string): Promise<Array<{ symbol: string; name: string }>> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000) });
    if (!r.ok) return [];
    const d = await r.json() as { quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; quoteType?: string }> };
    return (d.quotes ?? []).filter(x => x.symbol && (x.quoteType === 'EQUITY' || !x.quoteType)).map(x => ({ symbol: x.symbol!, name: (x.shortname || x.longname || '') }));
  } catch { return []; }
}
// 우리 큐레이션 풀(candidate-tickers) 로드 — 신규발견 판별용.
let _poolSet: Set<string> | null = null;
function inPool(ticker: string): boolean {
  if (!_poolSet) {
    _poolSet = new Set();
    try {
      const j = JSON.parse(readFileSync(resolve(process.cwd(), 'data/candidate-tickers.json'), 'utf8')) as { meta?: Record<string, unknown> };
      for (const k of Object.keys(j.meta ?? {})) _poolSet.add(k.toUpperCase());
    } catch { /* */ }
  }
  return _poolSet.has(ticker.toUpperCase());
}
// 풀 밖 신규발견 티커 추적 — ZSET(질문 누적횟수) + 최근 질문/시각. 인기종목 유니버스 승격 검토용.
async function recordDiscovered(redis: ReturnType<typeof createRedis>, ticker: string, q: string): Promise<void> {
  try {
    if (!redis || inPool(ticker)) return;
    await redis.zincrby('flowvium:discovered-tickers', 1, ticker.toUpperCase());
    await redis.hset('flowvium:discovered-meta', { [ticker.toUpperCase()]: JSON.stringify({ lastQ: q.slice(0, 60), at: new Date().toISOString() }) });
  } catch { /* non-fatal */ }
}

// 티커 직접 검증 — Yahoo 에 그 심볼이 실제 존재+가격 있는지(우리 풀에 없어도 SPCX 등 해석).
async function yahooHasTicker(sym: string): Promise<boolean> {
  try {
    const yt = /\.(KS|KQ)$/.test(sym) ? sym : sym.replace(/\./g, '-');
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yt)}?range=5d&interval=1d`, { signal: AbortSignal.timeout(7000), headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) return false;
    const d = await r.json();
    return (d?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0) > 0;
  } catch { return false; }
}
async function resolveTickersLLM(text: string, max: number): Promise<string[]> {
  try {
    // 1) 사용자가 *명시 티커*(영문 1-6자, 6자리 KR)를 쳤으면 그 심볼을 Yahoo 에 직접 조회 — 우리 풀에 없어도
    //    실재하면 그대로 사용(SPCX=SpaceX 등). 유사 종목 치환 없이 정확매칭(2026-06-18 SPCX 사건).
    const bare = text.trim().toUpperCase();
    if (/^[A-Z]{1,6}$/.test(bare) && await yahooHasTicker(bare)) return [bare];
    const krCode = text.trim().match(/^(\d{6})(\.(KS|KQ))?$/);
    if (krCode) { for (const sfx of ['.KS', '.KQ']) { if (await yahooHasTicker(krCode[1] + sfx)) return [krCode[1] + sfx]; } }
    // LLM 은 *영문 회사명*만 추출(코드 추측 금지) → Yahoo 검색이 권위있게 티커 해석.
    const sys = '사용자 메시지에서 언급된 주식의 *영문 정식 회사명*을 추출하라. 예: 하이닉스→"SK Hynix", 하우맷→"Howmet Aerospace", 엔비디아→"NVIDIA", 삼성전자→"Samsung Electronics", 기아→"Kia". 종목 언급이 없으면 빈 배열. JSON 만 출력: {"names":["SK Hynix"]}';
    const r = await callAI(text, { systemPrompt: sys, maxTokens: 80, temperature: 0, tag: 'ticker-resolve', timeoutMs: 15000 });
    const mm = (r.text || '').match(/\{[\s\S]*\}/);
    if (!mm) return [];
    const names = (JSON.parse(mm[0]).names ?? []) as unknown[];
    const isKrQuery = /[가-힣]/.test(text);
    // 사용자가 *명시 티커*(영문 2-6자 단독)를 쳤으면 그 티커와 *정확히* 일치하는 결과만 허용 — 유사 치환 금지
    //   (SPCX→SPCE, 하이닉스→233740 류 오해석 차단). 회사명 질문엔 적용 안 함.
    const explicitTk = (text.trim().match(/^[A-Za-z]{2,6}$/) || [])[0]?.toUpperCase() ?? null;
    const out: string[] = [];
    for (const raw of names.slice(0, max)) {
      const name = String(raw).trim();
      if (name.length < 2) continue;
      const quotes = await yahooSearch(name);
      if (!quotes.length) continue;
      // 한국 종목 질문이면 .KS/.KQ 우선, 아니면 첫 EQUITY. 이름 관련성 확보(검색결과라 자동).
      const kr = quotes.find(q => /\.(KS|KQ)$/.test(q.symbol));
      const pick = (isKrQuery && kr) ? kr : quotes[0];
      // 명시 티커인데 해석결과 base 가 다르면 = 유사 치환 → 거부(못 찾음으로 처리, 모순 칩 방지).
      if (explicitTk && pick.symbol.replace(/\.(KS|KQ)$/, '').toUpperCase() !== explicitTk) continue;
      // 가격 존재 검증
      try {
        const yt = /\.(KS|KQ)$/.test(pick.symbol) ? pick.symbol : pick.symbol.replace(/\./g, '-');
        const yr = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yt)}?range=5d&interval=1d`, { signal: AbortSignal.timeout(7000), headers: { 'user-agent': 'Mozilla/5.0' } });
        if (yr.ok) { const d = await yr.json(); if ((d?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0) > 0) out.push(pick.symbol); }
      } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

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
    const mode: JudgeMode = (['aits', 'aits-rag', 'aits-deep'].includes(body.mode as string) ? body.mode : 'aits-deep') as JudgeMode;
    const locale = body.locale ?? 'ko';
    if (!messages.length) return NextResponse.json({ error: 'no messages' }, { status: 400 });

    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    if (!lastUser.trim()) return NextResponse.json({ error: 'no user message' }, { status: 400 });
    if (lastUser.length > 2000) return NextResponse.json({ error: 'message too long' }, { status: 413 });

    const { uid, newAnon } = resolveUid(request);
    const redis = createRedis();
    const xff = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const ip = xff || request.headers.get('x-real-ip') || '127.0.0.1';
    // 레이트리밋 면제 = 내부/로컬 직호출(테스트·파이프라인·SSR fetch). 헤더 부재뿐 아니라 loopback·사설 IP 도 내부.
    //   (next start 가 XFF 를 IPv4-mapped loopback "::ffff:127.0.0.1" 로 채워 헤더-부재 판정만으론 면제 실패하던 버그.)
    //   실유저는 cloudflared 가 *공인* client IP 를 XFF 로 넣어 이 정규식에 안 걸려 정상 제한된다.
    const internal = !xff && !request.headers.get('x-real-ip')
      || /^(::1|::ffff:127\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
    if (!internal && await rateLimited(redis, ip)) {
      return withAnonCookie(NextResponse.json({ error: 'rate_limited', reply: '잠시 후 다시 시도해 주세요 (시간당 한도 도달).' }, { status: 429 }), newAnon);
    }

    const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
    const opts = MODE_OPTS[mode];
    let tickers = detectTickers(lastUser, opts.maxTickers);
    const convId = body.convId || `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

    // 컨텍스트 수집(+심층 리서치). onProgress 로 단계별 진행상황 emit → 스트리밍 로딩 UI("무슨 자료 받고 뭘 분석중인지").
    type Progress = { stage: string; detail: string };
    const buildAll = async (onProgress?: (p: Progress) => void) => {
      // 추천/top/뭐 살까 류(특정 종목 미지정) — 오늘 리포트 portfolio 를 답으로. 특정종목 해석 fallback 과 구분.
      const isRecoQ = RECO_Q.test(lastUser);
      // 종목명 해석 실패 fallback(하우맷→HWM·nke 사건): 종목질문이거나 *짧은 메시지*(티커/이름만 친 경우)면 LLM 해석+Yahoo 검증.
      if (!tickers.length && !isRecoQ && (STOCK_Q.test(lastUser) || lastUser.trim().length <= 24)) {
        onProgress?.({ stage: 'resolve', detail: '🔎 종목 식별 중 (이름→티커 해석)' });
        tickers = await resolveTickersLLM(lastUser, opts.maxTickers);
        // 풀(1,210) 밖에서 새로 발견된 실재 티커 추적 — 어떤 종목을 사용자가 묻는데 우리가 미커버하는지 가시화.
        //   company page 는 이미 동적이라 페이지는 존재. ZSET(질문횟수)로 인기 발견종목→유니버스 승격 검토.
        for (const t of tickers) void recordDiscovered(redis, t, lastUser);
      }
      const nameList = tickers.map(t => tickerName(t)).join(', ');
      onProgress?.({ stage: 'gather', detail: tickers.length
        ? `${nameList} 자료 수집 중 — ${opts.deep ? '📄 사업보고서 본문·' : ''}시세·재무·뉴스·거시${opts.useRag ? '·투자고전(RAG)' : ''}`
        : isRecoQ ? '📋 오늘 리포트 매수 포트폴리오 불러오는 중' : '시세·거시·투자고전 자료 수집 중' });
      const [tickerCtx, reportContext, ragHits, macroContext, chatLessons] = await Promise.all([
        Promise.all(tickers.map(t => gatherTickerContext(t, origin, { withFiling: opts.deep }).catch((): TickerCtx => ({ ticker: t, name: tickerName(t) })))),
        fetchReportContext(origin, locale, tickers, { includeList: isRecoQ || !tickers.length }),
        opts.useRag ? ragRetrieve(lastUser, 4).catch((): RagHit[] => []) : Promise.resolve([] as RagHit[]),
        fetchMacroContext(origin).catch(() => ({ text: '', vix: null, fg: null })),
        recentChatAntiPatterns(redis),  // 챗 학습 폐루프 — 최근 반복결함 anti-pattern 주입
      ]);
      // TAISN 심층(2-pass): ① 사업·업황·전망 리서치 브리프 생성(사실 정리) → ② 그 위에 판단.
      let researchBrief = '';
      if (opts.deep && tickerCtx.some(c => c.price != null)) {
        onProgress?.({ stage: 'research', detail: '🔍 1차 리서치 브리프 작성 중 (사업구조·업황·경쟁·강세/약세 시나리오)' });
        try {
          const rp = buildResearchPrompt({ locale, tickerCtx, macroContext: macroContext.text });
          const rr = await callAI('위 데이터로 사업·업황·경쟁포지션·강세/약세 시나리오 리서치 브리프를 작성하라.', { systemPrompt: rp, maxTokens: 1400, temperature: 0.4, tag: 'judge-research', timeoutMs: 45000 });
          researchBrief = rr.text || '';
        } catch { /* 리서치 실패 시 브리프 없이 진행 */ }
      }
      onProgress?.({ stage: 'judge', detail: opts.deep ? '⚖️ 엔진 판정 + 최종 심층 분석 작성 중' : '⚖️ 엔진 판정 + 답변 작성 중' });
      const systemPrompt = buildSystemPrompt({ locale, mode, tickerCtx, reportContext, ragHits, macroContext: macroContext.text, macro: { vix: macroContext.vix, fg: macroContext.fg }, researchBrief, chatLessons });
      const userPrompt = `다음은 사용자와의 대화다. 마지막 사용자 질문에 심판엔진으로서 답하라.\n\n${transcript(messages)}\n\n심판엔진:`;
      const grounding = {
        tickers: tickerCtx.map(c => ({ ticker: c.ticker, name: c.name, price: c.price ?? null, rsi: c.rsi ?? null })),
        usedRules: true, usedReport: !!reportContext, usedMacro: !!macroContext,
        usedRag: ragHits.length > 0, usedFiling: tickerCtx.some(c => c.filing),
        ragSources: ragHits.map(h => ({ source: h.source, year: h.year ?? null, score: Number(h.score.toFixed(2)) })),
      };
      return { systemPrompt, userPrompt, grounding };
    };

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
          send({ type: 'progress', stage: 'detect', detail: tickers.length ? `질문 종목 인식: ${tickers.map(t => tickerName(t)).join(', ')}` : '질문 분석 중…' });
          // vLLM 동시요청 전역 세마포어 — 가득 차면 대기 안내 후 큐. 1요청 = 1슬롯(해석·리서치·최종 전 구간 점유).
          const release = await acquireLlm((ahead) => send({ type: 'progress', stage: 'queue', detail: `⏳ ${waitMessage(ahead)}` }));
          try {
            let systemPrompt: string, userPrompt: string, grounding: Record<string, unknown>;
            try {
              ({ systemPrompt, userPrompt, grounding } = await buildAll((p) => send({ type: 'progress', stage: p.stage, detail: p.detail })));
            } catch (e) {
              logger.warn('judge-chat', 'build_fail', { error: e instanceof Error ? e.message : 'x' });
              send({ type: 'delta', text: '자료를 수집하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
              send({ type: 'done', source: 'error' }); controller.close(); return;
            }
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
            // 결정론 sanitize — 결함 자동교정. corrected = *실제 결함이 줄었을 때만*(공백변경 제외).
            const g = grounding as { tickers?: Array<{ ticker: string; price: number | null }> };
            const clean = sanitizeAnswer(full, g);
            const corrected = checkChatDefects(lastUser, full, g).length > checkChatDefects(lastUser, clean, g).length;
            if (clean !== full) send({ type: 'replace', text: clean });
            await persist(clean, source);
            void verifyChatAndLog(redis, { uid, question: lastUser, answer: full, grounding, mode, source, corrected }); // 원문 기준 검증 로그(교정여부 기록)
            logger.info('judge-chat', 'ok', { source, mode, tickers: tickers.join(','), len: clean.length, stream: true, corrected });
            send({ type: 'done', source });
            controller.close();
          } finally { release(); }
        },
      });
      const res = new NextResponse(sse, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
      return withAnonCookie(res, newAnon);
    }

    // ── 논스트림 경로 (기존) — vLLM 세마포어로 1요청=1슬롯 점유(빌드+생성) ────────────
    const release = await acquireLlm();
    let systemPrompt: string, userPrompt: string, grounding: Record<string, unknown>;
    let text: string | undefined, source: string | undefined, durationMs: number | undefined, attempts: Array<{ error?: string }> | undefined;
    try {
      ({ systemPrompt, userPrompt, grounding } = await buildAll());
      ({ text, source, durationMs, attempts } = await callAI(userPrompt, {
        systemPrompt, maxTokens: opts.maxTokens, temperature: opts.temperature,
        preferSmallModel: opts.preferSmallModel, tag: 'judge-chat', timeoutMs: 45000,
      }));
    } finally { release(); }
    if (!text) {
      const reason = attempts?.find(a => a.error)?.error;
      logger.warn('judge-chat', 'all_providers_failed', { reason });
      return withAnonCookie(NextResponse.json({ error: 'llm_unavailable', reply: '지금 심판엔진이 응답할 수 없습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 }), newAnon);
    }
    const g2 = grounding as { tickers?: Array<{ ticker: string; price: number | null }> };
    const clean = sanitizeAnswer(text, g2);
    const corrected = checkChatDefects(lastUser, text, g2).length > checkChatDefects(lastUser, clean, g2).length;
    logger.info('judge-chat', 'ok', { source, mode, tickers: tickers.join(','), len: clean.length, corrected });
    await persist(clean, source);
    void verifyChatAndLog(redis, { uid, question: lastUser, answer: text, grounding, mode, source: source ?? 'unknown', corrected });
    return withAnonCookie(NextResponse.json({ reply: clean, source, mode, durationMs, grounding, convId, title: titleOf([...messages, { role: 'assistant', content: clean }]) }), newAnon);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logger.error('judge-chat', 'failed', { error: msg });
    return NextResponse.json({ error: 'internal', reply: '오류가 발생했습니다. 다시 시도해 주세요.' }, { status: 500 });
  }
}
