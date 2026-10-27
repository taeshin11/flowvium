// evergreen-check.test.mjs — 상시 쇼츠(예비 풀) 대본 규칙(10/28 Mac mini2 경유). node scripts/lib/evergreen-check.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './project-root.mjs';
import { checkEvergreen } from './evergreen-check.mjs';

const ok = {
  id: 't', title: 'PER 낮으면 싼 주식일까',
  scenes: [
    { hook: 'PER 낮으면 싼 주식일까', say: 'PER이 낮으면 무조건 싼 주식일까요?', image: 'a magnifying glass' },
    { hook: '주가를 이익으로 나눈 값', say: 'PER은 주가를 주당순이익으로 나눈 값입니다.', image: 'a balance scale' },
  ],
};
const withScene = (s) => ({ ...ok, scenes: [ok.scenes[0], { ...ok.scenes[1], ...s }] });

// [1] 깨끗한 대본은 통과
assert.deepEqual(checkEvergreen(ok), { ok: true, why: [] });
// [2] 날짜 — 언제 봐도 맞아야 한다
for (const say of ['10월 금리 결정이 나왔습니다.', '2026년 들어 많이 올랐습니다.', '오늘 코스피가 올랐습니다.', '지난주 외국인이 샀습니다.', '올해 실적이 좋습니다.'])
  assert.equal(checkEvergreen(withScene({ say })).ok, false, say);
// [3] 가격·수준 — 날마다 바뀐다
for (const say of ['주가가 5만 원입니다.', '같은 1달러를 팔아도 매출이 커집니다.', '코스피 2500포인트가 기준입니다.', '금리가 3.5%입니다.', '시가총액 400조 회사입니다.'])
  assert.equal(checkEvergreen(withScene({ say })).ok, false, say);
// [4] 개념 숫자는 된다 — 배수·기간·비율·지수 눈금
for (const say of ['열 주로 쪼개면 주가도 10분의 1이 됩니다.', '지난 1년 동안 가장 높은 주가입니다.', '0부터 100으로 나타낸 숫자입니다.', '52주 신고가라고 합니다.'])
  assert.equal(checkEvergreen(withScene({ say })).ok, true, say);
// [5] 사라·팔라 금지
assert.equal(checkEvergreen(withScene({ say: '그래서 지금 사세요.' })).ok, false);
assert.equal(checkEvergreen(withScene({ say: '이런 종목은 매수 추천합니다.' })).ok, false);
// [6] 화면에 들어가는 길이 — 훅은 두 줄(11자×2)을 넘으면 앞이 잘려 나간다(shorts-layout fitHook)
assert.equal(checkEvergreen(withScene({ hook: '이 훅은 두 줄 스물두 글자를 훌쩍 넘겨서 앞이 잘린다' })).ok, false);
assert.equal(checkEvergreen(withScene({ say: '짧다' })).ok, false);
assert.equal(checkEvergreen({ ...ok, title: '제목이 너무 길어서 쇼츠 피드에서는 앞부분만 보이고 뒤쪽 절반은 시청자에게 잘려서 보이지 않는다' }).ok, false);
assert.equal(checkEvergreen({ ...ok, scenes: [ok.scenes[0]] }).ok, false, '장면 하나');
// [7] 그림 설명이 없으면 못 만든다
assert.equal(checkEvergreen(withScene({ image: '' })).ok, false);
// [8] 제목에도 같은 규칙
assert.equal(checkEvergreen({ ...ok, title: '오늘 코스피 급등 이유' }).ok, false);

// [9] 실제 풀 대본 전부 통과, id 겹침 없음
const data = JSON.parse(readFileSync(resolve(ROOT, 'data/evergreen-shorts.json'), 'utf8'));
const ids = new Set();
for (const it of data.items) {
  const r = checkEvergreen(it);
  assert.equal(r.ok, true, `${it.id}: ${r.why.join(' · ')}`);
  assert.ok(!ids.has(it.id), `id 겹침 ${it.id}`);
  ids.add(it.id);
}
assert.ok(data.items.length >= 15, `36시간치(15편) 이상: ${data.items.length}`);

console.log(`evergreen-check.test: ✅ ${data.items.length}편 포함 전부 통과`);
