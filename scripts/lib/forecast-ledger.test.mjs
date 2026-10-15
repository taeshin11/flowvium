#!/usr/bin/env node
/**
 * forecast-ledger.test.mjs — 전향적 예측 장부(scripts/forecast-record.mjs · forecast-score.mjs)의 계산. 2026-10-15 신설.
 *
 * 왜(사장님 10/15 "전향적연구하라 … 왜 오늘같은 일을 예측못했는지"):
 *   10/15 KOSPI -8.0%·KOSDAQ -8.2%(SK하이닉스 -11.4%·삼성전자 -9.7%). 그날 08:44 아침판은 KR 판정 'accumulate'
 *   (분할 매수 관찰)·조기경보 low(8점)였다. 전날 밤 SOX -4.3%·NVDA -3.2% 를 본문에 적어 놓고도 판정에 안 넣었다
 *   — 조기경보의 가격 입력은 미국·EM·유럽 주식 1주 수익률뿐이고, KR 판정은 '낙폭 과대 + 경보 낮음 → 매수 관찰' 이었다.
 *   사후에 고치면 그날에 맞춘 땜질이 된다. 그래서 먼저 **장 전에 예측을 고정 기록하고 장 뒤 채점**해 쌓는다.
 *   어느 신호가 실제로 맞히는지는 그 기록이 말한다.
 * 지켜야 할 것:
 *   - 확률은 과거 데이터에서 센 것만(손으로 정한 숫자 금지). 표본이 적은 칸(minN 미만)은 전체 기본값으로.
 *   - 보고서는 확률을 내지 않는다 — 방향(bullish/bearish)만 채점하고, 중립은 '기권' 으로 따로 센다(적중률 분모에 안 넣음).
 *   - 채점은 기록 뒤에만, 같은 줄을 두 번 채점하지 않는다. 기록 줄은 고치지 않는다(채점은 별도 필드).
 *   - Brier 는 '내림 확률' 기준. 기본값(기후값) 대비 개선(skill)을 같이 낸다 — 기본값보다 못하면 신호가 아니다.
 */
import { bucketOf, condProb, reportCall, scoreRecord, aggregate, missType, coverage } from './forecast-ledger.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// ── 조건부 확률: 전날 밤 SOX 등락 칸별 다음 날 KOSPI 하락·-2% 이하 비율
{
  bucketOf(-0.043) === 'le-4' && bucketOf(-0.03) === '-4to-2' && bucketOf(0.001) === '0to2' ? ok('[1] 칸 나누기(-4%·-2%·0·+2%)') : bad(`[1] ${bucketOf(-0.043)} ${bucketOf(-0.03)} ${bucketOf(0.001)}`);
  const pairs = [
    ...Array.from({ length: 8 }, () => ({ x: -0.05, y: -0.03 })),   // SOX ≤-4%: 8번 모두 하락, 그중 8번 ≤-2%
    ...Array.from({ length: 2 }, () => ({ x: -0.05, y: 0.01 })),
    ...Array.from({ length: 50 }, (_, i) => ({ x: 0.01, y: i % 2 ? 0.005 : -0.005 })),
  ];
  const p = condProb(pairs, -0.06, { minN: 5 });
  near(p.pDown, 0.8) && near(p.pBigDown, 0.8) && p.n === 10 && p.bucket === 'le-4' ? ok('[2] SOX -6% → 그 칸 10건 중 하락 8 → 0.8') : bad(`[2] ${JSON.stringify(p)}`);
  const q = condProb(pairs, -0.06, { minN: 20 });
  q.bucket === 'all' && q.n === 60 ? ok('[3] 칸 표본이 minN 미만이면 전체로') : bad(`[3] ${JSON.stringify(q)}`);
  condProb(pairs, null).bucket === 'all' ? ok('[4] 입력이 없으면(SOX 결측) 전체 기본값') : bad('[4]');
}
// ── 보고서 방향
{
  const rep = { regionStances: { korea: { stance: 'bearish' }, us: { stance: 'neutral' } }, marketVerdict: { verdict: 'neutral', krVerdict: { verdict: 'accumulate' } } };
  const kr = reportCall(rep, 'kr');
  kr.dir === 'down' && kr.verdict === 'accumulate' ? ok('[5] KR: 지역 판단 bearish → down, 판정 accumulate 는 따로 남긴다') : bad(`[5] ${JSON.stringify(kr)}`);
  reportCall(rep, 'us').dir === null ? ok('[6] neutral → 기권(null)') : bad('[6]');
  // [6b] 10/15 에 틀린 건 지역판단이 아니라 판정·조기경보였다(agy Opus 5.5 검토 10/15) — 그것도 같이 남긴다.
  const rep2 = { ...rep, earlyWarning: { score: 8, level: 'low' }, marketVerdict: { verdict: 'neutral', krVerdict: { verdict: 'accumulate' } }, _krAnalog: null };
  rep2.marketVerdict.krVerdict.reasons = ['KR 과거 유사국면 12회 — … 3개월 후 중앙값 -1.1% · 상승확률 42%'];
  const c2 = reportCall(rep2, 'kr');
  c2.warnScore === 8 && c2.warnLevel === 'low' && c2.analogUp3m === 0.42 ? ok('[6b] 조기경보 점수·등급, KR 유사국면 3개월 상승확률(0.42)도 기록') : bad(`[6b] ${JSON.stringify(c2)}`);
}
// ── 채점
{
  const rec = { forecasts: { report: { dir: 'down' }, base: { pDown: 0.79 }, clim: { pDown: 0.5 } } };
  const s = scoreRecord(rec, -0.0802);
  s.forecasts.report.hit === true ? ok('[7] 보고서 down · 실제 -8% → 적중') : bad(`[7] ${JSON.stringify(s)}`);
  near(s.forecasts.base.brier, (0.79 - 1) ** 2) && near(s.forecasts.clim.brier, 0.25) ? ok('[8] Brier = (내림확률 - 실제내림)^2') : bad(`[8] ${JSON.stringify(s.forecasts)}`);
  const ab = scoreRecord({ forecasts: { report: { dir: null } } }, 0.01);
  ab.forecasts.report.hit === null ? ok('[9] 기권은 적중/실패가 아니다(null)') : bad('[9]');
}
// ── 집계·보정
{
  const recs = [
    { market: 'kr', scored: { ret: -0.02, forecasts: { report: { hit: true }, base: { p: 0.8, brier: 0.04 }, clim: { p: 0.5, brier: 0.25 } } } },
    { market: 'kr', scored: { ret: 0.01, forecasts: { report: { hit: false }, base: { p: 0.8, brier: 0.64 }, clim: { p: 0.5, brier: 0.25 } } } },
    { market: 'kr', scored: { ret: 0.01, forecasts: { report: { hit: null }, base: { p: 0.3, brier: 0.09 }, clim: { p: 0.5, brier: 0.25 } } } },
    { market: 'kr' },   // 아직 채점 전 — 집계에서 빠진다
  ];
  const a = aggregate(recs).kr;
  a.n === 3 && a.report.calls === 2 && a.report.hits === 1 && a.report.abstain === 1 ? ok('[10] 적중률 분모 = 방향을 낸 날만(기권 1 제외)') : bad(`[10] ${JSON.stringify(a)}`);
  near(a.base.brier, (0.04 + 0.64 + 0.09) / 3) && near(a.base.skill, 1 - ((0.04 + 0.64 + 0.09) / 3) / 0.25) ? ok('[11] Brier 평균과 기본값 대비 skill') : bad(`[11] ${JSON.stringify(a.base)}`);
  const bin8 = a.base.calibration.find((b) => b.bin === '0.8-0.9');
  bin8 && bin8.n === 2 && near(bin8.observed, 0.5) ? ok('[12] 보정표: 0.8 칸 2건 중 실제 하락 1 → 0.5') : bad(`[12] ${JSON.stringify(a.base.calibration)}`);
}
// ── 기록 빠진 날(커버리지) — 급락일에 회차가 접히면(10/15 정오) 기록이 빠지는데, 빠진 날을 그냥 지우면 결과가 좋아 보인다
{
  const cov = coverage({ sessions: ['2026-10-13', '2026-10-14', '2026-10-15'], recorded: ['2026-10-13', '2026-10-15'] });
  cov.sessions === 3 && cov.recorded === 2 && cov.missing.join() === '2026-10-14' ? ok('[12b] 장이 선 날 중 기록 없는 날을 센다') : bad(`[12b] ${JSON.stringify(cov)}`);
}
// ── 놓친 사건 유형
{
  missType({ ret: -0.08, sox: -0.043 }).includes('반도체 야간 충격') ? ok('[13] SOX ≤-4% 다음 날 급락 → 반도체 야간 충격') : bad(`[13] ${missType({ ret: -0.08, sox: -0.043 })}`);
  missType({ ret: -0.03, sox: 0.002, fx: 0.021 }).includes('환율 급변') ? ok('[14] 원/달러 ±2% → 환율 급변') : bad('[14]');
  missType({ ret: -0.03, sox: 0.002 }).includes('미분류') ? ok('[15] 아는 신호가 없으면 미분류(뉴스 확인 대상)') : bad('[15]');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
