/**
 * build-drift.test.mjs — src 를 고치고 빌드를 잊으면 조용히 배포가 안 된다.
 *
 * 왜 (2026-09-10): 웹 레인은 `next start` 로 뜬다 — 프로덕션 빌드다.
 *   그런데 어디에도 자동 빌드가 없다. cron-runner 에도, run-report.sh 에도 없다.
 *   즉 src/ 를 고쳐도 누군가 손으로 `next build` 를 하지 않으면 **영원히 배포되지 않는다.**
 *   flowvium.net 은 이 로컬 서버로 터널되므로 그게 곧 라이브다.
 *   고쳤다고 커밋까지 했는데 사용자는 옛 코드를 계속 보는 상황이 조용히 성립한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driftingFiles, buildStamp } from './build-drift.mjs';

test('빌드 시각을 읽는다', () => {
  const t = buildStamp();
  assert.ok(t === null || typeof t === 'number', '없으면 null, 있으면 mtime');
});

test('빌드보다 새로운 src 파일을 찾아낸다', () => {
  const files = driftingFiles();
  assert.ok(Array.isArray(files));
  for (const f of files) assert.match(f, /^src\//, 'src 아래만 본다');
});

test('빌드가 없으면 전부 드리프트로 본다 — 없는 걸 정상이라 하지 않는다', () => {
  const files = driftingFiles({ stamp: null });
  assert.ok(files.length > 0, '빌드가 아예 없으면 배포된 것이 없다');
});

test('빌드가 미래면 드리프트 0 — 방금 빌드한 상태', () => {
  assert.deepEqual(driftingFiles({ stamp: Date.now() + 86400000 }), []);
});
