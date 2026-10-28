// hook-overlap.test.mjs — 첫 화면 훅이 제목을 되풀이하나(10/28 세 심판 모두 지적: "훅이 제목을 그대로 되풀이해 더하는 게 없다").
//   Mac mini2(사장님 썸네일 기준): 첫 화면 훅은 제목이 말하지 않는 것을 더해야 한다. node scripts/lib/hook-overlap.test.mjs
import assert from 'node:assert/strict';
import { hookOverlap, repeatsTitle } from './hook-overlap.mjs';

// [1] 실제로 떨어진 훅들(10/28 첫 화면 점수 5.5~6.5)
assert.ok(repeatsTitle('PER 낮으면 싼 주식일까', 'PER 낮으면 싼 주식? 꼭 그렇지 않은 이유'));
assert.ok(repeatsTitle('금리 내리면 왜 주가가 뛸까', '금리를 내리면 주가가 오르는 이유'));
assert.ok(repeatsTitle('추미애 제안 지방세제 구조개편', "추미애가 제안한 지방세제 개편을 국회에서 논의하기로 한 이유"));
// [2] 제목에 없는 것을 더한 훅은 통과
assert.ok(!repeatsTitle('싸 보여도 함정일 수 있다', 'PER 낮으면 싼 주식? 꼭 그렇지 않은 이유'));
assert.ok(!repeatsTitle('예금 이자가 줄면 생기는 일', '금리를 내리면 주가가 오르는 이유'));
assert.ok(!repeatsTitle('피자를 더 잘게 잘랐을 뿐', '액면분할 하면 주가가 싸지는 걸까'));
// [3] 한 낱말 겹침(주제어 하나)은 괜찮다 — 주제는 같아야 한다
assert.ok(!repeatsTitle('공포 뒤에 숨은 함정', '공포탐욕지수, 공포일 때 사면 될까'));
// [4] 비율은 0~1, 빈 글은 0
assert.equal(hookOverlap('', '제목'), 0);
assert.ok(hookOverlap('PER 낮으면 싼 주식일까', 'PER 낮으면 싼 주식?') > 0.6);
console.log('hook-overlap.test: ✅ 전부 통과');
