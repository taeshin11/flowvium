// comment-reply.test.mjs — 시청자 댓글 답글 규칙(10/27 사장님, Mac mini2 경유). node scripts/lib/comment-reply.test.mjs
import assert from 'node:assert/strict';
import { checkReply, pickTargets, CAP_PER_VIDEO, CAP_PER_DAY } from './comment-reply.mjs';

// [1] 답글 꼴: 1~2줄, 링크·쿠팡·구독 부탁 없음
assert.equal(checkReply('좋은 질문입니다. 발표는 다음 주 화요일입니다.').ok, true);
assert.equal(checkReply('자세한 건 https://flowvium.net 에서').ok, false);
assert.equal(checkReply('flowvium.net 참고하세요').ok, false);
assert.equal(checkReply('쿠팡 링크는 여기').ok, false);
assert.equal(checkReply('구독 부탁드려요!').ok, false);
assert.equal(checkReply('한 줄\n두 줄\n세 줄').ok, false);
assert.equal(checkReply('').ok, false);
// [2] 종목 질문: 사라·팔라 금지, '투자 권유가 아닙니다' 한 줄 필수
assert.equal(checkReply('지금 사세요.', { stock: true }).ok, false);
assert.equal(checkReply('3분기 실적 발표는 11월 5일입니다.', { stock: true }).ok, false);
assert.equal(checkReply('3분기 실적 발표는 11월 5일입니다.\n투자 권유가 아닙니다.', { stock: true }).ok, true);
assert.equal(checkReply('Earnings are due Nov 5.\nNot investment advice.', { stock: true, lang: 'en' }).ok, true);
assert.equal(checkReply('매수 추천합니다.\n투자 권유가 아닙니다.', { stock: true }).ok, false);
// [3] 상품 링크 질문은 고정 댓글로 안내 — 이건 된다
assert.equal(checkReply('링크는 고정 댓글에 있습니다.').ok, true);

// [4] 고르기: 우리 댓글·이미 답한 것·24시간 넘은 것 빼고, 영상당 5·하루 20
const now = Date.parse('2026-10-27T13:00:00Z');
const mk = (i, vid, o = {}) => ({ id: `c${i}`, videoId: vid, publishedAt: new Date(now - 3600e3).toISOString(), authorId: 'viewer', repliedByUs: false, ...o });
const threads = [
  mk(0, 'v1', { authorId: 'US' }), mk(1, 'v1', { repliedByUs: true }), mk(2, 'v1', { publishedAt: new Date(now - 25 * 3600e3).toISOString() }),
  ...Array.from({ length: 8 }, (_, i) => mk(10 + i, 'v1')), ...Array.from({ length: 30 }, (_, i) => mk(100 + i, `w${i}`)),
];
const picked = pickTargets(threads, { channelId: 'US', now, ledger: {} });
assert.ok(!picked.some((t) => ['c0', 'c1', 'c2'].includes(t.id)));
assert.equal(picked.filter((t) => t.videoId === 'v1').length, CAP_PER_VIDEO);
assert.equal(picked.length, CAP_PER_DAY);
// [5] 오늘 이미 답한 수를 센다(원장) — 하루 상한은 한 번 실행이 아니라 하루치
const ledger = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`old${i}`, { at: new Date(now - 3600e3).toISOString(), videoId: `z${i}`, status: 'replied' }]));
assert.equal(pickTargets(threads, { channelId: 'US', now, ledger }).length, 2);
// [6] 원장에 있는(건너뛴 것 포함) 댓글은 다시 고르지 않는다
assert.ok(!pickTargets(threads, { channelId: 'US', now, ledger: { c10: { status: 'skipped', at: new Date(now).toISOString() } } }).some((t) => t.id === 'c10'));
console.log('comment-reply ok');
