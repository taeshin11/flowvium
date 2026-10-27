// channel-weekly.test.mjs — 주간 비교 묶음·표시. node scripts/lib/channel-weekly.test.mjs
import assert from 'node:assert/strict';
import { weekCompare, mark } from './channel-weekly.mjs';

// [1] ▲ 10% 넘게 · ▼ 10% 넘게 · ■ 그 사이 · 전주 0/없음은 판단 안 함
assert.equal(mark(111, 100), '▲'); assert.equal(mark(89, 100), '▼'); assert.equal(mark(105, 100), '■'); assert.equal(mark(5, 0), '·');

// [2] 최근 주 = endDate 포함 7일, 비율은 합계로 다시(날짜별 비율 평균 아님)
const rows = [];
for (let i = 0; i < 28; i++) {
  const day = new Date(Date.parse('2026-10-25T00:00:00Z') - i * 864e5).toISOString().slice(0, 10);
  rows.push({ day, views: i < 7 ? (i === 0 ? 900 : 100) : 100, subscribersGained: i === 0 ? 9 : 0, subscribersLost: 0, estimatedMinutesWatched: 0, engagedViews: 0, averageViewPercentage: 50, likes: 0, comments: 0, shares: 0, videosAddedToPlaylists: 0 });
}
const r = weekCompare(rows, [], '2026-10-25');
assert.deepEqual(r.weeks[0], { from: '2026-10-19', to: '2026-10-25' });
const v = r.metrics.find((m) => m.name === 'views');
assert.equal(v.last, 1500); assert.equal(v.prev, 700); assert.equal(v.mark, '▲'); assert.equal(v.median28, 700);
assert.equal(r.metrics.find((m) => m.name === 'subsPer1k').last, 6);   // 9 / 1500 * 1000 — 날짜별 평균이면 10/7 ≈ 1.4
assert.equal(v.lowN, false);
console.log('channel-weekly ok');
