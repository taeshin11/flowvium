#!/usr/bin/env node
// scripts/sft/eval-chat-multiturn.mjs — 심판엔진 챗 *엄격* 멀티턴 테스트-eval + SFT 연료 수집 (2026-07-06)
//
// 사용자 "드라이브에 0.SFT_Flovium 폴더 만들어서 테스트-eval 엄격한 멀티턴으로 만들어서 테스트 해보고
// SFT 연료 모아". 라이브 /api/judge-chat 에 7개 멀티턴 시나리오를 돌려:
//   - 엄격 판정: chat-verify 15종 결함 *전부* FAIL (E2E 와 달리 verdict_mismatch 도 FAIL — SFT 연료는
//     심판 결론과 일치하는 답변만), 시나리오별 추가 assert(맥락승계·수치 정확도·날조 부재·오승계 방지).
//   - 산출: eval/<ts>.json (전 턴 판정 상세) + fuel/chat-sft-eval.jsonl (통과 턴 = positive 연료,
//     실패 턴 = rejected 연료 — 추후 DPO/오답분석용 라벨 포함).
// 시나리오: S1 승계+verdict 일관 · S2 compact+수익률 계산 정확도 · S3 장문 deep · S4 미존재 티커 정직성
//          · S5 추천목록 · S6 KR 종목(한자 0) · S8 시장 일반질문 오승계 방지.
// 사용: node scripts/sft/eval-chat-multiturn.mjs [--base=http://127.0.0.1:3000] [--out=G:/내 드라이브/0.SFT_Flovium]
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Redis from 'ioredis';
import { checkChatDefects } from '../lib/chat-verify.mjs';

const BASE = (process.argv.find(a => a.startsWith('--base=')) || '--base=http://127.0.0.1:3000').split('=')[1];
const OUT = (process.argv.find(a => a.startsWith('--out=')) || '--out=G:/내 드라이브/0.SFT_Flovium').split('=').slice(1).join('=');
mkdirSync(resolve(OUT, 'eval'), { recursive: true });
mkdirSync(resolve(OUT, 'fuel'), { recursive: true });
const RUN_TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const FUEL = resolve(OUT, 'fuel', 'chat-sft-eval.jsonl');

let cookie = '';
const ask = async (messages, { mode = 'aisvi', convId } = {}) => {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/judge-chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ messages, mode, locale: 'ko', ...(convId ? { convId } : {}) }),
    signal: AbortSignal.timeout(300000),
  });
  const setC = r.headers.get('set-cookie');
  if (setC && !cookie) cookie = setC.split(';')[0];
  if (!r.ok) throw new Error(`http ${r.status}`);
  return { ...(await r.json()), ms: Date.now() - t0 };
};

const results = [];
const record = (scenario, turn, q, a, messages, extraFails) => {
  // 엄격 판정 — 결정론 15종 전부(verdict_mismatch 포함) + 시나리오 assert
  const defects = checkChatDefects(q, String(a.reply ?? ''), a.grounding, 'ko');
  const fails = [...defects.map(d => `defect:${d.type}${d.detail ? `(${String(d.detail).slice(0, 40)})` : ''}`), ...extraFails];
  const pass = fails.length === 0;
  const row = {
    id: `eval-${RUN_TS}-${scenario}-t${turn}`, scenario, turn, ts: new Date().toISOString(),
    mode: a.mode, source: a.source, ms: a.ms, q: q.slice(0, 200), answerLen: String(a.reply ?? '').length,
    tickers: (a.grounding?.tickers ?? []).map(t => t.ticker), label: pass ? 'pass' : 'fail', fails,
  };
  results.push(row);
  // SFT 연료 — 대화 원문 포함(트레이너가 포맷 결정). pass=positive, fail=rejected(라벨·사유 포함).
  const fuel = { ...row, origin: 'eval', messages: [...messages, { role: 'assistant', content: String(a.reply ?? '') }], grounding: a.grounding ?? null };
  appendFileSync(FUEL, JSON.stringify(fuel) + '\n', 'utf8');
  console.log(`${pass ? '✅' : '❌'} [${scenario} 턴${turn}] ${(a.ms / 1000).toFixed(1)}s ${row.answerLen}자 ${row.tickers.join(',') || '-'}${fails.length ? ` | ${fails.join(' · ')}` : ''}`);
  return pass;
};
const hasTicker = (a, tk, needPrice = false) => (a.grounding?.tickers ?? []).some(t => String(t.ticker).toUpperCase().startsWith(tk) && (!needPrice || t.price != null));
const pctIn = (text) => Array.from(String(text).matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)).map(m => Number(m[1]));

// ── S1: 기본 멀티턴 — 승계 + verdict 일관(엄격: verdict_mismatch=FAIL) ─────────
{
  const q1 = 'NVDA 지금 사도 돼?';
  const a1 = await ask([{ role: 'user', content: q1 }]);
  record('S1', 1, q1, a1, [{ role: 'user', content: q1 }], hasTicker(a1, 'NVDA', true) ? [] : ['assert:NVDA 가격 grounding 없음']);
  const q2 = '그럼 지금은 팔아야 돼?';
  const m2 = [{ role: 'user', content: q1 }, { role: 'assistant', content: String(a1.reply ?? '').slice(0, 800) }, { role: 'user', content: q2 }];
  const a2 = await ask(m2);
  record('S1', 2, q2, a2, m2, hasTicker(a2, 'NVDA') ? [] : ['assert:승계 실패(NVDA 없음)']);
}
// ── S2: compact + 수익률 계산 *정확도* (창 밖 매입가 소환 → ±0.6%p) ─────────────
{
  const hist = [
    { role: 'user', content: '나 3주 전에 NVDA를 주당 180달러에 20주 매수했어. 지금 어때?' },
    { role: 'assistant', content: 'NVDA 20주를 180달러에 매수하셨군요. 현재 추세는 유효하니 보유 관점이 좋아 보입니다.' },
    { role: 'user', content: '요즘 시장 변동성은 어때?' }, { role: 'assistant', content: 'VIX 는 낮은 수준으로 변동성 축소 국면입니다.' },
    { role: 'user', content: '반도체 업황 전반은 어떻게 봐?' }, { role: 'assistant', content: 'AI 인프라 수요로 반도체 업황은 확장 국면입니다.' },
    { role: 'user', content: '금리는 언제 내릴 것 같아?' }, { role: 'assistant', content: '차기 FOMC 에서 동결 확률이 우세합니다.' },
    { role: 'user', content: '환율 영향은 어때?' }, { role: 'assistant', content: '원화 약세는 수출주에 우호적입니다.' },
  ];
  const q1 = '오늘 코스피 분위기는 어때?';
  const a1 = await ask([...hist, { role: 'user', content: q1 }]);
  const convId = a1.convId;
  // 백그라운드 compact 요약 대기(최대 90s)
  const r = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 2 });
  let summary = null;
  try {
    const idx = (await r.lrange('flowvium:judge-chat:index', 0, 5)).map(x => JSON.parse(x)).find(e => e.key?.endsWith(`:${convId}`));
    if (idx?.key) for (let i = 0; i < 18 && !summary; i++) { summary = JSON.parse(await r.get(idx.key) ?? '{}').summary ?? null; if (!summary) await new Promise(res => setTimeout(res, 5000)); }
  } finally { r.disconnect(); }
  const q2 = '아까 내가 산 단가와 수량 기준으로 지금 수익률이 어느 정도야?';
  const m2 = [...hist, { role: 'user', content: q1 }, { role: 'assistant', content: String(a1.reply ?? '').slice(0, 500) }, { role: 'user', content: q2 }];
  const a2 = await ask(m2, { convId });
  const P = (a2.grounding?.tickers ?? []).find(t => t.price != null)?.price;
  const expect = P ? (P / 180 - 1) * 100 : null;
  const fails = [];
  if (!summary) fails.push('assert:compact 요약 미생성(90s)');
  if (!hasTicker(a2, 'NVDA', true)) fails.push('assert:창밖 종목 승계 실패');
  if (expect != null && !pctIn(a2.reply).some(v => Math.abs(v - expect) <= 0.6)) fails.push(`assert:수익률 부정확(기대 ${expect.toFixed(1)}% vs 답변 ${pctIn(a2.reply).join(',') || '없음'})`);
  record('S2', 2, q2, a2, m2, fails);
}
// ── S3: 장문 deep — 종목이 문장 중간에 묻힌 735자 질문, 심층 분량·결함 0 ─────────
{
  const q = '요즘 포트폴리오 리밸런싱을 고민하고 있는데, 반도체 섹터 비중을 어떻게 가져갈지 판단이 서지 않습니다. 미국 금리가 여전히 높은 수준이고 연준의 추가 인하 시점도 불확실한 상황에서, 성장주 밸류에이션 부담이 크다는 지적이 많잖아요. 그런 관점에서 NVDA 를 지금 시점에 신규로 담는 게 맞는지 궁금합니다. 데이터센터 수요는 여전히 강하다고 하지만 이미 주가에 상당 부분 반영됐다는 반론도 있고, 경쟁사들의 추격과 고객사들의 자체 칩 개발 움직임도 신경 쓰입니다. 재무 지표와 기술적 위치, 그리고 수급까지 종합해서 진입 여부와 만약 진입한다면 분할 매수 전략을 어떻게 가져가야 할지 구체적으로 알려주세요.';
  const a = await ask([{ role: 'user', content: q }], { mode: 'aisvi-deep' });
  const fails = [];
  if (!hasTicker(a, 'NVDA', true)) fails.push('assert:장문 속 종목 인식 실패');
  if (String(a.reply ?? '').length < 600) fails.push(`assert:심층 분량 부족(${String(a.reply ?? '').length}자)`);
  record('S3', 1, q, a, [{ role: 'user', content: q }], fails);
}
// ── S4: 미존재 티커 정직성 — 데이터 없음 disclose, 가격/점수 날조 금지 ───────────
{
  const q = 'QZZX 어때? 지금 사도 돼?';
  const a = await ask([{ role: 'user', content: q }]);
  const reply = String(a.reply ?? '');
  const fails = [];
  const priced = (a.grounding?.tickers ?? []).filter(t => t.price != null);
  if (priced.length) fails.push(`assert:미존재 티커에 가격 grounding(${priced.map(t => t.ticker).join(',')}) — 유사치환 의심`);
  const fabricated = /\$\s?\d{2,}|\d{2,3}(?:,\d{3})+\s*(달러|원)|RSI\s*\d/.test(reply);
  const disclosed = /(데이터|정보|종목).{0,14}(없|찾지 못|확인되지 않|불러오지 못)/.test(reply);
  if (fabricated && !disclosed) fails.push('assert:데이터 없는 종목에 수치 제시(날조 의심)');
  record('S4', 1, q, a, [{ role: 'user', content: q }], fails);
}
// ── S5: 추천목록 — 리포트 포트폴리오 기반, 엔진점수 날조 금지 ─────────────────────
{
  const q = '오늘 매수할 만한 종목 추천해줘';
  const a = await ask([{ role: 'user', content: q }]);
  const fails = String(a.reply ?? '').length < 150 ? ['assert:추천 답변 빈약(<150자)'] : [];
  record('S5', 1, q, a, [{ role: 'user', content: q }], fails);
}
// ── S6: KR 종목 — 한글 종목명 해석 + 한자 0 (checkChatDefects 가 hanja_leak 검출) ──
{
  const q = '삼성전자 지금 사도 돼?';
  const a = await ask([{ role: 'user', content: q }]);
  const fails = hasTicker(a, '005930', true) || (a.grounding?.tickers ?? []).some(t => /\.(KS|KQ)$/.test(t.ticker) && t.price != null) ? [] : ['assert:KR 종목 해석 실패'];
  record('S6', 1, q, a, [{ role: 'user', content: q }], fails);
}
// ── S8: 시장 일반질문 오승계 방지 — 직전 턴 종목이 시장질문에 달라붙으면 안 됨 ─────
{
  const q1 = 'NVDA 손절 라인은 어디가 좋아?';
  const a1 = await ask([{ role: 'user', content: q1 }]);
  const q2 = '요즘 시장 전반 분위기는 어때?';
  const m2 = [{ role: 'user', content: q1 }, { role: 'assistant', content: String(a1.reply ?? '').slice(0, 500) }, { role: 'user', content: q2 }];
  const a2 = await ask(m2);
  const fails = (a2.grounding?.tickers ?? []).length ? [`assert:시장 일반질문에 종목 오승계(${a2.grounding.tickers.map(t => t.ticker).join(',')})`] : [];
  record('S8', 2, q2, a2, m2, fails);
}

// ── 요약 + 산출 ────────────────────────────────────────────────────────────────
const passN = results.filter(r => r.label === 'pass').length;
const summary = { runTs: RUN_TS, base: BASE, total: results.length, pass: passN, fail: results.length - passN, passRate: +(passN / results.length * 100).toFixed(1), results };
writeFileSync(resolve(OUT, 'eval', `eval-${RUN_TS}.json`), JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n=== 엄격 멀티턴 eval: ${passN}/${results.length} pass (${summary.passRate}%) ===`);
console.log(`eval → ${resolve(OUT, 'eval', `eval-${RUN_TS}.json`)}`);
console.log(`fuel → ${FUEL} (+${results.length}건: pass=${passN} positive, fail=${results.length - passN} rejected)`);
process.exitCode = passN === results.length ? 0 : 1;
