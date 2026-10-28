// ad-line.test.mjs — AISVI 광고 새 판(2026-10-28 사장님, IR 세션·Mac mini2 경유). node scripts/lib/ad-line.test.mjs
//   10/24·10/27 aisviagent.com 실제 사람 방문 0. 눌리는 자리(롱폼 설명란·채널 링크·블로그 본문)에 utm 링크,
//   주식 시청자용 한 줄 2~3판을 돌린다. 최고/최초 금지, 긴 설명 금지.
import assert from 'node:assert/strict';
import { AD_VERSIONS, AD_CTA, AD_SPOKEN_BY, AD_WHERE, adVersionFor, adUrl, adText, withAdLine, withBlogAd, AD_LINE } from './ad-line.mjs';
import { mdToHtml } from './blog-html.mjs';

// [1] 판은 세 개, 각각 한 줄 · 과장어 없음 · 사이트가 실제로 하는 일(질문·요약·엑셀 다루기)
assert.deepEqual(Object.keys(AD_VERSIONS), ['a', 'b', 'c']);
for (const [v, t] of Object.entries(AD_VERSIONS)) {
  assert.ok(!/\n/.test(t) && t.length <= 26, `${v} 한 줄·짧게: ${t}`);
  assert.ok(!/최고|최초|1위|유일|완벽/.test(t), `${v} 과장어: ${t}`);
}
assert.equal(AD_CTA, '바로 써 보기');
// [2] 돌리기 — 세 판이 고르게, 같은 씨앗은 같은 판
const seq = Array.from({ length: 9 }, (_, n) => adVersionFor(n));
assert.deepEqual(seq, ['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c']);
assert.equal(adVersionFor('PER 제목'), adVersionFor('PER 제목'));
assert.ok(['a', 'b', 'c'].includes(adVersionFor('아무 제목')));
// [3] 주소 — 지정한 utm 그대로
assert.equal(adUrl({ source: 'naver', medium: 'post_body', version: 'b' }),
  'https://aisviagent.com/?utm_source=naver&utm_medium=post_body&utm_campaign=flowvium&utm_content=b');
assert.throws(() => adUrl({ source: 'x', medium: 'post_body', version: 'a' }), /source/);
assert.throws(() => adUrl({ source: 'youtube', medium: 'post_body', version: 'z' }), /version/);
// [4] 글 — 한 줄 + 바로 써 보기 + 주소
assert.equal(adText({ source: 'blogger', medium: 'post_body', version: 'a' }),
  `AISVI · ${AD_VERSIONS.a} — 바로 써 보기\nhttps://aisviagent.com/?utm_source=blogger&utm_medium=post_body&utm_campaign=flowvium&utm_content=a`);
// [5] 설명란 — 맨 아래 두 줄, 두 번 붙이지 않는다, 5000자 한도, 옛 한 줄이 있으면 새 판으로 바꾼다
const o = { source: 'youtube', medium: 'description', version: 'c' };
const d = withAdLine('본문\n\n※ 투자 권유 아님', o);
assert.ok(d.startsWith('본문') && d.endsWith(adText(o)), d);
assert.equal(withAdLine(d, o), d);
assert.equal(withAdLine(d, { ...o, version: 'a' }), d, '이미 붙은 판은 그대로(다시 돌리지 않는다)');
const lg = withAdLine('가'.repeat(6000), o);
assert.ok(lg.length <= 5000 && lg.endsWith(adText(o)));
assert.equal(withAdLine(`본문\n\n${AD_LINE}`, o), `본문\n\n${adText(o)}`, '옛 한 줄 → 새 판');
// [6] 댓글용 옛 한 줄은 그대로(링크 댓글 스팸 필터 — 10/08 사장님 '도메인만 짧게')
assert.ok(/aisviagent\.com/.test(AD_LINE) && !/utm_/.test(AD_LINE));
// [7] 블로그 본문 — 끝 면책 인용 바로 위에 한 단락, 주소는 눌리는 링크, 두 번 넣지 않는다
{
  const md = '# 제목\n\n본문 단락\n\n> 이 글은 매수·매도를 권하지 않습니다.\n';
  const b = { source: 'naver', medium: 'post_body', version: 'a' };
  const out = withBlogAd(md, b);
  assert.ok(out.indexOf(adText(b)) > out.indexOf('본문 단락') && out.indexOf(adText(b)) < out.indexOf('> 이 글은'), out);
  assert.equal(withBlogAd(out, b), out);
  const html = mdToHtml(out);
  assert.ok(html.includes(`<a href="${adUrl(b).replace(/&/g, '&amp;')}"`), html);
  assert.ok(withBlogAd('본문만', b).endsWith(adText(b)), '면책이 없으면 맨 끝');
}
// [8] 끝 카드 소리(10/28 사장님 — "에이스비, 지금 바로 써 보세요" 는 모르는 이름에 이득이 없다).
//   판마다 그 판이 하는 일을 말한다 · 발음은 에이스비 · 어디로 가는지는 화면 작은 글씨(쇼츠 채널 링크 / 롱폼 설명란).
assert.deepEqual(Object.keys(AD_SPOKEN_BY), Object.keys(AD_VERSIONS));
const KEY = { a: /뉴스/, b: /종목/, c: /매매 기록/ };
for (const [v, t] of Object.entries(AD_SPOKEN_BY)) {
  assert.ok(t.includes('에이스비') && !/AISVI|에이전트/.test(t), `${v} 발음: ${t}`);
  assert.ok(KEY[v].test(t) && KEY[v].test(AD_VERSIONS[v]), `${v} 소리와 글자가 같은 일: ${t} / ${AD_VERSIONS[v]}`);
  assert.ok(!/지금 바로 써 보세요/.test(t), `${v} 옛 말`);
}
assert.equal(AD_WHERE.shorts, '채널 링크에서');
assert.equal(AD_WHERE.long, '설명란 링크');
console.log('ad-line.test: ✅ 전부 통과');
