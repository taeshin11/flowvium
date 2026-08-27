#!/usr/bin/env node
/**
 * issue-cluster.test.mjs — 오늘의 이슈를 감이 아니라 데이터로 고르는가.
 *
 * 배경(2026-08-27): 종합 이슈 유튜브 채널. 소재를 사람이 고르면 자동화가 아니고,
 *   LLM 이 고르면 왜 골랐는지 설명이 안 된다. 그래서 결정론으로 고른다.
 *
 * 신호: **여러 매체가 동시에 다루는 사건이 그날의 큰 이슈다.** 한 매체만 쓰면 그 매체의 관심사고,
 *   NBC·CBS·Variety 가 같이 쓰면 사건이다. 실측(08-27 미국 피드): Dolly Parton 별세가
 *   NBC 1 + CBS 3 + Variety 1 = 4개 매체에 걸렸고, 나머지는 대부분 단일 매체였다.
 *
 * 조회수 기준이 아니라 **매체 수** 기준인 이유: 우리는 조회수를 볼 수 없고, 매체 수는
 *   수집 데이터만으로 즉시 계산된다. 그리고 한 매체가 같은 사건을 여러 번 쓰는 걸
 *   '큰 이슈'로 오해하지 않는다(CBS 3건이 매체 1로 세어진다).
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./issue-cluster.mjs')
  .catch(e => { bad(`issue-cluster.mjs 없음: ${String(e.message).slice(0,60)}`); return null; });
if (!M) { console.log('\n❌ 실패'); process.exit(1); }

const items = [
  { source: 'NBC 톱뉴스',   headline: 'New details on Dolly Parton’s death as tributes pour in' },
  { source: 'CBS 톱뉴스',   headline: 'Fans mourn Dolly Parton at Dollywood in Tennessee' },
  { source: 'CBS 톱뉴스',   headline: 'How Dolly Parton donated millions of books to children' },
  { source: 'CBS 톱뉴스',   headline: 'Why Dolly Parton is so heavily associated with butterflies' },
  { source: 'Variety 연예', headline: 'Dolly Parton Has One Last Song Buried in a Time Capsule' },
  { source: 'CBS 톱뉴스',   headline: 'Meta settles in social media addiction case' },
  { source: 'CBS 톱뉴스',   headline: 'Meta not admitting wrongdoing in $17 billion settlement' },
  { source: 'NPR 톱뉴스',   headline: 'Drugstores say Medicare obesity drug pricing is unclear' },
];

// [1] 다매체 동시 보도가 1순위
{
  const cl = M.clusterIssues(items);
  const top = cl[0];
  /dolly|parton/i.test(top.keyword) || /dolly/i.test(top.headlines.join(' '))
    ? ok(`1순위: "${top.keyword}" (매체 ${top.sourceCount}, 기사 ${top.headlines.length})`)
    : bad(`1순위가 틀렸다: ${top.keyword}`);
  top.sourceCount >= 3 ? ok(`매체 수 ${top.sourceCount}`) : bad(`매체 수 집계 오류: ${top.sourceCount}`);
}
// [2] 한 매체가 여러 번 쓴 걸 큰 이슈로 오해하지 않는다
{
  const cl = M.clusterIssues(items);
  const meta = cl.find((c) => /meta/i.test(c.keyword));
  if (!meta) ok('(Meta 클러스터 미형성 — 기사 2건은 임계 미만)');
  else meta.sourceCount === 1 ? ok(`CBS 2건이 매체 1로 집계 (${meta.sourceCount})`) : bad(`매체 중복 계수: ${meta.sourceCount}`);
}
// [3] 단발 기사는 상위로 안 올라온다
{
  const cl = M.clusterIssues(items);
  /medicare|drugstore/i.test(cl[0].keyword) ? bad('단발 기사가 1순위') : ok('단발 기사는 1순위 아님');
}
// [4] 빈/널 입력 안전
M.clusterIssues([]).length === 0 && M.clusterIssues(null).length === 0
  ? ok('빈 입력 안전') : bad('빈 입력에서 깨진다');

// [5] 불용어가 키워드가 되면 안 된다 (the/from/says 로 묶이면 전부 한 덩어리가 된다)
{
  const noise = [
    { source: 'A', headline: 'The president says the plan is from the start' },
    { source: 'B', headline: 'The report says the market from the west' },
    { source: 'C', headline: 'The city says the storm from the east' },
  ];
  const cl = M.clusterIssues(noise);
  const bad1 = cl.some((c) => ['the', 'says', 'from', 'a', 'is'].includes(c.keyword.toLowerCase()));
  !bad1 ? ok('불용어는 키워드가 되지 않는다') : bad(`불용어 클러스터: ${cl.map((c) => c.keyword).join(', ')}`);
}

console.log(fail === 0 ? '\n✅ issue-cluster 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
