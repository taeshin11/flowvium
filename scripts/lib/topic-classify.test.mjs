#!/usr/bin/env node
/** topic-classify.test.mjs — 주제 분류의 계약. 2026-09-24 신설. */
import { classifyTopics, TOPICS } from './topic-classify.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const H = ['李대통령 지지도 최저', '한화에어로 천무 수출 임박', '코스피 1% 상승'];

// [1] 정상 응답 → 같은 길이·목록 안 값
{
  const r = await classifyTopics(H, { call: async () => JSON.stringify({ c: { 0: '국내정치', 1: '기업·산업', 2: '증시·금리·환율' } }) });
  JSON.stringify(r) === JSON.stringify(['국내정치', '기업·산업', '증시·금리·환율']) ? ok('[1] 정상 분류') : bad(`[1] ${JSON.stringify(r)}`);
}
// [2] 목록 밖 답은 '기타' — 새 이름이 생기면 과거 편과 잣대가 어긋난다
{
  const r = await classifyTopics(H, { call: async () => JSON.stringify({ c: { 0: '정치', 1: '기업·산업', 2: '증시·금리·환율' } }) });
  r[0] === '기타' ? ok('[2] 목록 밖 → 기타') : bad(`[2] ${r[0]}`);
}
// [3] ★ 하나라도 빠지면 null — 일부만 나뉜 채로 순서를 바꾸면 빠진 후보가 조용히 밀린다
{
  const r = await classifyTopics(H, { call: async () => JSON.stringify({ c: { 0: '국내정치', 1: '기업·산업' } }) });
  r === null ? ok('[3] 누락이 있으면 null') : bad(`[3] ${JSON.stringify(r)}`);
}
// [4] ★ agy 실패는 null — 부르는 쪽이 순서를 안 건드리고 넘어간다(쇼츠를 막지 않는다)
{
  (await classifyTopics(H, { call: async () => null })) === null
  && (await classifyTopics(H, { call: async () => { throw new Error('x'); } })) === null
  && (await classifyTopics(H, { call: async () => '깨진 JSON' })) === null
    ? ok('[4] 실패·예외·깨진 응답 → null') : bad('[4]');
}
// [5] 목록에 '기타' 가 있다 — 정말 어디에도 안 맞는 헤드라인을 억지로 넣지 않게
TOPICS.includes('기타') ? ok('[5] 기타 존재') : bad('[5]');
console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
