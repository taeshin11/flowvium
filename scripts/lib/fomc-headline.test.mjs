import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fomcHeadline } from '../../src/lib/fomc-headline.mjs';

// 2026-11-11 실측 nextMeeting — 인상 100% 인데 배지는 인하 확률 "Dec 10 0%" 만 보여 본문과 반대로 읽혔다.
const dec10 = { label: 'Dec 10', probHike: 100, probHike50: 18, probHold: 0, probCut25: 0, probCut50: 0, probCut75: 0 };

test('인상이 가장 유력하면 인상과 그 확률', () => {
  assert.deepEqual(fomcHeadline(dec10), { label: 'Dec 10', kind: 'hike', prob: 100 });
});

test('인하는 25·50·75bp 를 합쳐 비교한다', () => {
  const m = { label: 'Jan 28', probHike: 0, probHold: 40, probCut25: 35, probCut50: 20, probCut75: 5 };
  assert.deepEqual(fomcHeadline(m), { label: 'Jan 28', kind: 'cut', prob: 60 });
});

test('동결이 가장 크면 동결', () => {
  const m = { label: 'Mar 18', probHike: 3, probHold: 90.4, probCut25: 6.6, probCut50: 0, probCut75: 0 };
  assert.deepEqual(fomcHeadline(m), { label: 'Mar 18', kind: 'hold', prob: 90 });
});

test('라벨이나 확률이 없으면 null — 빈 배지를 데이터로 그리지 않는다', () => {
  assert.equal(fomcHeadline(null), null);
  assert.equal(fomcHeadline({ label: '', probHold: 50 }), null);
  assert.equal(fomcHeadline({ label: 'Dec 10' }), null);
});
