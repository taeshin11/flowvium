#!/usr/bin/env node
// e2e-chat-multiturn.mjs — 심판엔진 챗 멀티턴 맥락유지 E2E (2026-07-05, AISVI 노드 E2E 하네스 차용)
//
// AISVI 증상B 동형 회귀 가드: 후속질문("그럼 팔까?")이 이전 턴 종목 맥락을 잃으면 grounding 이 비고
// generic 답변이 나감. 이 하네스는 실제 /api/judge-chat 을 2턴 호출해:
//   턴1: 특정 종목 질문 → grounding.tickers 에 해당 종목 + 가격 존재
//   턴2: 종목명 없는 후속질문(+턴1 히스토리) → grounding 이 같은 종목을 유지하는지 (★핵심 회귀지표)
//   각 답변: chat-verify 결함 0 인지 (한자/누출/절단 등 15종)
// 라이브 스택 필요(next:3000 + vLLM:8000). LLM 2콜이라 verify-all 미배선 — 챗 경로 변경 시 수동 실행.
// 사용: node scripts/e2e-chat-multiturn.mjs [--base=http://127.0.0.1:3000] [--ticker=NVDA]
import { checkChatDefects } from './lib/chat-verify.mjs';

const BASE = (process.argv.find(a => a.startsWith('--base=')) || '--base=http://127.0.0.1:3000').split('=')[1];
const TICKER = (process.argv.find(a => a.startsWith('--ticker=')) || '--ticker=NVDA').split('=')[1].toUpperCase();
let fail = 0;
const ask = async (messages) => {
  const r = await fetch(`${BASE}/api/judge-chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, mode: 'aisvi', locale: 'ko' }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.json();
};

// 턴1 — 종목 명시 질문
const q1 = `${TICKER} 지금 사도 돼?`;
const t0 = Date.now();
const a1 = await ask([{ role: 'user', content: q1 }]);
const g1 = (a1.grounding?.tickers ?? []).filter(t => t.price != null);
const hit1 = g1.some(t => String(t.ticker).toUpperCase().startsWith(TICKER));
console.log(`[턴1] ${q1} → ${a1.source} ${Date.now() - t0}ms | grounding: ${g1.map(t => t.ticker).join(',') || '-'}`);
if (!hit1) { fail++; console.log(`❌ 턴1 grounding 에 ${TICKER} 없음`); } else console.log(`✅ 턴1 종목 인식 + 가격 grounding`);
const d1 = checkChatDefects(q1, String(a1.reply ?? ''), a1.grounding, 'ko');
const hard1 = d1.filter(x => x.type !== 'verdict_mismatch');
for (const w of d1.filter(x => x.type === 'verdict_mismatch')) console.log(`⚠️ 턴1 verdict_mismatch (폐루프 학습 대상): ${w.detail ?? ''}`);
if (hard1.length) { fail++; console.log(`❌ 턴1 답변 결함: ${hard1.map(x => x.type).join(',')}`); } else console.log('✅ 턴1 결정론 결함 0');

// 턴2 — 종목명 없는 후속질문 (★맥락해소 핵심 회귀지표)
const q2 = '그럼 지금은 팔아야 돼?';
const t1 = Date.now();
const a2 = await ask([
  { role: 'user', content: q1 },
  { role: 'assistant', content: String(a1.reply ?? '').slice(0, 800) },
  { role: 'user', content: q2 },
]);
const g2 = (a2.grounding?.tickers ?? []);
const hit2 = g2.some(t => String(t.ticker).toUpperCase().startsWith(TICKER));
console.log(`[턴2] ${q2} → ${a2.source} ${Date.now() - t1}ms | grounding: ${g2.map(t => t.ticker).join(',') || '-'}`);
if (!hit2) { fail++; console.log(`❌ 턴2 맥락소실 — 후속질문이 ${TICKER} 로 해소 안 됨 (history 미전달/해석실패)`); }
else console.log(`✅ 턴2 맥락유지 — 후속질문이 ${TICKER} 로 해소됨`);
// verdict_mismatch 는 확률적 LLM 결함(폐루프 교훈주입으로 감쇠) — 회귀 하네스에선 WARN 만(플레이키 방지).
//   결정론 계열(누출/한자/절단/가격 오파싱 등)만 FAIL.
const d2 = checkChatDefects(q2, String(a2.reply ?? ''), a2.grounding, 'ko');
const hard2 = d2.filter(x => x.type !== 'verdict_mismatch');
for (const w of d2.filter(x => x.type === 'verdict_mismatch')) console.log(`⚠️ 턴2 verdict_mismatch (폐루프 학습 대상): ${w.detail ?? ''}`);
if (hard2.length) { fail++; console.log(`❌ 턴2 답변 결함: ${hard2.map(x => x.type).join(',')}`); } else console.log('✅ 턴2 결정론 결함 0');

console.log(fail ? `\n❌ E2E FAIL ${fail}건` : '\n✅ E2E 멀티턴 전부 통과');
process.exitCode = fail ? 1 : 0; // process.exit() 은 fetch keep-alive 핸들과 경합해 win32 libuv assert 유발 — graceful 종료
