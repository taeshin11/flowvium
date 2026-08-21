#!/usr/bin/env node
/**
 * squeeze-reconcile.test.mjs — 발간되는 스퀴즈 점수가 실측값과 일치하는지.
 *
 * 배경(2026-08-21, 사용자 질문 "모더나가 숏스퀴즈 후보인건 맞게 판단한거지?"):
 *   morning 보고서 shortSqueeze[0] = {ticker:'MRNA', score:43}
 *   그런데 /api/short-interest 실측은 MRNA squeezeScore=55 다.
 *     shortFloatPct 15.2(>10 → +20) · shortVolPct 57.6(>55 → +15) · instAction accumulating(+20) = 55
 *   종목 선택은 맞다(33종 중 COIN 과 공동 1위). 점수 43은 LLM 이 지어낸 숫자다.
 *   더구나 topOpportunity 가 "MRNA의 43점 스퀴즈 점수와 …" 라며 그 숫자를 근거로 삼는다.
 *
 *   왜 안 걸렸나 — 두 겹이다:
 *   (a) generate-report-local.mjs:6280 프롬프트가 score 를 LLM 에게 쓰게 한다.
 *   (b) enrichSqueezePostEarnings 는 timing 만료일·실적반응만 보고 ticker/score 를 실측과 대조하지 않는다.
 *   (c) :6883 squeezeMap 이 `ctxRaw?.shorts`(복수)를 읽는데 원본 키는 :3815 `short:`(단수)다 →
 *       맵이 영구히 비어 :5379 squeezeScore 가 항상 null → 후보 점수 룰이 침묵 미발화.
 *
 *   발간물에 숫자를 지어내면 안 된다. 실측이 있으면 실측으로 덮고, 실측에 없는 티커는 확인 불가라 뺀다.
 */
import { reconcileSqueeze, correctScoreMentions } from './squeeze-reconcile.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const eq = (g, w, m) => (JSON.stringify(g) === JSON.stringify(w) ? ok(m) : (console.log(`  FAIL  ${m}\n          got ${JSON.stringify(g)}\n          want ${JSON.stringify(w)}`), fail++));

// 실측 payload (2026-08-21 /api/short-interest 관측값)
const REAL = { entries: [
  { ticker: 'COIN', squeezeScore: 55, shortFloatPct: 12.0, shortVolPct: 61.0, instAction: 'accumulating' },
  { ticker: 'MRNA', squeezeScore: 55, shortFloatPct: 15.2, shortVolPct: 57.6, shortRatio: 7.21, shortChangeMonthly: -5, instAction: 'accumulating' },
  { ticker: 'ARM',  squeezeScore: 45 },
]};

// ① LLM 이 쓴 점수를 실측으로 덮는다
{
  const { entries, fixes } = reconcileSqueeze([{ ticker: 'MRNA', score: 43, timing: 't', risk: 'r' }], REAL);
  eq(entries.map(e => [e.ticker, e.score]), [['MRNA', 55]], 'LLM 43 → 실측 55 로 교정');
  fixes.some(f => f.includes('MRNA') && f.includes('43') && f.includes('55')) ? ok('교정 내역 기록') : bad(`교정 내역 없음: ${JSON.stringify(fixes)}`);
}

// ② 실측에 없는 티커는 확인 불가 — 지어낸 근거를 발간하지 않는다
{
  const { entries, fixes } = reconcileSqueeze([{ ticker: 'ZZZZ', score: 80 }, { ticker: 'ARM', score: 10 }], REAL);
  eq(entries.map(e => e.ticker), ['ARM'], '실측에 없는 티커 제거');
  eq(entries[0].score, 45, '남은 티커는 실측 점수');
  fixes.some(f => f.includes('ZZZZ')) ? ok('제거 사유 기록') : bad('제거를 조용히 처리함');
}

// ③ 점수가 이미 맞으면 건드리지 않는다 (불필요한 교정 기록 금지)
{
  const { entries, fixes } = reconcileSqueeze([{ ticker: 'ARM', score: 45 }], REAL);
  eq(entries[0].score, 45, '일치하면 유지');
  eq(fixes.length, 0, '일치 시 교정 기록 없음');
}

// ④ 실측 근거를 함께 실어 준다 — 화면이 "43점"만 보여주고 끝나면 검증이 불가능하다
{
  const { entries } = reconcileSqueeze([{ ticker: 'MRNA', score: 43 }], REAL);
  const e = entries[0];
  (e.shortFloatPct === 15.2 && e.shortVolPct === 57.6 && e.shortRatio === 7.21)
    ? ok('실측 근거(공매도비중·거래비중·상환일수) 부착')
    : bad(`근거 미부착: ${JSON.stringify(e)}`);
}

// ⑤ 실측 소스가 비면 — 지어낸 값으로 발간하느니 섹션을 비운다.
//    저장소는 이미 빈 shortSqueeze 를 비차단으로 다룬다(generate-report-local.mjs:851-855).
{
  const { entries, fixes } = reconcileSqueeze([{ ticker: 'MRNA', score: 43 }], { entries: [] });
  eq(entries, [], '실측 없음 → 빈 배열');
  fixes.some(f => f.includes('실측 없음')) ? ok('소스 부재를 기록') : bad('소스 부재를 침묵 처리');
}

// ⑥ 입력 방어
eq(reconcileSqueeze(null, REAL).entries, [], 'null 입력 안전');
eq(reconcileSqueeze([{ ticker: 'MRNA', score: 43 }], null).entries, [], '실측 null 이면 빈 배열');

// ⑦ 원본 컨텍스트 키 오타 — squeezeMap 이 영구히 비어 있었다
{
  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const gen = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
  /squeezeMap:\s*new Map\(\(ctxRaw\?\.shorts\b/.test(gen)
    ? bad('squeezeMap 이 ctxRaw.shorts(복수)를 읽는다 — 원본 키는 short(단수)라 항상 빈 맵')
    : ok('squeezeMap 이 올바른 원본 키를 읽는다');
  /reconcileSqueeze\(/.test(gen)
    ? ok('생성 파이프라인이 reconcileSqueeze 를 호출한다')
    : bad('생성 파이프라인이 실측 대조를 하지 않는다');
}

// ⑧ 산문 교정 — topOpportunity 가 "MRNA의 43점 스퀴즈 점수와 …" 라며 옛 숫자를 인용한다.
//    항목만 55 로 고치고 산문을 두면 같은 화면에서 43과 55가 충돌한다.
{
  const real = '실측 문장: MRNA의 43점 스퀴즈 점수와 바이오 섹터의 탐욕 지수(72) 결합으로 단기 급등 가능성 높으나';
  const r = correctScoreMentions(real, [{ ticker: 'MRNA', from: 43, to: 55 }]);
  r.text.includes('55점') && !r.text.includes('43점') ? ok('산문 43점 → 55점') : bad(`산문 미교정: ${r.text}`);
  r.text.includes('(72)') ? ok('무관한 숫자(탐욕지수 72) 보존') : bad('무관한 숫자를 건드림');
}
// 다른 티커 얘기면 건드리지 않는다
{
  const r = correctScoreMentions('AMD의 43점 신호', [{ ticker: 'MRNA', from: 43, to: 55 }]);
  r.text === 'AMD의 43점 신호' ? ok('다른 티커 문장은 불변') : bad('무관한 문장을 수정함');
}
// 숫자를 못 찾으면 조용히 넘어가지 않고 알린다
{
  const r = correctScoreMentions('MRNA 스퀴즈 주목', [{ ticker: 'MRNA', from: 43, to: 55 }]);
  r.unresolved.length === 1 ? ok('미해결을 보고한다') : bad('미해결을 침묵 처리');
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
