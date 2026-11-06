#!/usr/bin/env node
/**
 * fundamental-sell.test.mjs — audit-coverage [5b] '기존 펀더멘털 매도를 무시한 매수' 의 '펀더멘털 매도' 판정. 2026-10-15 신설.
 *
 * 왜: 10/14 GOOG 매수(01:34)가 '기존 펀더멘털sell(10/12 13:33) 무시 — 정합 게이트 우회' 로 ❌ 가 나 모든 push 를 막았다.
 *   그런데 그 매도는 macro_high_risk "매크로 환경 악화 우려로 …" 였다. 프로브가 사유 글에 '악화' 만 있으면
 *   펀더멘털로 셌다(rationale LIKE '%악화%'). 같은 이유로 50일선 '모멘텀 악화'·'수급 악화'·'추세 악화' 도 걸린다.
 *   보고서 쪽은 맞게 동작했다 — 10/14 정오판 GOOG 는 whipsawRisk 로 표시됨(최근 매도 재매수 감점 경로).
 * 정합 게이트(generate-report-local 'buy-sell 정합', 51b9206e)가 막는 것은 '영업이익률(op margin) 악화' 하나다.
 *   그 게이트를 만든 기아 사건의 매도는 rotation_loss "op margin YoY 악화" — 그래서 사유 글 검사는 남기되
 *   '마진·이익률이 악화' 일 때만 펀더멘털로 센다. 매도 룰 쪽은 sell-rules-tuned.json 의 category==='fundamental'
 *   전부(forensic_* 포함)를 쓴다 — 종전 LIKE '%fund%' 는 forensic_* 를 놓쳤다.
 */
import { isFundamentalSell, fundamentalSellIds, marginClaimUnsupported } from './fundamental-sell.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const ids = fundamentalSellIds({ rules: [
  { id: 'fund_margin_decline', category: 'fundamental' }, { id: 'forensic_negative_ocf', category: 'fundamental' },
  { id: 'macro_high_risk', category: 'macro' }, { id: 'tech_200ma_breach', category: 'technical' },
] });
const t = (st, r) => isFundamentalSell(st, r, ids);
!t('macro_high_risk', '매크로 환경 악화 우려로 인한 방어적 포트폴리오 재편. 약수익 실현 후 비중 축소.') ? ok('[1] GOOG 10/12 매크로 매도는 펀더멘털 아님') : bad('[1] 매크로 악화가 펀더멘털로 셌다');
!t('guru_drucken_trend_break', '50일선(142.40) 하향이탈 및 RSI 23 모멘텀 악화.') ? ok('[2] 모멘텀 악화 아님') : bad('[2]');
!t('micro_kr_flow_exodus', '50MA 이탈, RSI 31 약세 및 외인·기관 집중 순매도로 수급 악화') ? ok('[3] 수급 악화 아님') : bad('[3]');
t('fund_margin_decline', '') ? ok('[4] fund_margin_decline') : bad('[4]');
t('forensic_negative_ocf', '영업현금흐름 음수') ? ok('[5] forensic_* (category fundamental) — 종전 LIKE 가 놓침') : bad('[5]');
t('rotation_loss', 'op margin YoY 악화, rotation loss') ? ok('[6] 기아 사건형: 사유가 op margin 악화') : bad('[6]');
t('rotation_loss', '운영 마진 악화, 수익성 저하') && t('macro_high_risk', '영업이익률 YoY 악화 및 방어적 섹터 회전') ? ok('[7] 마진·영업이익률 악화 글은 유형 무관 펀더멘털') : bad('[7]');
!t('tech_200ma_breach', '200일 이동평균선 하향 이탈로 인한 추세 악화') ? ok('[8] 추세 악화 아님') : bad('[8]');
// [9] 2026-11-07 V: 11/05 매도(micro_region_bearish) 사유 "마진 악화" 로 펀더멘털로 셌는데, 재무 데이터는 영업이익률 60.0→61.2%(개선).
//   정합 게이트는 데이터(전년 대비 -2%p 이상)로 막으니 11/06 매수는 맞게 통과했다. 사유 글만으로 센 매도가 데이터와 어긋나면
//   '게이트 우회' 가 아니라 '사유 글이 데이터와 다름' 이다. 데이터를 모르면 판단하지 않는다(null) — 오류는 그대로 남는다.
{
  const rule = { id: 'fund_margin_decline', category: 'fundamental', condition: { type: 'opMarginDecline', decline_pp_gte: 2 } };
  const V = { annuals: [{ operatingMarginPct: 61.2 }, { operatingMarginPct: 60 }] };
  const u = marginClaimUnsupported?.({ sellType: 'micro_region_bearish', ids, fin: V, rule });
  (u?.unsupported === true && u.cur === 61.2 && u.prev === 60) ? ok('[9] 글만 마진 악화·데이터는 개선 → 사유 글이 데이터와 다름') : bad(`[9] ${JSON.stringify(u)}`);
  const real = marginClaimUnsupported?.({ sellType: 'micro_region_bearish', ids, fin: { annuals: [{ operatingMarginPct: 55 }, { operatingMarginPct: 60 }] }, rule });
  (real?.unsupported === false) ? ok('[9b] 데이터도 -5%p → 사유 글이 맞다(오류 유지)') : bad(`[9b] ${JSON.stringify(real)}`);
  const byId = marginClaimUnsupported?.({ sellType: 'fund_margin_decline', ids, fin: V, rule });
  (byId?.unsupported === false) ? ok('[9c] 룰 자체가 펀더멘털이면 글 검사 대상 아님') : bad(`[9c] ${JSON.stringify(byId)}`);
  const none = marginClaimUnsupported?.({ sellType: 'micro_region_bearish', ids, fin: null, rule });
  (none?.unsupported === null) ? ok('[9d] 데이터 없으면 모름(null) — 오류 유지') : bad(`[9d] ${JSON.stringify(none)}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
