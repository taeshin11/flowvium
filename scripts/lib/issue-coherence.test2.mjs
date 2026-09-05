#!/usr/bin/env node
/**
 * 같은 기사가 **다른 키워드로** 다시 나가는 것을 막는가.
 *
 * 배경(2026-09-05): 12:00 에 "아파트" 키워드로 낸 기사가, 16:00 편성에서 "홍지선" 키워드로
 *   다시 1순위가 됐다. 원장은 키워드로만 막아서 같은 기사가 통과한다.
 *   사용자가 전에 "왜 제목과 설명이 같은 영상이 세개나 올라갔지" 라고 지적한 그 문제다.
 */
import { isSameStory } from './issue-coherence.mjs';

let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };

const published = ['"홍지선, 주택담보대출에 처가 돈 빌려 산 아파트 1년 새 4억↑"'];

isSameStory('홍지선 국토교통부 장관 후보자, 주택담보대출로 아파트 매수…1년 새 4억 올라', published)
  ? ok('같은 사건은 다른 키워드로 와도 막는다') : bad('같은 기사를 통과시켰다');

isSameStory('"홍지선, 주택담보대출에 처가 돈 빌려 산 아파트 1년 새 4억↑"', published)
  ? ok('토씨까지 같은 기사는 당연히 막는다') : bad('완전히 같은 기사를 통과시켰다');

!isSameStory('韓 호르무즈 파병 검토에 日언론도 주목', published)
  ? ok('다른 사건은 통과') : bad('무관한 사건을 막았다');

!isSameStory('한화에어로, 크로아티아에 천무 수출 임박..6800억원 규모', published)
  ? ok('다른 사건(한화에어로) 통과') : bad('무관한 사건을 막았다');

!isSameStory('홍지선 후보자, 국토부 정책 방향 발표', published)
  ? ok('같은 인물이라도 다른 사건이면 통과') : bad('같은 인물이라고 막았다');

!isSameStory('아무 기사', []) ? ok('발행 이력이 없으면 통과') : bad('빈 이력에서 막았다');

console.log(fail === 0 ? '\n✅ 중복 기사 판정 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
