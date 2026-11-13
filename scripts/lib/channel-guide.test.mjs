// channel-guide.test.mjs — FlowVium 쇼츠 주간 채널 지침. node --test scripts/lib/channel-guide.test.mjs
// 왜(11/12 사장님 지시, Mac mini2 경유 "AI·자동화 감지로 계정 제한 안 당하게"): 반복·대량생산 정책에 걸리지 않도록
//   템플릿 복붙을 줄이고 편마다 구성을 다르게. 11/16(월)부터 매주 지난 성적으로 지침 1장을 다시 쓰고 제작은 그 파일만 따른다.
// 구성 갈래(layout·opener·motion)는 지금까지 explore-slot 의 고정 비율(25/75·50/50·50/50)로 돌았다 — 성적을 안 봤다.
// 잰 방법은 topic-lift 와 같다(48시간 근처 조회 ÷ 같은 날 또래 중앙값). 표본이 적으면 판단하지 않고 반반.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGuide, armFor, pickCombo, DEFAULT_GUIDE } from './channel-guide.mjs';

// 하루 또래 4편씩 8일 — zoom 은 또래 중앙(1,200)의 1.5~1.7배, classic 은 0.4~0.5배
const rows = [];
for (let d = 1; d <= 8; d++) {
  const pub = `2026-11-${String(d).padStart(2, '0')}T03:00:00Z`;
  [['zoom', 2000], ['zoom', 1800], ['classic', 500], ['classic', 600]].forEach(([layout, v], i) => {
    rows.push({ video_id: `v${d}-${i}`, views: v, age_hours: 48, published_at: pub, layout, opener: i % 2 ? 'anchor' : 'question', motion: 'still' });
  });
}

test('성적이 갈리면 비중이 따라가되 바닥 20% 는 남긴다', () => {
  const g = buildGuide(rows, { now: Date.parse('2026-11-16T00:00:00Z') });
  // lift 비례: zoom 1.583 / (1.583 + classic 0.458) = 0.776 → 0.78
  assert.equal(g.levers.layout.shares.zoom, 0.78);
  assert.equal(g.levers.layout.shares.classic, 0.22);
  // 한쪽이 압도해도 바닥은 남는다
  const g2 = buildGuide(rows.map((r) => (r.layout === 'classic' ? { ...r, views: 10 } : r)), { now: Date.parse('2026-11-16T00:00:00Z') });
  assert.equal(g2.levers.layout.shares.classic, 0.2);
  assert.ok(g.levers.layout.evidence.zoom.lift > 1);
});

test('표본이 모자란 갈래는 판단하지 않고 반반 — motion 은 push 가 0편', () => {
  const g = buildGuide(rows, { now: Date.parse('2026-11-16T00:00:00Z') });
  assert.deepEqual(g.levers.motion.shares, { push: 0.5, still: 0.5 });
  assert.match(g.levers.motion.why, /표본/);
});

test('지침이 없으면 지금까지의 비율(기본값)', () => {
  assert.deepEqual(DEFAULT_GUIDE.levers.layout.shares, { classic: 0.25, zoom: 0.75 });
});

test('armFor: 같은 편 번호면 같은 답, 비중대로 갈린다', () => {
  const g = { levers: { layout: { shares: { classic: 0.2, zoom: 0.8 } } } };
  assert.equal(armFor(17, 'layout', g), armFor(17, 'layout', g));
  const n = 2000;
  const z = Array.from({ length: n }, (_, i) => armFor(i, 'layout', g)).filter((x) => x === 'zoom').length / n;
  assert.ok(z > 0.75 && z < 0.85, `zoom 비율 ${z}`);
});

test('바로 앞 편과 구성이 똑같으면 하나를 바꾼다', () => {
  const g = DEFAULT_GUIDE;
  for (let seed = 0; seed < 200; seed++) {
    const prev = pickCombo(seed, g, null);
    const next = pickCombo(seed + 1, g, prev);
    assert.notDeepEqual(next, prev, `seed ${seed}`);
  }
});

test('상시 쇼츠처럼 일부 갈래만 쓰는 곳 — 그 갈래만 고르고 비교한다', () => {
  for (let seed = 0; seed < 200; seed++) {
    const prev = pickCombo(seed, DEFAULT_GUIDE, null, ['layout', 'motion']);
    assert.deepEqual(Object.keys(prev), ['layout', 'motion']);
    const next = pickCombo(seed + 1, DEFAULT_GUIDE, { ...prev, opener: null }, ['layout', 'motion']);
    assert.notDeepEqual(next, prev, `seed ${seed}`);
  }
});

import { validGuide, guideMarkdown } from './channel-guide.mjs';
test('깨진 지침은 쓰지 않는다 — 비중 합이 1 이 아니거나 모르는 갈래', () => {
  assert.equal(validGuide({ levers: { layout: { shares: { classic: 0.9, zoom: 0.9 } } } }), false);
  assert.equal(validGuide({ levers: { layout: { shares: { classic: 0.5, wide: 0.5 } } } }), false);
  assert.equal(validGuide(DEFAULT_GUIDE), true);
  assert.equal(validGuide(null), false);
});
test('지침 1장(사람이 읽는 판) — 갈래마다 비중과 이유', () => {
  const md = guideMarkdown(buildGuide(rows, { now: Date.parse('2026-11-16T00:00:00Z') }));
  assert.match(md, /^# FlowVium 쇼츠 채널 지침/m);
  assert.match(md, /zoom 78%/);
  assert.match(md, /표본 부족/);
});

import { loadGuide } from './channel-guide.mjs';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
test('loadGuide: 없거나 깨진 파일 → 기본값, 맞는 파일 → 그 파일', () => {
  const d = mkdtempSync(join(tmpdir(), 'guide-'));
  assert.equal(loadGuide(join(d, 'none.json')), DEFAULT_GUIDE);
  writeFileSync(join(d, 'bad.json'), '{"levers":{"layout":{"shares":{"classic":2}}}}');
  assert.equal(loadGuide(join(d, 'bad.json')), DEFAULT_GUIDE);
  const ok = buildGuide(rows, { now: 0 });
  writeFileSync(join(d, 'ok.json'), JSON.stringify(ok));
  assert.deepEqual(loadGuide(join(d, 'ok.json')).levers.layout.shares, ok.levers.layout.shares);
});
