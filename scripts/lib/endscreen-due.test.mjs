// endscreen-due.test.mjs — 롱폼 최종 화면 달 편 고르기. node scripts/lib/endscreen-due.test.mjs
// 11/02 사장님 KPI 보고 보충(Mac mini2 경유): 새 롱폼에 최종 화면(관련 영상 '시청자 맞춤' 1 + 구독 1)을 단다. 새 편만(11/02 부터), 11/16 클릭률 측정.
//   Data API 에 최종 화면이 없어 스튜디오 편집기(헤드리스 youtube-profile)로 단다(scripts/yt-endscreen.mjs).
//   올린 직후엔 처리가 안 끝나 편집기가 없을 수 있다 → 30분 지난 편부터, 실패하면 다음 회차에 다시(최대 3번).
import assert from 'node:assert/strict';
import { dueForEndscreen, ENDSCREEN_FROM } from './endscreen-due.mjs';
const now = Date.parse('2026-11-02T12:00:00Z');
const h = [
  { id: 'old', privacy: 'public', at: '2026-10-28T09:00:00Z' },                 // 11/02 전 — 안 단다
  { id: 'new1', privacy: 'public', at: '2026-11-02T10:00:00Z' },                // 2시간 전 — 단다
  { id: 'fresh', privacy: 'public', at: '2026-11-02T11:50:00Z' },               // 10분 전 — 아직
  { id: 'priv', privacy: 'private', at: '2026-11-02T09:00:00Z' },               // 비공개 — 안 단다
  { id: 'sched', privacy: 'public', publishAt: '2026-11-02T09:00:00Z', at: '2026-11-02T08:00:00Z' },   // 예약 — 공개 시각 지났으면 단다
  { id: 'done', privacy: 'public', at: '2026-11-02T09:00:00Z' },
  { id: 'tried3', privacy: 'public', at: '2026-11-02T09:00:00Z' },
  { privacy: 'public', at: '2026-11-02T09:00:00Z' },                           // id 없음(업로드 실패)
];
const state = { done: { done: { at: '2026-11-02T09:40:00Z' } }, tries: { tried3: 3, new1: 1 } };
assert.equal(ENDSCREEN_FROM, '2026-11-02');
assert.deepEqual(dueForEndscreen(h, state, now), ['new1', 'sched']);
assert.deepEqual(dueForEndscreen([], {}, now), []);
console.log('endscreen-due.test: ✅ 전부 통과');
