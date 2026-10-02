#!/usr/bin/env node
/**
 * volume-absorption.test.mjs — 전향 연구 후보 룰 "거래량은 터졌는데 주가는 안 올랐다"(매집 가설). 2026-10-01 신설.
 *
 * 사장님이 준 쇼츠(수익탐정사무소 QtG0BNW0Wn4, 9/30, 80만 뷰)의 주장: 최근 한 달 평소보다 거래량 3배 이상 터진 종목 중
 *   주가가 3%도 안 오른 것 = 누군가 같은 가격에서 물량을 받아내는 중(세력·기관 매집). 사장님 "ㅇㅋ" → shadow 로 전향 검증.
 * 주장의 출처(데이비드 시겔 '112조'·'별세 전 인터뷰')는 과장으로 보인다 — 규칙 자체만 재 본다. live 채점에는 안 들어간다.
 * 정의(코드로 못박는다):
 *   volSpike20 = 최근 20거래일 중 가장 큰 하루 거래량 ÷ 그 앞 60거래일 평균 거래량
 *   ret20      = 최근 20거래일 수익률(%)
 *   as-stated: volSpike20 ≥ 3 · ret20 < 3        flat(같은 가격에서 받아냄): 위 + ret20 > -3 (폭락하며 쏟아진 건 매집이 아니다)
 */
import { volumeAbsorptionSignals } from '../../src/lib/buy-sell-engine.mjs';
import { evaluateBuyRule } from '../../src/lib/buy-sell-engine.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const base = Array.from({ length: 80 }, () => 1000);
const flatCloses = Array.from({ length: 100 }, () => 100);
{
  const vols = [...base, ...Array.from({ length: 20 }, (_, i) => (i === 7 ? 3500 : 1000))];
  const s = volumeAbsorptionSignals(flatCloses, vols);
  (Math.abs(s.volSpike20 - 3.5) < 0.01 && Math.abs(s.ret20) < 0.01) ? ok(`[1] 스파이크 ${s.volSpike20}배 · 20일 ${s.ret20}%`) : bad(`[1] ${JSON.stringify(s)}`);
  const closes = [...Array.from({ length: 79 }, () => 100), ...Array.from({ length: 21 }, (_, i) => 100 + i * 0.5)];
  const s2 = volumeAbsorptionSignals(closes, vols);
  (Math.abs(s2.ret20 - 10) < 0.01) ? ok(`[1b] 20일 수익률 ${s2.ret20}%`) : bad(`[1b] ${JSON.stringify(s2)}`);
  (volumeAbsorptionSignals(flatCloses.slice(0, 50), vols.slice(0, 50)).volSpike20 === null) ? ok('[1c] 80일 미만이면 null(모르면 발화 안 함)') : bad('[1c]');
}
{
  const stated = { id: 'x', condition: { type: 'volumeAbsorption', spike_gte: 3, ret_lt: 3 } };
  const flat = { id: 'y', condition: { type: 'volumeAbsorption', spike_gte: 3, ret_lt: 3, ret_gt: -3 } };
  const hit = { volSpike20: 3.4, ret20: 1.2 }, rose = { volSpike20: 4, ret20: 8 }, crash = { volSpike20: 5, ret20: -20 }, noSpike = { volSpike20: 2, ret20: 0 }, unk = { volSpike20: null, ret20: 0 };
  const r = [evaluateBuyRule(stated, hit), evaluateBuyRule(stated, rose), evaluateBuyRule(stated, crash), evaluateBuyRule(stated, noSpike), evaluateBuyRule(stated, unk),
    evaluateBuyRule(flat, hit), evaluateBuyRule(flat, crash)];
  (r[0] && !r[1] && r[2] && !r[3] && !r[4] && r[5] && !r[6])
    ? ok(`[2] 발화: 매집형 O · 오름 X · 폭락(그대로판 O / 보합판 X) · 스파이크 없음 X · 모름 X — "${r[0]}"`) : bad(`[2] ${JSON.stringify(r)}`);
}
// [3] 10/2 실측: 신호 계산을 **매도 신호 함수(fetchSellSignals)** 에 넣었다(같은 줄이 두 함수에 있어 첫 것에 붙었다).
//   매수 후보에는 필드가 안 채워져 BA(3.17배·-10%)·TRGP·196170 가 조건을 만족했는데 발화 0건. stage2-ctx 테스트는
//   '선언' 만 봐서 통과했다 — 여기서는 **매수 신호 함수 본문이 실제로 채우는지** 본다.
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8');
  const body = (name) => { const i = src.indexOf(`async function ${name}(`); const j = src.indexOf('\nasync function ', i + 10); return i < 0 ? '' : src.slice(i, j < 0 ? undefined : j); };
  (/volumeAbsorptionSignals\(/.test(body('fetchBuyTechSignals')) && !/volumeAbsorptionSignals\(/.test(body('fetchSellSignals')))
    ? ok('[3] 매수 신호 함수가 volSpike20·ret20 을 채운다(매도 쪽 아님)') : bad('[3] volumeAbsorptionSignals 가 매수 신호 함수 본문에 없다');
}
// [4] 10/2 사장님 공유 쇼츠 2(머니파워 4N5A1nltBjw): "거래량 3배 이상 터진 뒤 **가격이 다시 눌리지 않고 버티면** 산다".
//   위 매집형(안 오름)과 다른 가설이다 — 터진 날 종가 아래로 밀리지 않는가를 본다. 영상 인물은 설명란에 '가상 인물' 로 적혀 있다.
//   holdSinceSpike = 터진 다음 날부터 오늘까지 가장 낮은 종가 ÷ 터진 날 종가 - 1 (%),  daysSinceSpike = 터진 뒤 지난 거래일 수
{
  const vols = [...base, ...Array.from({ length: 20 }, (_, i) => (i === 10 ? 4000 : 1000))];   // 끝에서 10번째 날 4배
  const held = [...Array.from({ length: 90 }, () => 100), ...Array.from({ length: 10 }, (_, i) => 101 + i * 0.2)];   // 터진 날 100 → 이후 101~
  const s = volumeAbsorptionSignals(held, vols);
  (s.daysSinceSpike === 9 && s.holdSinceSpike >= 0) ? ok(`[4a] 터진 뒤 ${s.daysSinceSpike}일 · 최저 ${s.holdSinceSpike}%`) : bad(`[4a] ${JSON.stringify(s)}`);
  const pushed = [...Array.from({ length: 90 }, () => 100), ...Array.from({ length: 10 }, (_, i) => (i === 4 ? 90 : 100))];
  const s2 = volumeAbsorptionSignals(pushed, vols);
  (Math.abs(s2.holdSinceSpike + 10) < 0.01) ? ok(`[4b] 중간에 -10% 밀림 → ${s2.holdSinceSpike}%`) : bad(`[4b] ${JSON.stringify(s2)}`);
  const rule = { id: 'z', condition: { type: 'volumeSpikeHold', spike_gte: 3, hold_gte: -3, days_gte: 2 } };
  const r = [evaluateBuyRule(rule, s), evaluateBuyRule(rule, s2), evaluateBuyRule(rule, { ...s, daysSinceSpike: 0 }), evaluateBuyRule(rule, { ...s, volSpike20: 2 }), evaluateBuyRule(rule, { volSpike20: 4, holdSinceSpike: null, daysSinceSpike: 5 })];
  (r[0] && !r[1] && !r[2] && !r[3] && !r[4]) ? ok(`[4c] 버팀 O · 밀림 X · 오늘 터짐 X · 스파이크 없음 X · 모름 X — "${r[0]}"`) : bad(`[4c] ${JSON.stringify(r)}`);
  const { readFileSync } = await import('fs');
  const sr = JSON.parse(readFileSync(new URL('../../data/shadow-rules.json', import.meta.url), 'utf8')).rules;
  sr.some((x) => x.condition?.type === 'volumeSpikeHold' && x.side === 'buy') ? ok('[4d] 전향 룰 등록') : bad('[4d] shadow-rules.json 에 없다');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
