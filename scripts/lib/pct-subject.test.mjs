// pct-subject.test.mjs — verify-report 의 '무주어 등락%' 검사. node scripts/lib/pct-subject.test.mjs
import assert from 'node:assert/strict';
import { subjectlessPctCount } from '../verify-report.mjs';

// [1] 원래 잡으려던 것: 대상 없는 "N주 기준 X%" (7/04 noon EWY 오독형)
assert.equal(subjectlessPctCount('외국인 자금이 빠지며 1주 기준 -12.1% 밀렸습니다.'), 1);
// [2] 대상이 있으면 통과
assert.equal(subjectlessPctCount('EWY 가 1주 기준 -12.1% 밀렸습니다.'), 0);
assert.equal(subjectlessPctCount('코스피는 1주 기준 -3.2% 내렸습니다.'), 0);
// [3] 10/30 midnight 실제 문장: 두 대상 사이 격차(%포인트)는 등락이 아니다
assert.equal(subjectlessPctCount('대체자산(alts)에서 원유(oil)로 옮겨가는 로테이션 조짐이 1주 기준 7.9%포인트의 수익률 격차로 확인되는데'), 0);
assert.equal(subjectlessPctCount('두 자산 차이가 1주 기준 4.1%p 벌어졌다'), 0);
// [4] 격차 표현이 섞여도 진짜 무주어 등락은 그대로 센다
assert.equal(subjectlessPctCount('격차는 1주 기준 7.9%포인트. 그리고 2주 기준 -8.0% 빠졌다.'), 1);
console.log('pct-subject.test: ✅ 전부 통과');
