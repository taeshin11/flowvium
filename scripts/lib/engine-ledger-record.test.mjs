// engine-ledger-record.test.mjs — 보고서 → 장부 결정 줄(decisionsOf). node scripts/lib/engine-ledger-record.test.mjs
// 2026-10-30 v0.3: Stage2 에서 거부된 종목도 적는다(funnel_veto_trend/other) — '거부 안 했으면' 대조군(A·B 가설).
import assert from 'node:assert/strict';
import { decisionsOf } from '../engine-ledger-record.mjs';

const r = {
  portfolio: [{ ticker: 'AAPL', allocation: 20 }],
  buyCandidateScoring: {
    top30: [{ ticker: 'AAPL', market: 'us', score: 78, reasons: ['fund_high_roe'] }],
    funnel: { byMarket: {}, vetoed: [
      { ticker: '005930.KS', market: 'kr', score: 40, kind: 'trend', why: 'tech_200ma_breach' },
      { ticker: 'ESTC', market: 'us', score: 60, kind: 'other', why: '과열 추격 veto' },
    ] },
  },
};
const d = decisionsOf(r);
assert.deepEqual(d.filter((x) => x.role.startsWith('funnel_veto_')), [
  { role: 'funnel_veto_trend', ticker: '005930.KS', market: 'kr', score: 40, why: 'tech_200ma_breach' },
  { role: 'funnel_veto_other', ticker: 'ESTC', market: 'us', score: 60, why: '과열 추격 veto' },
]);
assert.equal(d.filter((x) => x.role === 'pick').length, 1, '기존 줄은 그대로');
assert.equal(decisionsOf({}).length, 0, '깔때기 정보가 없는 옛 보고서도 된다');
console.log('engine-ledger-record.test: ✅ 전부 통과');
