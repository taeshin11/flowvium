#!/usr/bin/env node
/** blog-openers.test.mjs — 도입부 단일 원천 검증. (2026-09-21 신설) */
import { OPENERS, pickOpener, OPENER_PATTERNS } from './blog-openers.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] pickOpener 가 같은 날짜·세션에 항상 같은 것을 고른다
{
  const a = pickOpener('09', '21', 'morning');
  const b = pickOpener('09', '21', 'morning');
  a === b ? ok('[1] 같은 조건이면 같은 도입부') : bad('[1] 같은 조건인데 다른 도입부가 나옴');
}

// [2] 날짜가 다르면 다른 것도 고른다(4개가 다 쓰이는지 한 달치로 확인)
{
  const used = new Set();
  for (let d = 1; d <= 30; d++) {
    const dd = String(d).padStart(2, '0');
    used.add(pickOpener('09', dd, 'morning'));
  }
  used.size === 4 ? ok(`[2] 4개가 모두 골고루 쓰임 (${used.size}개)`) : bad(`[2] 일부 도입부만 쓰임 (${used.size}개)`);
}

// [3] OPENER_PATTERNS 가 OPENERS 가 실제로 만들어 내는 문장을 전부 잡는다
{
  let allMatched = true;
  for (let i = 0; i < OPENERS.length; i++) {
    const text = OPENERS[i]('9월 21일', '아침');
    const matched = OPENER_PATTERNS.some(re => {
      re.lastIndex = 0; // gm 플래그이므로 초기화
      return re.test(text);
    });
    if (!matched) {
      allMatched = false;
      bad(`[3] 패턴이 다음 문장을 놓침: ${text}`);
    }
  }
  if (allMatched) ok('[3] 생성된 모든 도입부가 패턴에 잡힘');
}

// [4] 멀쩡한 본문 문장은 안 잡는다(오탐 방지)
{
  const safeText = '코스피가 2.7% 올랐습니다. 시장 변동성이 커지고 있습니다.';
  const falsePositive = OPENER_PATTERNS.some(re => {
    re.lastIndex = 0;
    return re.test(safeText);
  });
  !falsePositive ? ok('[4] 일반 본문은 오탐하지 않음') : bad('[4] 일반 본문을 도입부로 오탐함');
}

console.log(fail ? `\n❌ ${fail} 실패` : '\n✅ blog-openers 통과');
process.exit(fail ? 1 : 0);
