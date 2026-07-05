#!/usr/bin/env node
// e2e-chat-longform.mjs — 장문질문 + 연속 장문 후속질문 맥락유지 E2E (2026-07-05)
//
// 사용자 "장문질문에 대한 답변과 장문질문이 여러번 연속될시 후속질문 맥락소실 되는것 다 검증".
// aisvi-deep(기본 모드)로 실제 3턴:
//   턴1: ~900자 장문 질문(종목 명시가 문장 중간에 묻힘) → 종목 인식 + 가격 grounding + 결함 0
//   턴2: ~700자 장문 후속(지시어 "그럼", 종목명 없음) → 같은 종목 유지(★맥락소실 회귀지표) + 결함 0
//   턴3: ~600자 장문 후속(지시어 "이 종목", 종목명 없음) → 같은 종목 유지 + 결함 0
// 각 턴: chat-verify 15종 결함(절단/한자/누출/가격환각 포함. verdict_mismatch 는 확률적 → WARN),
//        답변 최소 길이(심층 모드 공동화 방지), 턴별 latency 출력(브리프 캐시·ctx 캐시 효과 가시화).
// 라이브 스택 필요. LLM 3+콜 — verify-all 미배선, 챗/프롬프트 경로 변경 시 수동 실행.
// 사용: node scripts/e2e-chat-longform.mjs [--base=http://127.0.0.1:3000] [--mode=aisvi-deep]
import { checkChatDefects } from './lib/chat-verify.mjs';

const BASE = (process.argv.find(a => a.startsWith('--base=')) || '--base=http://127.0.0.1:3000').split('=')[1];
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=aisvi-deep').split('=')[1];
const TK = 'NVDA';
let fail = 0;

const ask = async (messages) => {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/judge-chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, mode: MODE, locale: 'ko' }),
    signal: AbortSignal.timeout(300000),
  });
  if (!r.ok) throw new Error(`http ${r.status}`);
  const j = await r.json();
  return { ...j, ms: Date.now() - t0 };
};

const pad = (s, n = 120) => { let out = s; while (out.length < n) out += ' 시장 상황과 밸류에이션, 수급, 거시 변수까지 함께 고려한 관점이 궁금합니다.'; return out; };

// 장문 픽스처 — 종목 언급이 문장 *중간*에 묻히게 구성(앞부분만 보는 절단 회귀 감지).
const Q1 = pad(`요즘 포트폴리오 리밸런싱을 고민하고 있는데, 반도체 섹터 비중을 어떻게 가져갈지 판단이 서지 않습니다. 미국 금리가 여전히 높은 수준이고 연준의 추가 인하 시점도 불확실한 상황에서, 성장주 밸류에이션 부담이 크다는 지적이 많잖아요. 그런 관점에서 ${TK} 를 지금 시점에 신규로 담는 게 맞는지 궁금합니다. 데이터센터 수요는 여전히 강하다고 하지만 이미 주가에 상당 부분 반영됐다는 반론도 있고, 경쟁사들의 추격과 고객사들의 자체 칩 개발 움직임도 신경 쓰입니다. 재무 지표와 기술적 위치, 그리고 수급까지 종합해서 진입 여부와 만약 진입한다면 분할 매수 전략을 어떻게 가져가야 할지 구체적으로 알려주세요.`, 700);
const Q2 = pad(`그럼 방금 분석해준 내용에서 조금 더 들어가서, 만약 지금 진입한 뒤에 단기적으로 10% 이상 조정이 온다면 어떻게 대응해야 할까요? 물타기는 금지라고 알고 있는데, 그렇다면 손절 라인을 어디에 설정해야 하고, 반대로 수익이 나기 시작하면 어느 지점에서 분할 익절을 시작하는 게 합리적인지 궁금합니다. 특히 변동성이 큰 종목이라 스톱을 너무 타이트하게 잡으면 휩쏘에 걸릴 것 같고, 너무 느슨하게 잡으면 손실이 커질 것 같아서 그 균형점이 고민입니다.`, 500);
const Q3 = pad(`아까 이 종목 얘기하면서 경쟁 리스크를 언급했는데, 그 부분을 좀 더 자세히 풀어주세요. 실제로 경쟁사 추격이나 고객사 자체 칩 개발이 향후 실적에 어느 정도 위협이 되는지, 그리고 그런 리스크가 현실화되는 신호를 어떤 지표로 미리 감지할 수 있는지 궁금합니다. 장기 보유 관점에서 어떤 조건이 깨지면 팔아야 하는지도 알려주세요.`, 400);

const turns = [
  { q: Q1, label: '턴1 장문(종목 중간 묻힘)', needPrice: true },
  { q: Q2, label: '턴2 장문 후속(지시어 "그럼")', needPrice: false },
  { q: Q3, label: '턴3 장문 후속(지시어 "이 종목")', needPrice: false },
];

const messages = [];
const lat = [];
for (const t of turns) {
  messages.push({ role: 'user', content: t.q });
  const a = await ask(messages);
  lat.push(a.ms);
  const g = a.grounding?.tickers ?? [];
  const hit = g.some(x => String(x.ticker).toUpperCase().startsWith(TK) && (!t.needPrice || x.price != null));
  const reply = String(a.reply ?? '');
  console.log(`\n[${t.label}] ${(a.ms / 1000).toFixed(1)}s · ${a.source} · 질문 ${t.q.length}자 → 답변 ${reply.length}자 | grounding: ${g.map(x => x.ticker).join(',') || '-'}`);
  if (!hit) { fail++; console.log(`❌ 맥락소실 — grounding 에 ${TK} 없음`); } else console.log(`✅ ${TK} 맥락 유지`);
  if (reply.length < 300) { fail++; console.log(`❌ 심층 답변이 너무 짧음(${reply.length}자) — 공동화/절단 의심`); }
  const d = checkChatDefects(t.q, reply, a.grounding, 'ko');
  const hard = d.filter(x => x.type !== 'verdict_mismatch');
  for (const w of d.filter(x => x.type === 'verdict_mismatch')) console.log(`⚠️ verdict_mismatch (폐루프 학습 대상): ${w.detail ?? ''}`);
  if (hard.length) { fail++; console.log(`❌ 답변 결함: ${hard.map(x => `${x.type}(${x.detail ?? ''})`).join(', ')}`); }
  else console.log('✅ 결정론 결함 0 (절단/한자/누출/가격환각 포함)');
  messages.push({ role: 'assistant', content: reply });
}

console.log(`\n[턴별 latency] ${lat.map((x, i) => `턴${i + 1} ${(x / 1000).toFixed(1)}s`).join(' · ')} — 턴2·3이 턴1보다 빠르면 브리프/컨텍스트 캐시 작동 중`);
console.log(fail ? `\n❌ 장문 E2E FAIL ${fail}건` : '\n✅ 장문·연속장문 E2E 전부 통과');
process.exitCode = fail ? 1 : 0;
