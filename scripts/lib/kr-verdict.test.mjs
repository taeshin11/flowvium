#!/usr/bin/env node
/**
 * kr-verdict.test.mjs — KR 결정론 판정(computeKrVerdict)과 '전날 밤 반도체 충격' 거부권. 2026-10-15 신설.
 *
 * 왜(사장님 10/15 "왜 오늘같은 일을 예측못했는지"):
 *   10/15 08:44 아침판 KR 판정은 'accumulate'(분할 매수 관찰)였고 그날 KOSPI -8.0%. 규칙이 '고점대비 -8% 이하 +
 *   조기경보 low → accumulate' 라 한국이 많이 빠질수록 매수 관찰이 된다. 조기경보는 미국·EM·유럽 주식 1주
 *   수익률만 보고 전날 밤 SOX(-4.3%)는 안 본다.
 *   2005~2026 실측(KOSPI 다음 날 ↔ 전날 밤 SOX, 5,366일): SOX ≤-4% 158일 → KOSPI -2% 이하 31%(평소 4.9%),
 *   하락 79%. SOX -4~-2% 444일 → 15%, 70%. 그 밖의 칸은 평소와 같다.
 * 무엇을: 판정이 '매수 쪽'(accumulate·neutral_ready)인데 전날 밤 SOX 칸의 다음 날 -2% 이하 비율이 평소보다
 *   **우연으로 보기 어려울 만큼** 높으면(이항 z > 1.645 — topicTier 와 같은 잣대, 손으로 정한 비율 없음) 'wait' 로 내린다.
 *   거부권만 — 매수를 새로 만들지 않는다. 원래 판정은 vetoedFrom 에 남긴다(장부·사후 비교용).
 * 언제 적용되나: 마지막 SOX 장이 마지막 KOSPI 봉 '뒤' 일 때만(= 다음 KR 장에 아직 반영 안 된 밤). 한국 장중·장후
 *   회차에서는 그 밤이 이미 오늘 봉에 들어가 있으니 신호 없음.
 * 칸 경계(-4·-2·0·+2%)는 10/15 를 본 뒤 정한 것이라 사후 적합 위험이 있다(agy 검토) — 전향적 장부가 같은 칸으로
 *   매일 기록·채점해 검증한다(forecast-ledger). 10/15 은 158일 중 하루다.
 */
import { overnightTailRisk, computeKrVerdict } from './kr-verdict.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// 합성 시계열: 날짜 d0.. 에서 SOX 와 KOSPI 를 번갈아(같은 날짜 = 미국 장이 한국 장 뒤)
const mkSeries = (soxR, ksR) => {
  const sox = [{ d: '2000-01-01', c: 100 }], ks = [{ d: '2000-01-01', c: 100 }];
  const day = (i) => new Date(Date.UTC(2000, 0, 2 + i)).toISOString().slice(0, 10);
  for (let i = 0; i < soxR.length; i++) {
    ks.push({ d: day(i), c: ks.at(-1).c * (1 + ksR[i]) });      // KR 장(i)
    sox.push({ d: day(i), c: sox.at(-1).c * (1 + soxR[i]) });    // 같은 날 밤 미국 장(i) → KR 장(i+1) 에 걸린다
  }
  return { sox, ks };
};
{
  // 과거 400일: SOX -5% 인 밤 40번, 그다음 KR 날 절반이 -3%. 나머지 밤은 +0.5%, KR 은 ±0.3%.
  const soxR = [], ksR = [];
  for (let i = 0; i < 400; i++) { soxR.push(i % 10 === 0 ? -0.05 : 0.005); ksR.push(i % 10 === 1 ? (i % 20 === 1 ? -0.03 : 0.002) : (i % 2 ? 0.003 : -0.003)); }
  soxR[399] = -0.045;   // 마지막 밤 SOX -4.5% — 아직 KR 에 반영 안 됨
  const { sox, ks } = mkSeries(soxR, ksR);
  const r = overnightTailRisk(sox, ks, { minN: 30 });
  r && r.bucket === 'le-4' && r.elevated === true && r.sox < -0.04 ? ok(`[1] 마지막 밤 SOX -4.5% · 그 칸 -2%이하 ${(r.pBigDown * 100).toFixed(0)}% vs 평소 ${(r.base * 100).toFixed(1)}% → elevated`) : bad(`[1] ${JSON.stringify(r)}`);
  // 한국 장이 그 밤 뒤에 이미 열렸으면(마지막 KR 봉이 SOX 보다 뒤) 신호 없음
  const ks2 = [...ks, { d: '2001-12-31', c: ks.at(-1).c }];
  overnightTailRisk(sox, ks2, { minN: 30 }) === null ? ok('[2] 그 밤이 이미 KR 봉에 반영됐으면 null') : bad('[2]');
  // 평범한 밤(+0.5%)이면 elevated 아님
  const soxCalm = [...sox.slice(0, -1), { d: sox.at(-1).d, c: sox.at(-2).c * 1.005 }];
  overnightTailRisk(soxCalm, ks, { minN: 30 })?.elevated === false ? ok('[3] 평범한 밤은 elevated 아님') : bad(`[3] ${JSON.stringify(overnightTailRisk(soxCalm, ks, { minN: 30 }))}`);
}
// 판정 — 10/15 아침 실측 k(고점대비 -33.8%·20일 -14.4%·유사국면 12회 3개월 -1.1%·42%) + 조기경보 low
{
  const k = { dd: -33.8, r20: -14.4, above200: false, distPct: -5.5, analog: { matches: 12, med3m: -1.1, posRate3m: 42 }, breadth: { divergencePp: 15.2 } };
  const ew = { level: 'low', score: 8 };
  const before = computeKrVerdict(k, ew);
  before.verdict === 'accumulate' && !before.vetoedFrom ? ok('[4] 밤 신호 없으면 종전과 같다(accumulate) — 기존 동작 보존') : bad(`[4] ${JSON.stringify(before)}`);
  const after = computeKrVerdict({ ...k, overnight: { sox: -0.043, bucket: 'le-4', n: 158, pBigDown: 0.31, base: 0.049, z: 15, elevated: true } }, ew);
  after.verdict === 'wait' && after.vetoedFrom === 'accumulate' && /SOX -4\.3%/.test(after.reasons[0]) ? ok(`[5] 10/15 아침: accumulate → wait · "${after.reasons[0]}"`) : bad(`[5] ${JSON.stringify(after)}`);
  const hi = computeKrVerdict({ ...k, overnight: { sox: -0.05, bucket: 'le-4', n: 158, pBigDown: 0.31, base: 0.049, z: 15, elevated: true } }, { level: 'high', score: 50 });
  hi.verdict === 'wait' && !hi.vetoedFrom ? ok('[6] 이미 wait(경보 high)면 거부권이 할 일 없음') : bad(`[6] ${JSON.stringify(hi)}`);
  const notEl = computeKrVerdict({ ...k, overnight: { sox: -0.01, bucket: '-2to0', n: 1890, pBigDown: 0.04, base: 0.049, z: -1, elevated: false } }, ew);
  notEl.verdict === 'accumulate' ? ok('[7] elevated 아니면 그대로') : bad('[7]');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
