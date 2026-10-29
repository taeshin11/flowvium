// rule-freeze.test.mjs — 전향 연구 기간 규칙 점수 동결. node scripts/lib/rule-freeze.test.mjs
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freezeOf } from './rule-freeze.mjs';

const dir = mkdtempSync(join(tmpdir(), 'rule-freeze-'));
const f = join(dir, 'rule-freeze.json');
writeFileSync(f, JSON.stringify({ from: '2026-10-31', until: '2026-12-26', why: 'v0.3' }));
const at = (s) => Date.parse(s);
// [1] 기간 안이면 동결, 이유를 돌려준다
assert.equal(freezeOf(at('2026-11-07T19:20:00Z'), f).frozen, true);
assert.match(freezeOf(at('2026-11-07T19:20:00Z'), f).why, /v0\.3/);
// [2] 시작 전·끝난 뒤(끝 날 하루 전체 포함)
assert.equal(freezeOf(at('2026-10-30T12:00:00Z'), f).frozen, false);
assert.equal(freezeOf(at('2026-12-26T14:00:00Z'), f).frozen, true, '끝 날(KST 23시)은 포함');
assert.equal(freezeOf(at('2026-12-26T15:00:00Z'), f).frozen, false, 'KST 12/27 0시부터 풀림');
// [3] 파일이 없거나 깨졌으면 동결 아님 — 그리고 그 사실을 알린다(조용히 넘어가지 않게)
assert.deepEqual(freezeOf(at('2026-11-07T00:00:00Z'), join(dir, 'none.json')), { frozen: false, why: null });
writeFileSync(f, '{깨진');
assert.equal(freezeOf(at('2026-11-07T00:00:00Z'), f).frozen, false);
assert.match(freezeOf(at('2026-11-07T00:00:00Z'), f).error, /읽지 못함/);
// [4] 날짜가 빠지거나 거꾸로면 동결 아님 + 오류
writeFileSync(f, JSON.stringify({ from: '2026-12-26', until: '2026-10-31' }));
assert.equal(freezeOf(at('2026-11-07T00:00:00Z'), f).frozen, false);
assert.match(freezeOf(at('2026-11-07T00:00:00Z'), f).error, /날짜/);
console.log('rule-freeze.test: ✅ 전부 통과');
