#!/usr/bin/env node
/**
 * attribution.test.mjs — 남의 주장을 채널의 말처럼 내보내지 않는가.
 *
 * 배경(2026-09-06): 08:15 백필이 "좌파 카르텔 인사 농단" 을 **인용 표시 없이** 훅으로 띄우고
 *   그 아래 상대 인물(용혜인) 사진을 깔았다. 국민의힘의 공격 표현인데 화면만 보면
 *   채널이 그렇게 규정한 것으로 읽힌다. 실존 인물에 대한 낙인이고 유튜브 괴롭힘 정책에도 걸린다.
 *   틀린 사진보다 무거운 문제라 발행 후 내렸다.
 */
import { needsAttribution, attributionIssues } from './attribution.mjs';

let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };

// 낙인·공격 표현 — 누가 했는지 밝히지 않으면 채널의 말이 된다
{
  const attack = [
    '좌파 카르텔 인사 농단',
    '국민사기 3인방',
    '후안무치 끝판왕',
    '특혜 논란 몸통',
  ];
  for (const h of attack) {
    needsAttribution(h) ? ok(`"${h}" 는 출처를 밝혀야 한다`) : bad(`"${h}" 를 그냥 통과시켰다`);
  }
}

// 사실 서술은 막지 않는다
{
  const plain = [
    '용혜인 사퇴 거부',
    '청문회 15일 개최',
    '한화에어로 크로아티아 수출',
    '코스피 6687 마감',
    '수력발전소 터널 구조',
  ];
  for (const h of plain) {
    !needsAttribution(h) ? ok(`"${h}" 는 사실 서술`) : bad(`"${h}" 를 막았다`);
  }
}

// 출처가 이미 밝혀져 있으면 통과
{
  const cited = [
    '국힘 "좌파 카르텔 인사 농단"',
    '나경원 "국민사기 3인방" 고발',
    '野 주장 — 특혜 논란 몸통',
  ];
  for (const h of cited) {
    !needsAttribution(h) ? ok(`"${h.slice(0, 22)}" 는 출처가 있다`) : bad(`출처 있는데 막았다: ${h}`);
  }
}

// 장면 단위 검사 — 훅에 낙인이 있으면 잡아낸다
{
  const scenes = [
    { hook: '용혜인 지명 배후 김현지', say: '국민의힘은 공세를 이어갔습니다.' },
    { hook: '좌파 카르텔 인사 농단', say: '국민의힘은 그렇게 주장했습니다.' },
  ];
  const issues = attributionIssues(scenes);
  issues.length === 1 && issues[0].includes('좌파')
    ? ok('훅의 낙인 표현을 집어낸다') : bad(`장면 검사 결과가 이상하다: ${JSON.stringify(issues)}`);
}

console.log(fail === 0 ? '\n✅ attribution 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
