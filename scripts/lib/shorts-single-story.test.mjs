// shorts-single-story.test.mjs — 쇼츠는 한 편에 뉴스 하나가 먼저, 묶음(브리핑)은 마지막 시도에만. node scripts/lib/shorts-single-story.test.mjs
//
// 11/02 사장님 성장 점검(Mac mini2 경유) 벤치마크: 경제 쇼츠 상위 10편은 모두 한 편에 한 주제.
//   우리 48시간 189편: 뉴스 1개 편 조회 중앙 1,110 vs 2~5개 묶음 1,033~1,046, 100회 미만(노출 실패) 0편 vs 6편.
//   자문 agy(gemini-4-argon-medium)·Claude 둘 다 '1영상 1뉴스' 1~2순위(2/3 합의).
// 묶음은 9/06 사장님 "소재가 모자라면 여러 개 붙여서 올려도 되잖아"로 생겼다 — 없애면 슬롯이 빈다.
//   그래서 첫 이슈의 사진이 모자라면 먼저 다른 이슈로 한 편을 만들어 보고(발행이 3번 시도), 마지막 시도에서만 묶는다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { briefAllowed } = await import('./brief-scenes.mjs');
assert.equal(briefAllowed({}), true, '손으로 돌릴 땐 종전대로 묶을 수 있다');
assert.equal(briefAllowed({ SHORTS_BRIEF_OK: '0' }), false, '발행의 앞 시도는 묶지 않는다');
assert.equal(briefAllowed({ SHORTS_BRIEF_OK: '1' }), true, '마지막 시도는 묶어도 된다');
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ms = src('video/make-shorts.mjs'), pub = src('video-publish.mjs');
assert.ok(/if \(lead\.length < 2 && !briefAllowed\(\)\)[\s\S]{0,400}last-issue\.txt[\s\S]{0,200}process\.exit\(3\)/.test(ms), '묶지 못하면 이 이슈를 적고 3(낼 것 없음)으로 — 발행이 다른 이슈로 다시 부른다');
assert.ok(/SHORTS_BRIEF_OK: a >= TRIES \? '1' : '0'/.test(pub), '발행은 마지막 시도에만 묶음을 허락한다');
console.log('shorts-single-story.test: ✅ 전부 통과');
