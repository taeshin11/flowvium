// scripts/test-judge.mjs — 심판/매도 로직 단위검증 (검증체계). 생성기 helper 를 import 해
//   #5 매도 best-of-N scorer, best-of-N portfolio scorer, parseEntryMid, #3 심판 prompt 를
//   mock 데이터로 직접 검증. (main 가드 덕에 import 해도 보고서 생성 안 돔.)
//   실행: node scripts/test-judge.mjs  → 전부 PASS 면 exit 0.
import { scorePortfolioDraft, scoreSellRationaleDraft, parseEntryMid, buildAdjudicationPrompt } from './generate-report-local.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name}`); } };

console.log('[parseEntryMid]');
ok('"$380-390" → 385', parseEntryMid('$380-390') === 385);
ok('"140~145" → 142.5', parseEntryMid('140~145') === 142.5);
ok('null → null', parseEntryMid(null) === null);
ok('"46.8%" → 46.8', parseEntryMid('46.8%') === 46.8);

console.log('[best-of-N portfolio scorer] 유효/근거 draft 가 환각 draft 보다 높아야');
const lp = new Map([['LRCX', { price: 385 }], ['MU', { price: 142 }]]);
const pGood = { portfolio: [
  { ticker: 'LRCX', entryZone: '$380-390', rationale: '13F 누적 매수 12건, PEG 0.8, 영업이익률 32%' },
  { ticker: 'MU', entryZone: '$140-145', rationale: '메모리 업싸이클 변곡, 매출 +196% YoY' },
] };
const pBad = { portfolio: [
  { ticker: 'FAKE9', entryZone: '$1000', rationale: '단기' },          // 실가 없음 -2
  { ticker: 'LRCX', entryZone: '$200', rationale: '단기' },            // entryZone $200 vs 385 → 환각 -1
] };
const sG = scorePortfolioDraft(pGood, lp), sB = scorePortfolioDraft(pBad, lp);
console.log(`    good=${sG.toFixed(1)} bad=${sB.toFixed(1)}`);
ok('good > bad', sG > sB);
ok('빈 portfolio → -1e9', scorePortfolioDraft({ portfolio: [] }, lp) === -1e9);

console.log('[#5 매도 rationale scorer] pnl/heldDays/rule 인용 draft 가 일반론보다 높아야');
const sellCands = { us: [{ ticker: 'TSLA', pnlPct: -12, heldDays: 18, reason: 'stop_breach 손절선 이탈' }], kr: [] };
const grounded = { sellRecommendations: [{ ticker: 'TSLA', rationale: '손절선 이탈로 -12% 손실 확정, 18일 보유 후 회전 매도' }] };
const generic = { sellRecommendations: [{ ticker: 'TSLA', rationale: '시장 상황을 고려한 일반적 매도 추천입니다' }] };
const halluc = { sellRecommendations: [{ ticker: 'NOEXIST', rationale: '존재하지 않는 종목' }] };
const gG = scoreSellRationaleDraft(grounded, sellCands), gN = scoreSellRationaleDraft(generic, sellCands), gH = scoreSellRationaleDraft(halluc, sellCands);
console.log(`    grounded=${gG.toFixed(1)} generic=${gN.toFixed(1)} halluc=${gH.toFixed(1)}`);
ok('grounded > generic', gG > gN);
ok('grounded > 환각종목', gG > gH);
ok('빈 → -1e9', scoreSellRationaleDraft({ sellRecommendations: [] }, sellCands) === -1e9);

console.log('[#3 심판 prompt] borderline 정보가 prompt 에 들어가야');
const cand = { ticker: 'NVDA', sector: 'semis', buyConviction: 30, netSoft: 3, MID: 2, HIGH: 4, buyDiscount: 1,
  hits: [{ id: 'tech_rsi_overbought', category: 'technical', score: 2, reason: 'RSI 72 과열' }] };
const prompt = buildAdjudicationPrompt(cand);
ok('ticker 포함', prompt.includes('NVDA'));
ok('buyConviction 포함', prompt.includes('30'));
ok('sell-rule hit 포함', prompt.includes('tech_rsi_overbought'));
ok('action enum 요구', /keep\|downgrade\|veto/.test(prompt));

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
