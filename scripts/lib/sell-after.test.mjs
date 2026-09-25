#!/usr/bin/env node
/**
 * sell-after.test.mjs — 매도엔진이 판 뒤 주가가 어떻게 갔나(너무 빨리 팔았나). 2026-09-25 신설.
 *
 * 사장님 "우리가 놓친 요소가 없는지 항상 확인해야되. 너무 빨리 팔지는 않았는지도".
 * analyze-exit-quality 는 손절·목표 청산만 봤다(일봉으로 다시 판정). 그런데 최근 30일 청산 622건 중
 * **331건이 매도엔진 신호로 판 것**(sold)이었다 — 절반이 넘는 청산을 한 번도 사후 평가하지 않았다.
 */
import { judgeSale, summarizeSales, classifySellDelta, deltaAtDay } from './sell-after.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from './project-root.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 한 건 판정 — 판 값 대비 이후 종가·최고가
{
  const j = judgeSale({ exitPrice: 100, after: { days: 20, high: 115, low: 95, last: 108 } });
  (Math.abs(j.lastPct - 8) < 1e-9 && Math.abs(j.highPct - 15) < 1e-9 && j.verdict === 'early')
    ? ok('[1] 판 뒤 20일 종가 +8% → 너무 빨랐다') : bad(`[1] ${JSON.stringify(j)}`);
  const k = judgeSale({ exitPrice: 100, after: { days: 20, high: 103, low: 85, last: 90 } });
  k.verdict === 'right' ? ok('[1b] 판 뒤 -10% → 판 게 맞았다') : bad(`[1b] ${JSON.stringify(k)}`);
  const m = judgeSale({ exitPrice: 100, after: { days: 20, high: 104, low: 97, last: 102 } });
  m.verdict === 'flat' ? ok('[1c] ±5% 안 → 판단 보류(차이 없음)') : bad(`[1c] ${JSON.stringify(m)}`);
}
// [2] 아직 날이 덜 지난 것은 판정하지 않는다 — 5거래일 미만이면 null
{
  judgeSale({ exitPrice: 100, after: { days: 3, high: 110, low: 99, last: 109 } }) === null
    ? ok('[2] 3거래일 → 판정 안 함') : bad('[2] 날이 덜 지난 것을 판정했다');
  judgeSale({ exitPrice: 0, after: { days: 20, high: 1, low: 1, last: 1 } }) === null
    ? ok('[2b] 판 값이 없으면 판정 안 함') : bad('[2b]');
}
// [3] 규칙별 요약 — 어느 매도 규칙이 성급한지
{
  const rows = [
    { sellType: 'tech_200ma_breach', exitPrice: 100, after: { days: 20, high: 120, low: 99, last: 112 } },
    { sellType: 'tech_200ma_breach', exitPrice: 100, after: { days: 20, high: 118, low: 98, last: 109 } },
    { sellType: 'tech_200ma_breach', exitPrice: 100, after: { days: 20, high: 101, low: 90, last: 93 } },
    { sellType: 'guru_trend_break', exitPrice: 50, after: { days: 20, high: 51, low: 40, last: 42 } },
    { sellType: 'guru_trend_break', exitPrice: 50, after: { days: 2, high: 60, low: 50, last: 59 } },  // 덜 지남 — 빠진다
  ];
  const s = summarizeSales(rows);
  const t = s.byType.find((x) => x.sellType === 'tech_200ma_breach');
  const g = s.byType.find((x) => x.sellType === 'guru_trend_break');
  (s.n === 4 && t.n === 3 && t.early === 2 && Math.abs(t.medianLastPct - 9) < 1e-9 && g.n === 1 && g.right === 1 && s.byType[0].sellType === 'tech_200ma_breach')
    ? ok(`[3] 규칙별: 200일선 이탈 3건 중 2건 성급(중앙 +9%) · 추세이탈 1건 맞음 — 성급한 순으로 정렬`)
    : bad(`[3] ${JSON.stringify(s)}`);
}
// [4] 한 달 뒤 다시 재기 — 매도 평가가 **판 뒤 5~6일에 한 번**만 매겨졌다(실측 중앙 6일).
//   그 기간엔 '너무 빨리 팔았다' 가 약 9%, 20거래일로 재면 20% — 튜닝이 성급한 매도를 절반만 봤다.
{
  const path = Array.from({ length: 25 }, (_, i) => ({ close: 100 + i }));   // 하루 +1
  const d = deltaAtDay(path, 100, 20);
  Math.abs(d - 19) < 1e-9 ? ok('[4] 20번째 거래일 종가 기준 +19%') : bad(`[4] ${d}`);
  deltaAtDay(path.slice(0, 12), 100, 20) === null ? ok('[4b] 20거래일이 안 지났으면 null') : bad('[4b]');
  (classifySellDelta(-3) === 'good_call' && classifySellDelta(5) === 'missed_upside' && classifySellDelta(1) === 'neutral')
    ? ok('[4c] 기존 잣대 그대로(-3% 좋은 매도 · +5% 놓친 상승)') : bad('[4c]');
}
// [5] 튜닝은 한 달 판정이 있으면 그것을 쓴다
{
  const src = readFileSync(join(ROOT, 'scripts/tune-sell-rules.mjs'), 'utf8');
  (/COALESCE\(o\.outcome_20d,\s*o\.outcome\)/.test(src) && /COALESCE\(o\.price_delta_20d,\s*o\.price_delta_pct\)/.test(src))
    ? ok('[5] tune-sell-rules 가 20거래일 판정을 먼저 쓴다') : bad('[5] tune-sell-rules 가 아직 5~6일 판정만 쓴다');
  const ev = readFileSync(join(ROOT, 'scripts/evaluate-sell-outcomes.mjs'), 'utf8');
  /price_delta_20d/.test(ev) && /deltaAtDay/.test(ev)
    ? ok('[5b] evaluate-sell-outcomes 가 한 달 뒤 다시 잰다') : bad('[5b] 한 달 뒤 재기가 없다');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
