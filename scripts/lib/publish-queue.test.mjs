#!/usr/bin/env node
/**
 * publish-queue.test.mjs — 큐 머리가 막혀 뒤가 굶지 않는가. 2026-09-20 신설.
 *
 * 실제 사고(2026-09-20): 미발행 글 6편 중 오래된 3편만 집는데(slice(0,3)) 그 3편이 전부
 *   "같은 날 중복"·"저품질" 로 걸러졌다. 그런데 걸러진 글은 원장에 안 남아서 다음 실행도
 *   **같은 3편**을 집었다. 오늘 아침 글은 6번째라 영영 차례가 오지 않았다.
 *   어제 12:21 이후 블로그가 한 편도 안 올라갔고, 그대로 두면 스스로 낫지 않는다.
 *
 * 거른 것도 **결론이다.** 결론을 적어야 줄이 움직인다.
 */
import { isPublished, pickQueue, markSkipped } from './publish-queue.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const ALL = ['2026-09-18-evening.md', '2026-09-18-midnight.md', '2026-09-19-noon.md',
  '2026-09-19-short-a.md', '2026-09-19-short-b.md', '2026-09-20-morning.md'];

// [1] 발행 판정 — id 가 있고 초안이 아닐 때만 '올린 글'
{
  isPublished({ id: '1', status: 'LIVE' }) ? ok('[1] 게시됨') : bad('[1]');
  !isPublished({ id: '1', status: 'DRAFT' }) ? ok('[1b] 초안은 게시 아님') : bad('[1b]');
  !isPublished({ skipped: 'same-day' }) ? ok('[1c] 거른 것은 게시 아님') : bad('[1c]');
  !isPublished(undefined) ? ok('[1d] 기록 없음은 게시 아님') : bad('[1d]');
}

// [2] 오늘의 사고 그대로 — 앞 3편이 원장에 없으면 매번 같은 3편만 집는다
{
  const q1 = pickQueue(ALL, {}, 3);
  const q2 = pickQueue(ALL, {}, 3);
  JSON.stringify(q1) === JSON.stringify(q2) && q1.length === 3 && !q1.includes('2026-09-20-morning.md')
    ? ok('[2] 결론을 안 적으면 같은 3편만 반복 — 오늘 글은 안 잡힌다') : bad(`[2] ${JSON.stringify(q1)}`);
}

// [3] 거른 것을 적으면 줄이 움직여 오늘 글까지 닿는다
{
  let led = {};
  for (const f of pickQueue(ALL, led, 3)) led = markSkipped(led, f, 'same-day');
  const q = pickQueue(ALL, led, 3);
  q.includes('2026-09-20-morning.md')
    ? ok(`[3] 한 판 뒤 오늘 글이 잡힌다: ${q.join(', ')}`) : bad(`[3] ${JSON.stringify(q)}`);
}

// [4] 거른 글은 '이미 올린 글' 로 세지 않는다 —
//     세면 같은 날 중복 검사와 겹침 비교가 **올리지도 않은 글**을 기준으로 삼는다
{
  const led = markSkipped({}, '2026-09-18-evening.md', 'low-quality');
  !isPublished(led['2026-09-18-evening.md']) ? ok('[4] 거른 글은 발행으로 안 센다') : bad('[4]');
  led['2026-09-18-evening.md'].reason === 'low-quality' ? ok('[4b] 사유가 남는다') : bad('[4b]');
}

// [5] 이미 있는 기록은 덮지 않는다 — 올린 글을 '걸렀다' 로 바꾸면 링크를 잃는다
{
  const led = markSkipped({ a: { id: '9', status: 'LIVE' } }, 'a', 'same-day');
  led.a.id === '9' ? ok('[5] 게시 기록은 보존') : bad(`[5] ${JSON.stringify(led.a)}`);
}

// [6] max 를 넘겨 집지 않는다
{
  pickQueue(ALL, {}, 2).length === 2 ? ok('[6] 상한 준수') : bad('[6]');
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
