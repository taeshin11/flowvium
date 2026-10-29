// funnel-breadth.test.mjs — 깔때기 거부 집계·시장 폭·'한국 0종' 이유 한 줄. node scripts/lib/funnel-breadth.test.mjs
//
// 2026-10-30 사장님 "한국종목들이 안나오는 이유는?" → 실측: KOSPI 6012 = 1년 고점 대비 −34%·200일선 아래,
//   KR 459종 중 392종(85%)이 200일선 아래 또는 데드크로스(US 53%) → Stage2 KR 30종 중 28종이 추세 hard 거부.
//   ChatGPT·agy·Claude 셋 다: 운영 규칙은 그대로 두고 (E) 이유를 보고서에 보이고, (D) 거부된 종목을 장부에 남겨 전향 검증.
import assert from 'node:assert/strict';
import { vetoKind, funnelSummary, breadthOf, krFunnelReason, BREADTH_MAX_AGE_MS, freshBreadth, breadthUsable } from './funnel-breadth.mjs';

// [1] 거부 사유 분류 — 추세(200일선·데드크로스)와 나머지
assert.equal(vetoKind('최종심판 hard(tech_200ma_breach): price < 200MA'), 'trend');
assert.equal(vetoKind('최종심판 hard(tech_dead_cross): 50MA < 200MA'), 'trend');
assert.equal(vetoKind('최종심판 hard(fund_margin_decline): …'), 'other');
assert.equal(vetoKind('과열 추격 veto: 200MA +40%'), 'other', '과열(위로 멀어짐)은 추세 하락 거부가 아니다');
assert.equal(vetoKind('종목 성적 veto: 최근 30일'), 'other');
assert.equal(vetoKind(null), null);

// [2] 시장별 집계 + 거부 목록(점수 순)
{
  const c = (ticker, market, s, v) => ({ ticker, market, stage1Score: s, ...(v ? { _buyVeto: v } : {}) });
  const s = funnelSummary([
    c('005930.KS', 'kr', 40, '최종심판 hard(tech_200ma_breach): x'), c('000660.KS', 'kr', 55, '최종심판 hard(tech_dead_cross): x'),
    c('064350.KS', 'kr', 30), c('AAPL', 'us', 70), c('GOOGL', 'us', 66, '최종심판 hard(tech_200ma_breach): x'), c('ESTC', 'us', 60, '과열 추격 veto: x'),
  ]);
  assert.deepEqual(s.byMarket.kr, { in: 3, trend: 2, other: 0, kept: 1 });
  assert.deepEqual(s.byMarket.us, { in: 3, trend: 1, other: 1, kept: 1 });
  assert.deepEqual(s.vetoed.map((x) => x.ticker), ['GOOGL', 'ESTC', '000660.KS', '005930.KS'], '점수 높은 순');
  assert.deepEqual(s.vetoed[0], { ticker: 'GOOGL', market: 'us', score: 66, kind: 'trend', why: 'tech_200ma_breach' });
  assert.equal(s.vetoed[1].why, '과열 추격 veto: x');
}

// [3] 시장 폭: 200일선 아래 또는 50<200 인 종목 비율. 200봉 안 되는 종목은 분모에서 뺀다
{
  const up = Array.from({ length: 220 }, (_, i) => 100 + i);          // 오름 → 둘 다 아님
  const down = Array.from({ length: 220 }, (_, i) => 400 - i);        // 내림 → 둘 다
  const short = Array.from({ length: 50 }, () => 10);
  const b = breadthOf([up, down, down, short]);
  assert.deepEqual(b, { n: 3, below200: 2, deadCross: 2, either: 2, pct: 0.667 });
  assert.deepEqual(breadthOf([]), { n: 0, below200: 0, deadCross: 0, either: 0, pct: null });
}

// [4] 보고서 한 줄 — KR 후보 대부분이 추세로 빠졌을 때만, 시장 폭은 새것일 때만 붙인다
{
  const now = Date.parse('2026-10-30T00:00:00Z');
  const fresh = { at: '2026-10-29T08:00:00Z', kr: { n: 459, either: 392, pct: 0.854 } };
  const sum = { byMarket: { kr: { in: 30, trend: 28, other: 0, kept: 2 } } };
  const line = krFunnelReason(sum, fresh, now);
  assert.match(line, /30종 중 28종/);
  assert.match(line, /459종 중 392종\(85%\)/);
  assert.match(line, /200일선/);
  assert.doesNotMatch(line, /[A-Za-z_]{6,}/, '개발자 용어(규칙 id) 없이');
  // 오래된 폭은 안 붙인다(모르는 걸 아는 것처럼 쓰지 않는다)
  const stale = { ...fresh, at: new Date(now - BREADTH_MAX_AGE_MS - 1).toISOString() };
  assert.doesNotMatch(krFunnelReason(sum, stale, now), /459종/);
  // 추세 거부가 절반 미만이면 이유로 내세우지 않는다
  assert.equal(krFunnelReason({ byMarket: { kr: { in: 30, trend: 10, other: 2, kept: 18 } } }, fresh, now), null);
  assert.equal(krFunnelReason({ byMarket: {} }, fresh, now), null);
}
// [5] 10/30 agy 리뷰: 오래된 폭이 보고서 JSON → 장부 → H10 국면 판정으로 새지 않게 — 보고서에 넣을 때부터 거른다
{
  const now = Date.parse('2026-10-30T00:00:00Z');
  const b = { at: '2026-10-29T08:00:00Z', kr: { n: 459, either: 392, pct: 0.854 }, us: { n: 600, either: 300, pct: 0.5 } };
  assert.deepEqual(freshBreadth(b, now), b);
  assert.equal(freshBreadth({ ...b, at: new Date(now - BREADTH_MAX_AGE_MS - 1).toISOString() }, now), null, '36시간 넘으면 없음');
  assert.equal(freshBreadth({ ...b, at: 'x' }, now), null);
  assert.equal(freshBreadth(null, now), null);
}
// [6] 10/30 agy 리뷰: 시장마다 따로 — 한 시장(KR)이 통째로 실패하거나 200봉 미만만 오면 쓰지 않는다
{
  assert.equal(breadthUsable({ n: 400 }, 459), true);
  assert.equal(breadthUsable({ n: 0 }, 459), false, 'KR 전멸');
  assert.equal(breadthUsable({ n: 200 }, 459), false, '절반 미만');
  assert.equal(breadthUsable({ n: 5 }, 0), false, '분모 없음');
}
console.log('funnel-breadth.test: ✅ 전부 통과');
