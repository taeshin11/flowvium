// kr-flow-intensity.test.mjs — KR 종목 수급강도. node scripts/lib/kr-flow-intensity.test.mjs
//
// 2026-10-30: 9/10 뒤 보고서 로그가 전부 '[kr-flow] 수급강도 0/N' 이었다(마지막 성공 9/10 14:31, 그 뒤 253회 0건).
//   네이버가 frgn.naver 표 페이지를 새 앱(investmentinfo)으로 넘겨 옛 표 셀이 없다 — 파서가 null 만 낸다.
//   사이트 api/korea-flow 는 같은 일로 m.stock.naver.com/api/stock/<code>/trend(JSON)로 옮겼는데 보고서 쪽 사본은 안 옮겼다.
//   그동안 매수 micro_kr_smart_flow·매도 micro_kr_flow_exodus 가 입력이 없어 한 번도 못 울렸다.
import assert from 'node:assert/strict';
import { flowFromTrend, fetchKrFlowIntensity } from './kr-flow-intensity.mjs';

// 실제 응답 모양(10/30 005930 두 줄 + 지어낸 세 줄): 문자열·천 단위 쉼표·부호. 최신이 앞.
const row = (bizdate, frgn, organ, close, vol) => ({ itemCode: '005930', bizdate, foreignerPureBuyQuant: frgn, organPureBuyQuant: organ,
  individualPureBuyQuant: '0', closePrice: close, accumulatedTradingVolume: vol });
const rows = [
  row('20261029', '-518,762', '+245,680', '230,500', '24,911,188'),
  row('20261028', '+1,522,344', '+1,620,180', '245,000', '17,840,544'),
  row('20261027', '+100', '+100', '222,000', '10,000,000'),
  row('20261024', '+100', '-100', '220,000', '10,000,000'),
  row('20261023', '-100', '+100', '221,000', '10,000,000'),
  row('20261022', '+999,999', '+999,999', '219,000', '10,000,000'),   // 5일 밖 — 합에 안 든다
];

// [1] 5일 합·연속 순매수·수급강도
{
  const f = flowFromTrend(rows);
  assert.ok(f, '표가 있으면 값이 나온다');
  assert.equal(f.days, 5);
  assert.equal(f.foreignStreak, 0, '최신 날 외인 순매도면 0일');
  assert.equal(f.instStreak, 3, '기관 10/29·10/28·10/27 순매수, 10/24 순매도');
  const frgn = -518762 * 230500 + 1522344 * 245000 + 100 * 222000 + 100 * 220000 - 100 * 221000;
  const inst = 245680 * 230500 + 1620180 * 245000 + 100 * 222000 - 100 * 220000 + 100 * 221000;
  const turn = 24911188 * 230500 + 17840544 * 245000 + 10_000_000 * (222000 + 220000 + 221000);
  assert.equal(f.foreignNet5dKrw, Math.round(frgn));
  assert.equal(f.instNet5dKrw, Math.round(inst));
  assert.equal(f.intensityPct, +(((frgn + inst) / turn) * 100).toFixed(2));
}
// [2] 빈 답·이상한 답은 null(지어내지 않는다)
assert.equal(flowFromTrend([]), null);
assert.equal(flowFromTrend(null), null);
assert.equal(flowFromTrend({ code: 'ERROR' }), null);
assert.equal(flowFromTrend([{ bizdate: '20261029' }]), null, '종가·거래량 없는 줄만 있으면 없음');

// [3] 받아 오기: 새 JSON 주소로, 티커 접미사 떼고, 실패는 빼고 성공만 담는다
{
  const asked = [];
  const fakeFetch = async (url) => {
    asked.push(url);
    if (url.includes('/000660/')) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => rows };
  };
  const m = await fetchKrFlowIntensity(['005930.KS', '000660.KS', 'AAPL'], { fetchImpl: fakeFetch });
  assert.deepEqual([...m.keys()], ['005930.KS']);
  assert.ok(asked.every((u) => /^https:\/\/m\.stock\.naver\.com\/api\/stock\/\d{6}\/trend\?/.test(u)), asked.join(' '));
  assert.equal(asked.length, 2, '6자리 코드가 아닌 티커는 묻지 않는다');
}
console.log('kr-flow-intensity.test: ✅ 전부 통과');
