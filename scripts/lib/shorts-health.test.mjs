/**
 * shorts-health.test.mjs — 조회수 추세 판정.
 *
 * 왜 (2026-09-09): "조회수가 떨어졌다" 를 손으로 쿼리해서야 알았다. 그것도 3일 늦게.
 *   최종 조회수를 그냥 비교하면 **오늘 올린 편이 항상 져서** 매일 "하락" 이 나온다.
 *   나이를 맞춰야(발행 후 같은 시간) 비교가 된다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medianAtAge, dailyTrend, verdict } from './shorts-health.mjs';

const S = (id, day, age, views) => ({ video_id: id, day, age_hours: age, views });

test('medianAtAge: 창 안의 표본만, 영상당 하나씩', () => {
  const rows = [S('a','d',7,100), S('a','d',9,120), S('b','d',8,300), S('c','d',30,9999)];
  // a 는 창 안에 둘 → 하나로 접는다. c 는 창 밖 → 제외. 중앙값(120,300) = 300
  assert.equal(medianAtAge(rows, 6, 12), 300);
});

test('medianAtAge: 표본이 없으면 null — 0 이라고 하지 않는다', () => {
  assert.equal(medianAtAge([S('a','d',30,50)], 6, 12), null);
});

test('나이를 안 맞추면 오늘이 항상 진다 (이 함수가 막는 것)', () => {
  const rows = [S('old','d1',8,1000), S('new','d2',1,50), S('new','d2',8,900)];
  const t = dailyTrend(rows, 6, 12);
  assert.equal(t.find((x) => x.day === 'd2').median, 900);   // 50 이 아니다
});

test('verdict: 최근이 기준선의 절반 밑이면 하락', () => {
  const v = verdict([{ day:'d1', median:1300, n:5 }, { day:'d2', median:1200, n:5 }, { day:'d3', median:300, n:5 }]);
  assert.equal(v.state, 'down');
  assert.match(v.line, /떨어/);
});

test('verdict: 회복하면 회복이라고 말한다', () => {
  const v = verdict([{ day:'d1', median:300, n:5 }, { day:'d2', median:320, n:5 }, { day:'d3', median:900, n:5 }]);
  assert.equal(v.state, 'up');
});

test('verdict: 표본이 모자라면 판정하지 않는다', () => {
  assert.equal(verdict([{ day:'d1', median:300, n:1 }]).state, 'unknown');
});
