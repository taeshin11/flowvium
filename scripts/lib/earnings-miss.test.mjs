#!/usr/bin/env node
/**
 * earnings-miss.test.mjs — detectPeakDumpRisk 의 '펀더멘탈 악화' 신호를 실측에 접지한다.
 *
 * 배경(2026-08-21 전수조사): generate-report-local.mjs:2035
 *     const financialsRaw = ctxRaw?.companyFinancials;
 *   ctxRaw 에 그런 키가 없다(gatherContext 반환 26종에 미포함, 사후 대입도 없음).
 *   → getFinancialsText() 가 항상 "" → :2097 "가이던스 하향/어닝미스" 신호가 한 번도 발화하지 않았다.
 *
 *   배선만 고쳐도 안 된다. 실제 데이터인 getCompanyFinancials 는
 *     "NVDA: Q1 FY2027 $81.6B +85.2% YoY opMgn=60.4% ROE=76.3% PE=44.6"
 *   같은 순수 수치 문자열만 만든다 — FUND_NEG_KW(/guidance lowered|miss|가이던스 하향/) 가
 *   매칭될 수 있는 문장이 애초에 없다. 배선 오류와 대상 데이터 부재, 두 겹이었다.
 *
 *   의도("어닝미스")를 실측으로 살린다: getRawEarnings 의 epsSurprise 가 음수면 컨센서스 하회다.
 *   임계값을 새로 만들지 않는다 — '하회'는 부호로 정의되는 표준 개념이고,
 *   크기는 라벨에 실어 독자가 판단하게 한다.
 *   가이던스는 결정론적 소스가 없다. companyChanges[].guidance 는 LLM 산출이라
 *   리스크 신호의 입력으로 쓰지 않는다(스퀴즈 점수에서 방금 고친 것과 같은 이유).
 */
import { earningsMissSignal } from './earnings-miss.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const TODAY = new Date('2026-08-21T00:00:00Z');
const ROWS = [
  { ticker: 'AMD',  date: '2026-08-19', epsActual: 0.9, epsSurprise: -3.1 },
  { ticker: 'NVDA', date: '2026-08-20', epsActual: 1.2, epsSurprise: 5.2 },
  { ticker: 'INTC', date: '2026-08-02', epsActual: 0.1, epsSurprise: -12.0 },  // 창 밖(19일 전)
  { ticker: 'MU',   date: '2026-08-20', epsActual: 0.5, epsSurprise: null },   // 서프라이즈 미상
  { ticker: 'XYZ',  date: '2026-08-25', epsActual: null, epsSurprise: -8.0 },  // 미래(발표 전 추정치)
];

// ① 컨센서스 하회 검출 + 크기 노출
{
  const r = earningsMissSignal('AMD', ROWS, { today: TODAY });
  r && r.miss === true ? ok('AMD 하회 검출') : bad(`AMD 미검출: ${JSON.stringify(r)}`);
  r && r.surprisePct === -3.1 ? ok('하회 폭 노출(-3.1%)') : bad(`하회 폭 없음: ${JSON.stringify(r)}`);
  r && r.date === '2026-08-19' ? ok('발표일 노출') : bad('발표일 없음');
}
// ①-b 경계: 정확히 windowDays 일 전 발표는 포함해야 한다.
//     실측에서 걸린 실제 버그 — 음수 서프라이즈 34건이 전부 2026-08-14(7일 전)였는데,
//     창을 '현재시각 − 7일'로 잡아 날짜만 있는 값(T00:00Z)이 간발로 밖에 놓여 한 건도 안 잡혔다.
//     '7일'은 달력 일수여야 한다. 시각 대 날짜를 비교하면 하루가 통째로 사라진다.
{
  const rows = [{ ticker: 'BND', date: '2026-08-14', epsActual: 0.2, epsSurprise: -48.5 }];
  const noonToday = new Date('2026-08-21T15:30:00Z');   // 시각이 늦은 시점에서도
  const r = earningsMissSignal('BND', rows, { today: noonToday });
  r?.miss === true ? ok('경계: 정확히 7일 전 발표 포함') : bad(`경계 누락: ${JSON.stringify(r)}`);
}

// ② 상회는 신호 아님
earningsMissSignal('NVDA', ROWS, { today: TODAY }) === null ? ok('NVDA 상회 → 신호 없음') : bad('상회를 신호로 봄');
// ③ 창 밖은 제외 — 오래된 실적을 '지금의 리스크'로 쓰지 않는다
earningsMissSignal('INTC', ROWS, { today: TODAY }) === null ? ok('19일 전 실적은 제외(창 7일)') : bad('창 밖 실적을 사용');
// ④ 서프라이즈 미상은 신호 아님 — 모르는 걸 나쁘다고 하지 않는다
earningsMissSignal('MU', ROWS, { today: TODAY }) === null ? ok('epsSurprise null → 신호 없음') : bad('null 을 하회로 봄');
// ⑤ 아직 발표 전(미래일)은 실적이 아니다
earningsMissSignal('XYZ', ROWS, { today: TODAY }) === null ? ok('미래 발표일 제외') : bad('미래 실적을 사용');
// ⑥ 티커 대소문자·접미사
earningsMissSignal('amd', ROWS, { today: TODAY })?.miss === true ? ok('소문자 티커 매칭') : bad('소문자 미매칭');
// ⑦ 입력 방어
earningsMissSignal('AMD', null, { today: TODAY }) === null ? ok('데이터 없음 안전') : bad('데이터 null 처리 이상');
earningsMissSignal('', ROWS, { today: TODAY }) === null ? ok('빈 티커 안전') : bad('빈 티커 처리 이상');

// ⑧ 생성 코드가 죽은 읽기를 버리고 실측 경로를 탄다
{
  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const gen = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
  /ctxRaw\?\.companyFinancials/.test(gen)
    ? bad('여전히 ctxRaw.companyFinancials(존재하지 않는 키)를 읽는다')
    : ok('죽은 읽기 제거됨');
  /earningsMissSignal\(/.test(gen)
    ? ok('생성 코드가 earningsMissSignal 을 쓴다')
    : bad('실측 접지 경로 미배선');
}

// ── 2026-08-21 2차: epsSurprise 는 못 믿을 파생값이다 ───────────────────────────
// 실측(/api/earnings 431행): |surprise|>100 인 행이 16건. 원인은 컨센서스가 0 근처라 퍼센트가 발산하는 것이고,
// 상류가 ±999 로 잘라낸다:
//   LNZA 실적 -2.04 / 컨센 -0.0944 → surprise -999   (잘린 센티널)
//   SIND 실적 -0.13 / 컨센 -0.0306 → surprise -324.8
//   DCGO 실적 +0.16 / 컨센 -0.0632 → surprise +353.2 (실제로는 상회)
// 이 값을 라벨에 그대로 실으면 "어닝미스 -999.0%" 가 발간된다.
// 임계값을 새로 만들 게 아니라 원본으로 판정한다 — '하회'는 epsActual < epsEstimate 다.
// 퍼센트는 발간하지 않는다. 파생값이 불안정하면 원본을 보여주는 게 맞다.
{
  const rows = [
    { ticker: 'LNZA', date: '2026-08-18', epsActual: -2.04, epsEstimate: -0.0944, epsSurprise: -999 },
    { ticker: 'DCGO', date: '2026-08-18', epsActual: 0.16,  epsEstimate: -0.0632, epsSurprise: 353.2 },
    { ticker: 'EVEN', date: '2026-08-18', epsActual: 0.10,  epsEstimate: 0.10,    epsSurprise: 0 },
    { ticker: 'ONLYS',date: '2026-08-18', epsActual: null,  epsEstimate: null,    epsSurprise: -4.2 },
  ];
  const today = new Date('2026-08-21T09:00:00Z');
  const a = earningsMissSignal('LNZA', rows, { today });
  a?.miss === true ? ok('원본 비교로 하회 판정(LNZA)') : bad(`LNZA 미검출: ${JSON.stringify(a)}`);
  (a && a.epsActual === -2.04 && a.epsEstimate === -0.0944) ? ok('실적/컨센서스 원본 노출') : bad(`원본 미노출: ${JSON.stringify(a)}`);
  a && a.surprisePct === undefined ? ok('발산하는 퍼센트는 싣지 않는다') : bad(`불안정한 퍼센트를 노출: ${JSON.stringify(a)}`);

  // 컨센서스가 음수여도 실적이 더 높으면 상회다 — 퍼센트 부호에 기대지 않는다
  earningsMissSignal('DCGO', rows, { today }) === null ? ok('음수 컨센 대비 상회는 신호 아님') : bad('상회를 하회로 봄');
  // 동일하면 하회가 아니다
  earningsMissSignal('EVEN', rows, { today }) === null ? ok('컨센서스와 동일 → 신호 아님') : bad('동일값을 하회로 봄');
  // 원본이 없으면 surprise 로 폴백한다 (정보를 버리지 않는다)
  const d = earningsMissSignal('ONLYS', rows, { today });
  d?.miss === true && d.surprisePct === -4.2 ? ok('원본 없으면 surprise 폴백 + 퍼센트 노출') : bad(`폴백 실패: ${JSON.stringify(d)}`);
}

// 부동소수 잡음이 발간되면 안 된다 — 실측: RLX epsActual = 0.20227199999999998
// 값을 바꾸는 게 아니라 표시 정밀도만 정한다(유효 4자리). 반올림으로 의미가 바뀌는 자리는 없다.
{
  const rows = [{ ticker: 'RLX', date: '2026-08-18', epsActual: 0.20227199999999998, epsEstimate: 0.6363, epsSurprise: -68 }];
  const r = earningsMissSignal('RLX', rows, { today: new Date('2026-08-21T09:00:00Z') });
  r?.epsActual === 0.2023 ? ok('부동소수 잡음 제거(0.2023)') : bad(`정밀도 미정리: ${r?.epsActual}`);
  r?.epsEstimate === 0.6363 ? ok('원래 정밀도는 보존') : bad(`컨센 값 훼손: ${r?.epsEstimate}`);
}
{
  const rows = [{ ticker: 'X', date: '2026-08-18', epsActual: -11.934, epsEstimate: -1.5, epsSurprise: -1 }];
  const r = earningsMissSignal('X', rows, { today: new Date('2026-08-21T09:00:00Z') });
  r?.epsActual === -11.934 ? ok('4자리 이내 값은 그대로') : bad(`불필요한 반올림: ${r?.epsActual}`);
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
