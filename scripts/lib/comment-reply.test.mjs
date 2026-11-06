// comment-reply.test.mjs — 시청자 댓글 답글 규칙(10/27 사장님, Mac mini2 경유). node scripts/lib/comment-reply.test.mjs
import assert from 'node:assert/strict';
import * as CR from './comment-reply.mjs';
const { checkReply, pickTargets, CAP_PER_VIDEO, CAP_PER_DAY } = CR;

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
// '사라' 는 낱말일 때만 — '회사라면'·'사라졌다' 는 권유가 아니다(10/28 상시 쇼츠 대본에서 오탐)
assert.equal(checkReply('이익이 줄 회사라면 PER 이 낮아도 비쌉니다.').ok, true);
assert.equal(checkReply('그 이슈는 금방 사라졌습니다.').ok, true);
assert.equal(checkReply('지금 사라, 늦으면 없다').ok, false);
// [3] 상품 링크 질문은 고정 댓글로 안내 — 이건 된다
assert.equal(checkReply('링크는 고정 댓글에 있습니다.').ok, true);

// [4] 고르기: 우리 댓글·이미 답한 것·7일 넘은 것 빼고, 영상당 10·하루 30 (11/07 — 종전 24시간·5·20)
const now = Date.parse('2026-10-27T13:00:00Z');
const mk = (i, vid, o = {}) => ({ id: `c${i}`, videoId: vid, publishedAt: new Date(now - 3600e3).toISOString(), authorId: 'viewer', repliedByUs: false, ...o });
const threads = [
  mk(0, 'v1', { authorId: 'US' }), mk(1, 'v1', { repliedByUs: true }), mk(2, 'v1', { publishedAt: new Date(now - 8 * 24 * 3600e3).toISOString() }), mk(3, 'v1', { publishedAt: new Date(now - 30 * 3600e3).toISOString() }),
  ...Array.from({ length: 12 }, (_, i) => mk(10 + i, 'v1')), ...Array.from({ length: 40 }, (_, i) => mk(100 + i, `w${i}`)),
];
const picked = pickTargets(threads, { channelId: 'US', now, ledger: {} });
assert.ok(!picked.some((t) => ['c0', 'c1', 'c2'].includes(t.id)));
assert.ok(picked.some((t) => t.id === 'c3'), '30시간 된 댓글도 7일 안이면 고른다');
assert.equal(picked.filter((t) => t.videoId === 'v1').length, CAP_PER_VIDEO);
assert.equal(picked.length, CAP_PER_DAY);
// [5] 오늘 이미 답한 수를 센다(원장) — 하루 상한은 한 번 실행이 아니라 하루치
const ledger = Object.fromEntries(Array.from({ length: 28 }, (_, i) => [`old${i}`, { at: new Date(now - 3600e3).toISOString(), videoId: `z${i}`, status: 'replied' }]));
assert.equal(pickTargets(threads, { channelId: 'US', now, ledger }).length, 2);
// [6] 원장에 있는(건너뛴 것 포함) 댓글은 다시 고르지 않는다
assert.ok(!pickTargets(threads, { channelId: 'US', now, ledger: { c10: { status: 'skipped', at: new Date(now).toISOString() } } }).some((t) => t.id === 'c10'));
console.log('comment-reply ok');

// ── 2026-11-07 사장님 "전 세션 대댓글도 잘 달아서 팬 관리해"(Mac mini2 경유) ──
// [7] agy 는 분류를 JSON '글' 로 돌려준다. 종전 코드는 r.category 를 바로 봐서 늘 undefined → '다음 시간에 다시' → 24시간 뒤 사라짐.
//   10/27~11/07 비정치 영상 댓글을 한 번도 분류하지 못했다(원장 14건 전부 '정치 영상', 답글 0).
assert.equal(typeof CR.parseClassify, 'function', '[7] parseClassify 없음');
assert.equal(CR.parseClassify('{"category":"thanks","reply":"고맙습니다"}')?.category, 'thanks');
assert.equal(CR.parseClassify('```json\n{"category":"question","reply":null}\n```')?.category, 'question');
assert.equal(CR.parseClassify({ category: 'spam' })?.category, 'spam');
assert.equal(CR.parseClassify('작업을 완료했습니다'), null);
assert.equal(CR.parseClassify(null), null);
// [8] 상한: 영상당 하루 10, 계정 하루 30. 댓글은 7일까지 본다(새 댓글은 매시라 1시간 안).
assert.equal(CAP_PER_VIDEO, 10); assert.equal(CAP_PER_DAY, 30); assert.equal(CR.MAX_AGE_H, 168);
// [9] 7일 넘은 영상은 질문 댓글에만 답한다.
assert.equal(CR.allowedForVideo({ videoAgeDays: 3, category: 'thanks' }), true);
assert.equal(CR.allowedForVideo({ videoAgeDays: 9, category: 'thanks' }), false);
assert.equal(CR.allowedForVideo({ videoAgeDays: 9, category: 'question' }), true);
// [10] 같은 문장 복붙 금지 — 최근 답글과 거의 같으면 버린다(띄어쓰기·문장부호 무시).
assert.equal(CR.tooSimilar('시청해 주셔서 감사합니다! 다음에도 찾아뵙겠습니다.', ['시청해주셔서 감사합니다 다음에도 찾아뵙겠습니다']), true);
assert.equal(CR.tooSimilar('하이브 3분기 매출은 1.5조원이었습니다.', ['시청해 주셔서 감사합니다!']), false);
// [11] 단골(두 번 이상 댓글) 이름 — 자동 생성 핸들(@user-ab12c·끝이 -영숫자5)은 부르지 않고 앞 이름만.
assert.equal(CR.regularName('@마도사-o1c', 2), '마도사');
assert.equal(CR.regularName('@hyunsookpark1101', 3), 'hyunsookpark1101');
assert.equal(CR.regularName('@user-xk9qz8', 4), null);
assert.equal(CR.regularName('@마도사-o1c', 1), null);
console.log('comment-reply 11/07 ok');
