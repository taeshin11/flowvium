// news-topics.test.mjs — 많이 보도된 이슈 고르기(11/07 사장님 "민주당이 이길 거라는 것도 뉴스 전반을 뒤지면 예측 가능하지 않았을까?").
// node scripts/lib/news-topics.test.mjs
import assert from 'node:assert/strict';
import { hotTopics, formatHotTopics, topicTokens, hotTopicsPromptBlock } from './news-topics.mjs';

const now = Date.parse('2026-11-03T20:00:00Z');
const SCAN = new Set(['A', 'B', 'C', 'D', 'E', 'SPAM']);
const h = (hoursAgo, source, headline) => ({ headline, source, captured_at: new Date(now - hoursAgo * 3600e3).toISOString() });
const rows = [];
// 평소에도 늘 나오는 말(stock·market) — 14일 내내 하루 몇 건씩
for (let d = 3; d <= 15; d++) for (const s of ['A', 'B', 'C']) rows.push(h(d * 24, s, `Stocks market wrap day ${d} ${s} tariffs`));
for (const s of ['A', 'B', 'C']) rows.push(h(5, s, `Stocks market wrap today ${s} tariffs`));
// 최근 48시간에 여러 곳이 다루기 시작한 일 — 평소엔 드물다
for (let i = 0; i < 4; i++) for (const s of ['A', 'B', 'C', 'D']) rows.push(h(2 + i * 6, s, `${s}${i}: midterm election could rattle chipmakers`));
rows.push(h(10 * 24, 'A', 'Midterm election campaign kicks off'));
// 한 곳이 하루 100건 쏟아내는 말(배당 공시) — 출처·날짜당 상한에 막혀야 한다
for (let i = 0; i < 100; i++) rows.push(h(1 + (i % 40) * 0.5, 'SPAM', `Fund ${i} declares monthly distribution`));
// 두 곳만 다룬 일 — 최소 출처 수 미달
for (let i = 0; i < 6; i++) rows.push(h(3 + i, i % 2 ? 'A' : 'B', `Obscure widget merger rumor ${i}`));
// 훑지 않는 출처(연예 등)
for (let i = 0; i < 30; i++) rows.push(h(4, 'GOSSIP', `Celebrity wedding scandal ${i}`));
// 한국어 조사: 중간선거에·중간선거가·중간선거 는 같은 말
for (let i = 0; i < 3; i++) for (const [s, t] of [['A', '美 중간선거에 쏠린 눈'], ['B', '중간선거가 반도체에 미칠 영향'], ['E', '중간선거 결과별 시나리오']]) rows.push(h(6 + i * 8, s, `${i}회 ${t}`));
// 미래(now 뒤) 기사는 없어야 한다 — 들어오면 미리 안 셈이 된다
for (const s of ['A', 'B', 'C', 'D']) rows.push({ headline: `Future leak blowout ${s}`, source: s, captured_at: new Date(now + 3600e3).toISOString() });

const topics = hotTopics(rows, { now, scanSources: SCAN });
const words = topics.map((t) => t.word);

// [1] 최근 여러 곳이 다룬 일이 늘 나오는 말보다 위
assert.ok(words.some((w) => w.includes('election')), `election 이 있어야: ${words}`);
assert.ok(!words.includes('stock') && !words.includes('market'), `늘 나오는 말은 빠져야: ${words}`);
// [2] 한 출처의 쏟아내기는 출처·날짜당 3건으로 묶인다 — 출처 1곳뿐이라 아예 못 든다
assert.ok(!words.includes('distribution') && !words.includes('declare'), `한 곳 쏟아내기는 빠져야: ${words}`);
// [3] 출처 3곳 미만은 뺀다
assert.ok(!words.includes('widget'), `두 곳만 다룬 일은 빠져야: ${words}`);
// [4] 훑지 않는 출처는 세지 않는다
assert.ok(!words.includes('celebrity'), `연예 출처는 빠져야: ${words}`);
// [5] now 뒤 기사는 세지 않는다
assert.ok(!words.includes('leak') && !words.includes('blowout'), `미래 기사는 빠져야: ${words}`);
// [6] 한국어 조사를 떼고 같은 말로 센다
assert.deepEqual([...topicTokens('美 중간선거에 쏠린 눈')].filter((w) => w.startsWith('중간')), ['중간선거']);
assert.ok(words.some((w) => w.split('·').includes('중간선거')), `중간선거가 있어야: ${words}`);
// [7] 예시 제목은 서로 다른 출처에서, 최근 것부터, 최대 3개
const el = topics.find((t) => t.words.includes('election'));
assert.equal(el.examples.length, 3);
assert.equal(new Set(el.examples.map((e) => e.source)).size, 3);
assert.ok(el.examples[0].at >= el.examples[1].at);
assert.ok(el.sources >= 4);
// [8] 같은 제목 반복은 한 번만(피드 두 곳이 같은 기사를 실을 때)
const dup = hotTopics([...rows, ...['A', 'B', 'C', 'D'].map((s) => h(1, s, 'Same wire story about tariffs truce'))], { now, scanSources: SCAN });
assert.ok(!dup.some((t) => t.word === 'truce'), '같은 제목 네 번은 한 번으로');
// [10] 같은 기사들에 같이 나오는 말은 한 이슈로 — midterm·election 이 칸 두 개를 쓰지 않는다
assert.ok(el.words.includes('midterm'), `midterm 이 election 과 한 묶음이어야: ${words}`);
assert.equal(topics.filter((t) => t.words.includes('midterm') || t.words.includes('election')).length, 1);
// [11] 영어·한국어는 같은 제목에 같이 안 나오니 따로 남는다(손으로 만든 동의어 목록은 안 쓴다)
assert.ok(!el.words.includes('중간선거'));
// [9] 보고서 칸: 이슈마다 한 줄, 비면 빈 문자열
const txt = formatHotTopics(topics);
assert.match(txt, /election/);
assert.match(txt, /\[[A-E] \d\d-\d\d \d\d:\d\d\]/, '출처·시각이 붙어야');
assert.ok(txt.split('\n').length <= topics.length);
assert.equal(formatHotTopics([]), '');

// [12] 프롬프트 칸: 비면 칸째 없음, 있으면 '안 써도 된다'·'만들지 마라'·'단정 금지' 규칙이 같이 간다
assert.equal(hotTopicsPromptBlock(''), '');
const blk = hotTopicsPromptBlock(txt);
assert.match(blk, /쓰지 마라/); assert.match(blk, /만들지 마라/); assert.match(blk, /단정/); assert.ok(blk.includes(txt));
// [13] 요약의 HTML 은 벗기고, 벗겨서 비면 요약을 안 붙인다(머니투데이 RSS 는 <table><img> 로 시작 — 11/07 실측)
const html = formatHotTopics([{ word: 'x', base: 0, recent: 1, sources: 3, examples: [{ headline: '블루웨이브에 질린 AI주', source: 'M', at: now, summary: '<table width=10><tr><td><img src=https://thumb.mt.co.kr/a.jpg></td></tr></table>AI주가 하루 만에 5% 내렸다' }] }]);
assert.ok(!/[<>]|thumb\.mt/.test(html), html);
assert.match(html, /AI주가 하루 만에 5% 내렸다/);
const onlyTag = formatHotTopics([{ word: 'x', base: 0, recent: 1, sources: 3, examples: [{ headline: '제목', source: 'M', at: now, summary: '<img src=a.jpg>' }] }]);
assert.ok(!onlyTag.includes(' — '), onlyTag);
console.log('news-topics.test: 13/13 통과');
