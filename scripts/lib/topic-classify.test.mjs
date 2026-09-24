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
// [6] 실패하면 **왜인지** 알린다 (2026-09-25: 9/24 21:45 회차가 "주제 분류 실패(agy)" 한 줄만 남겨
//   원인을 알 수 없었다. agy 쪽 오류 줄도 없었다 — agy 는 답했고, 여기서 조용히 버렸다는 뜻이다)
{
  const why = [];
  await classifyTopics(H, { call: async () => JSON.stringify({ c: { 0: '국내정치' } }), onReject: (w) => why.push(w) });
  await classifyTopics(H, { call: async () => '깨진 JSON', onReject: (w) => why.push(w) });
  await classifyTopics(H, { call: async () => null, onReject: (w) => why.push(w) });
  (why.length === 3 && /누락|빠/.test(why[0]) && /JSON|해석/.test(why[1]) && /응답 없음|빈/.test(why[2]))
    ? ok(`[6] 사유: ${why.join(' / ')}`) : bad(`[6] ${JSON.stringify(why)}`);
}
// [7] 합격 조건을 agy 에 넘긴다 — 불완전한 분류면 사슬의 다음 모델이 받는다
{
  let acc = null;
  await classifyTopics(H, { agyReportImpl: async (p, o) => { acc = o.accept; return null; } });
  const full = JSON.stringify({ c: Object.fromEntries(H.map((_, i) => [String(i), '국내정치'])) });
  (typeof acc === 'function' && acc(full) === true && acc(JSON.stringify({ c: { 0: '국내정치' } })) === false
    && acc('{"c":{"status":"done"}}') === false)
    ? ok('[7] accept: 전부 나뉜 답만 합격') : bad(`[7] accept=${typeof acc}`);
}
// [8] 번호 키에 따옴표가 섞여 와도 번호로 맞춘다 (2026-09-25 실측: gemini 가 {"'0'": "…"} 를 냈다.
//   9/24 21:45 회차의 분류 실패가 이것이었다 — c["0"] 이 없어 전부 '누락' 이 됐다)
{
  const r = await classifyTopics(H, { call: async () => JSON.stringify({ c: Object.fromEntries(H.map((_, i) => [`'${i}'`, '국내정치'])) }) });
  const r2 = await classifyTopics(H, { call: async () => JSON.stringify({ c: Object.fromEntries(H.map((_, i) => [` ${i} `, '기업·산업'])) }) });
  (Array.isArray(r) && r.every((t) => t === '국내정치') && Array.isArray(r2) && r2.every((t) => t === '기업·산업'))
    ? ok("[8] 키 \"'0'\" · \" 0 \" → 번호 0 으로 맞춘다") : bad(`[8] ${JSON.stringify(r)} ${JSON.stringify(r2)}`);
}
// [5] 목록에 '기타' 가 있다 — 정말 어디에도 안 맞는 헤드라인을 억지로 넣지 않게
TOPICS.includes('기타') ? ok('[5] 기타 존재') : bad('[5]');
console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
