// seo-verification.test.mjs — 검색엔진 소유 확인 코드는 여러 개를 같이 낸다. node scripts/lib/seo-verification.test.mjs
// 왜(11/08): 구글 새 속성 코드를 받았는데 이미 한 코드가 나가고 있었다 — 바꾸면 기존 확인이 풀릴 수 있어 둘 다 낸다.
//   기존 값은 .env.local 에 "…\n" 꼴로 들어가 있어 meta content 끝에 줄바꿈이 붙어 나갔다(11/08 실측).
import assert from 'node:assert/strict';
import { verificationCodes } from '../../src/lib/seo-verification.mjs';

// [1] 쉼표·공백·줄바꿈으로 나눈다, 앞뒤 공백·빈 칸은 버린다
assert.deepEqual(verificationCodes('old123\n,new-456_x'), ['old123', 'new-456_x']);
// [2] 하나면 하나
assert.deepEqual(verificationCodes('only'), ['only']);
// [3] 없으면 빈 배열(태그 안 나감)
assert.deepEqual(verificationCodes(undefined), []);
assert.deepEqual(verificationCodes('  \n '), []);
// [4] 같은 코드 두 번은 한 번
assert.deepEqual(verificationCodes('a,a'), ['a']);
console.log('seo-verification.test: 4/4 통과');
