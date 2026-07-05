#!/usr/bin/env node
// e2e-chat-compact.mjs — 챗 compact(긴 대화 창 밖 요약 압축) E2E (2026-07-05, 사용자 "compact 처럼 축약하나?")
//
// 시나리오: 12메시지(6턴) 대화를 클라이언트가 보유한 상태에서 — 핵심 사실(NVDA 180달러 20주 매수)은
//   *첫 턴에만* 존재(최근 8메시지 창 밖). ① POST#1: 창 밖 정보라 프롬프트 미포함이지만 백그라운드
//   요약이 생성되는지 ② 요약 생성 대기 후 POST#2: "아까 산 단가·수량 기준 수익률" 질문에 요약 경유로
//   180/20주 맥락이 답변에 살아있는지(★compact 핵심 회귀지표). 쿠키(fv_chat_uid) 유지 필수.
// 라이브 스택 필요(LLM 2+1콜). 사용: node scripts/e2e-chat-compact.mjs [--base=http://127.0.0.1:3000]
import Redis from 'ioredis';

const BASE = (process.argv.find(a => a.startsWith('--base=')) || '--base=http://127.0.0.1:3000').split('=')[1];
let cookie = '';
let fail = 0;
const ask = async (messages, convId) => {
  const r = await fetch(`${BASE}/api/judge-chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ messages, mode: 'aisvi', locale: 'ko', ...(convId ? { convId } : {}) }),
    signal: AbortSignal.timeout(300000),
  });
  const setC = r.headers.get('set-cookie');
  if (setC && !cookie) cookie = setC.split(';')[0];
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.json();
};

// 6턴(12메시지) 대화 — 핵심 사실은 턴1에만. 이후 턴은 다른 화제(창 밖으로 밀어내기).
const hist = [
  { role: 'user', content: '나 3주 전에 NVDA를 주당 180달러에 20주 매수했어. 지금 어때?' },
  { role: 'assistant', content: 'NVDA 20주를 180달러에 매수하셨군요. 현재 추세는 유효하니 보유 관점이 좋아 보입니다.' },
  { role: 'user', content: '요즘 시장 변동성은 어때?' },
  { role: 'assistant', content: 'VIX 는 낮은 수준으로 변동성 축소 국면입니다.' },
  { role: 'user', content: '반도체 업황 전반은 어떻게 봐?' },
  { role: 'assistant', content: 'AI 인프라 수요로 반도체 업황은 확장 국면입니다.' },
  { role: 'user', content: '금리는 언제 내릴 것 같아?' },
  { role: 'assistant', content: '차기 FOMC 에서 동결 확률이 우세합니다.' },
  { role: 'user', content: '환율 영향은 어때?' },
  { role: 'assistant', content: '원화 약세는 수출주에 우호적입니다.' },
];

// POST#1 — 11번째 사용자 메시지 (이 시점 총 12메시지 > 창 8 → 백그라운드 요약 트리거 기대)
const q1 = '오늘 코스피 분위기는 어때?';
const a1 = await ask([...hist, { role: 'user', content: q1 }]);
const convId = a1.convId;
console.log(`[POST#1] ${q1} → ${a1.source} | convId=${convId} | 쿠키=${cookie ? 'ok' : '없음'}`);

// 백그라운드 요약 생성 대기(최대 90s) — Redis conv.summary 폴링
const r = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 2 });
let summary = null, key = null;
try {
  const idx = (await r.lrange('flowvium:judge-chat:index', 0, 5)).map(x => JSON.parse(x)).find(e => e.key?.endsWith(`:${convId}`));
  key = idx?.key;
  if (!key) { fail++; console.log('❌ index 에서 conv 키 못 찾음'); }
  else for (let i = 0; i < 18; i++) {
    const conv = JSON.parse(await r.get(key) ?? '{}');
    if (conv.summary) { summary = conv.summary; break; }
    await new Promise(res => setTimeout(res, 5000));
  }
} finally { r.disconnect(); }
if (!summary) { fail++; console.log('❌ compact 요약 미생성 (90s 내 conv.summary 없음)'); }
else {
  console.log(`✅ compact 요약 생성됨 (${summary.length}자): ${summary.slice(0, 120).replace(/\n/g, ' ')}...`);
  const keepsFacts = /180/.test(summary) && /20\s*주/.test(summary);
  if (!keepsFacts) { fail++; console.log('❌ 요약이 핵심 사실(180달러/20주)을 보존하지 못함'); }
  else console.log('✅ 요약이 매입가 180달러·20주 보존');
}

// POST#2 — 창 밖 사실을 요구하는 질문 (총 14메시지: 턴1은 확실히 창 밖)
if (summary) {
  const q2 = '아까 내가 산 단가와 수량 기준으로 지금 수익률이 어느 정도야?';
  const a2 = await ask([...hist, { role: 'user', content: q1 }, { role: 'assistant', content: String(a1.reply ?? '').slice(0, 500) }, { role: 'user', content: q2 }], convId);
  const reply = String(a2.reply ?? '');
  console.log(`[POST#2] ${q2} → ${a2.source} | 답변 ${reply.length}자`);
  // 매입가(180) 소환 + 수익률(%) 계산이면 성공 — 수량(20주)은 수익률 % 계산에 불요라 요구하지 않음
  //   (첫 실행에서 "180달러 매수 기준 수익률 약 8.2%" 정답을 20주 미언급으로 오탈락시킨 과검 교정).
  const recalls = /180/.test(reply) && /%/.test(reply);
  if (!recalls) { fail++; console.log(`❌ 창 밖 맥락 소실 — 답변에 매입가 180 기반 수익률 없음: "${reply.slice(0, 160)}"`); }
  else console.log(`✅ 창 밖(첫 턴) 매입 정보가 요약 경유로 답변에 유지됨: "${reply.slice(0, 80)}"`);
}

console.log(fail ? `\n❌ compact E2E FAIL ${fail}건` : '\n✅ compact E2E 전부 통과');
process.exitCode = fail ? 1 : 0;
