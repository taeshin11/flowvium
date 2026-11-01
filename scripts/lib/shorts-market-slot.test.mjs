// shorts-market-slot.test.mjs — 기업·증시 칸(11/02 벤치마크). node scripts/lib/shorts-market-slot.test.mjs
//
// 11/02 사장님 성장 점검(Mac mini2 경유) 벤치마크: 경제 쇼츠 상위 10편 주제 = 삼성·하이닉스 실적·배당·금·외국인 수급(보는 사람 돈과 바로 이어짐).
//   우리 48시간 189편은 국내정치 98 · 기업 17 · 증시 17 — 주제별 조회 중앙은 1,000~1,100 으로 비슷(효과 불확실).
//   자문 ChatGPT·Claude: 기업·증시를 18% → 40~50%(정치는 없애지 않음), 2주·60편 뒤 재측정(2/3). agy 는 반대 없음(다른 안).
// → 칸 45% 에서 후보 15개 중 기업·증시 주제가 있으면 맨 앞으로(위험 썸네일은 앞에 두지 않는다). 나머지 55% 는 지금 순서 — 둘을 비교한다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { marketFor, marketFirst, MARKET_TOPICS } = await import('./explore-slot.mjs');
const N = 600, r = Array.from({ length: N }, (_, n) => marketFor(n)).filter((x) => x === '1').length / N;
assert.ok(r > 0.38 && r < 0.52, `칸 45% 안팎(${(r * 100).toFixed(0)}%)`);
assert.deepEqual(MARKET_TOPICS, ['기업·산업', '증시·금리·환율']);
const c = (k, t, unsafe = false) => ({ keyword: k, __topic: t, unsafe });
const head = [c('a', '국내정치'), c('b', '사회·사건사고'), c('c', '기업·산업'), c('d', '증시·금리·환율')];
assert.deepEqual(marketFirst(head).map((x) => x.keyword), ['c', 'a', 'b', 'd'], '첫 기업·증시 하나만 맨 앞으로, 나머지 순서는 그대로');
assert.deepEqual(marketFirst([c('a', '국내정치'), c('b', '국제·외교·전쟁')]).map((x) => x.keyword), ['a', 'b'], '없으면 그대로');
assert.deepEqual(marketFirst([c('a', '국내정치'), c('c', '기업·산업', true)], { unsafe: (x) => x.unsafe }).map((x) => x.keyword), ['a', 'c'], '위험 썸네일은 앞에 안 둔다');
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
assert.ok(/SHORTS_MARKET: MARKET_ENV/.test(src('video-publish.mjs')), '발행이 칸을 정한다');
assert.ok(/MARKET && !EXPLORE[\s\S]{0,300}marketFirst\(/.test(src('video/make-shorts.mjs')), '렌더가 기업·증시 칸이면 앞으로 당긴다');
console.log('shorts-market-slot.test: ✅ 전부 통과');
