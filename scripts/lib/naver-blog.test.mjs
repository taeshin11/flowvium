// naver-blog.test.mjs — 네이버 블로그 게시 전 변환(여백·태그·올릴 글 고르기). node scripts/lib/naver-blog.test.mjs
import assert from 'node:assert/strict';
import { naverHtml, tagsFor, pickFiles, NAVER_CATEGORY } from './naver-blog.mjs';

// [1] 덩어리 뒤에 빈 줄 하나 — 편집기는 붙여 넣은 문단 사이 여백을 없앤다(10/26 화면에서 확인).
assert.equal(naverHtml('<p>a</p>\n<h2>b</h2><ul><li>c</li></ul><table><tr><td>1</td></tr></table>'),
  '<p>a</p><p><br></p>\n<h2>b</h2><ul><li>c</li></ul><p><br></p><table><tr><td>1</td></tr></table><p><br></p>');
// [2] 빈 줄이 겹치지 않는다
assert.equal(naverHtml('<p>a</p><p><br></p><p>b</p>'), '<p>a</p><p><br></p><p>b</p><p><br></p>');

// [3] 태그: 카테고리·주제, 시장은 본문에 있을 때만, 날짜는 넣지 않는다
assert.deepEqual(tagsFor('2026-10-26-morning.md', '코스피 5,550 · 나스닥 25,955'), [NAVER_CATEGORY, '주식', '증시브리핑', '국내증시', '미국증시', '플로비움']);
assert.deepEqual(tagsFor('analysis/x.md', '미국 종목만'), [NAVER_CATEGORY, '주식', '추천성적', '미국증시', '플로비움']);
assert.ok(tagsFor('2026-10-26-morning.md', '').every((t) => !/\d{4}/.test(t)));

// [4] 올릴 글 고르기 — 하루 글은 **오늘** 아침 것만(지난 글을 끌어오지 않는다), 분석 글은 안 올린 것만
const dir = '/r';
const exists = new Set(['/r/2026-10-26-morning.md', '/r/2026-10-25-morning.md']);
const analysis = ['a.md', 'b.md'];
const ledger = { 'analysis/a.md': { url: 'u' } };
const pick = (o) => pickFiles({ dir, today: '2026-10-26', exists: (f) => exists.has(f), analysis, ledger, ...o }).map((x) => x.key);
assert.deepEqual(pick({ daily: true }), ['2026-10-26-morning.md']);
assert.deepEqual(pick({ daily: true, today: '2026-10-27' }), []);
assert.deepEqual(pick({ wantAnalysis: true }), ['analysis/b.md']);
// [5] 이미 올린 하루 글은 다시 고르지 않는다(크론이 하루 두 번 돈다)
assert.deepEqual(pick({ daily: true, ledger: { '2026-10-26-morning.md': { url: 'u' } } }), []);

console.log('naver-blog ok');
