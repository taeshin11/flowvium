/**
 * defect-fixes.test.mjs — "코드 fix 필수" 게이트가 fix 후에 풀리는가.
 *
 * 왜 (2026-09-09): audit-coverage 는 같은 결함이 7일에 5회 넘으면 "코드 fix 필수" 로 push 를 막는다.
 *   그런데 **고친 뒤에도 지난 7일 기록이 남아 계속 막았다** — 고쳐도 안 풀리는 게이트는
 *   우회(--no-verify)를 부르고, 그러면 게이트 자체가 무의미해진다.
 *   고친 시점을 기록하고 그 **이후 발생분만** 세면, 고치면 풀리고 재발하면 다시 막힌다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countableSince, stillBroken } from './defect-fixes.mjs';

const H = (type, at) => ({ defect_type: type, detected_at: at });

test('fix 이전 발생분은 세지 않는다', () => {
  const hist = [H('mag', '2026-09-01'), H('mag', '2026-09-02'), H('mag', '2026-09-08')];
  const fixes = { mag: '2026-09-05' };
  assert.equal(countableSince(hist, fixes).length, 1);
});

test('fix 기록이 없으면 전부 센다 — 기본값이 느슨해지면 안 된다', () => {
  const hist = [H('mag', '2026-09-01'), H('mag', '2026-09-08')];
  assert.equal(countableSince(hist, {}).length, 2);
});

test('고친 뒤 재발하면 다시 막는다', () => {
  const after = Array.from({ length: 5 }, (_, i) => H('mag', `2026-09-0${i + 4}`));
  assert.equal(stillBroken(after, { mag: '2026-09-03' }, 5), true);
});

test('고친 뒤 조용하면 풀린다', () => {
  const before = Array.from({ length: 7 }, (_, i) => H('mag', `2026-09-0${i + 1}`));
  assert.equal(stillBroken(before, { mag: '2026-09-09' }, 5), false);
});

test('결함 종류별로 따로 본다 — 하나 고쳤다고 다른 게 풀리지 않는다', () => {
  const hist = [H('mag', '2026-09-08'), ...Array.from({ length: 6 }, () => H('other', '2026-09-08'))];
  assert.equal(stillBroken(hist, { mag: '2026-09-07' }, 5), true);   // other 가 아직 6회
  assert.equal(countableSince(hist, { mag: '2026-09-07' }).filter((h) => h.defect_type === 'mag').length, 1);
});
