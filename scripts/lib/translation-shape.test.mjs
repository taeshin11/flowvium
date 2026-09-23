#!/usr/bin/env node
/**
 * translation-shape.test.mjs — 번역이 **번역 모양인가.** 2026-09-23 신설.
 *
 * 오늘의 사고: 번역 시드를 agy 사슬로 옮긴 직후, 사전에 이것이 들어갔다:
 *     tyChg3m → "tyChg3m"은 번역 가능한 단어나 문장이 아닌 임의의 영숫자 문자열로 보입니다.
 *               번역할 수 있는 텍스트를 제공해 주세요.
 *   번역 대신 **번역에 대한 설명**을 저장한 것이다. 기존 관문은 전부 통과했다 —
 *   한국어이고(isUntranslated 통과), 음차 중단도 없고(hasScriptSplice 통과), 한자도 없다.
 *
 * 문구로 막지 않는다(다음엔 다른 말로 온다). **모양**으로 본다:
 *   번역문은 원문보다 몇 배씩 길어지지 않는다. 설명은 길어진다.
 *   실측 — "Short squeeze candidate"(23자) → "숏 스퀴즈 후보"(8자)
 *          "industrial conglomerate"(23자) → "산업 복합 기업"(9자)
 *          "tyChg3m"(7자) → 61자  ← 8.7배
 */
import { looksLikeTranslation } from './translation-shape.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 오늘의 사고 그대로
{
  !looksLikeTranslation('tyChg3m', '"tyChg3m"은 번역 가능한 단어나 문장이 아닌 임의의 영숫자 문자열로 보입니다. 번역할 수 있는 텍스트를 제공해 주세요.')
    ? ok('[1] 설명문을 번역으로 받지 않는다') : bad('[1] 통과시켰다');
}

// [2] ★ 진짜 번역은 통과해야 한다 — 관문이 세면 사전이 안 찬다
{
  const good = [
    ['Short squeeze candidate', '숏 스퀴즈 후보'],
    ['industrial conglomerate', '산업 복합 기업'],
    ['Free cash flow yield', '잉여현금흐름 수익률'],
    ['Earnings revision breadth', '이익 수정 확산도'],
    ['F5, Inc.', 'F5 주식회사'],
    ['ROE', '자기자본이익률'],                       // 약어는 늘어난다 — 짧은 원문에 여유를 둬야 한다
    ['EPS', '주당순이익'],
  ];
  const blocked = good.filter(([a, b]) => !looksLikeTranslation(a, b));
  blocked.length === 0 ? ok(`[2] 진짜 번역 ${good.length}종 통과`) : bad(`[2] 막힌 것: ${JSON.stringify(blocked)}`);
}

// [3] 긴 문장도 설명이 붙으면 잡는다 — 짧은 것만 보면 긴 쪽으로 샌다
{
  const src = 'The Federal Reserve held rates steady at the September meeting.';
  !looksLikeTranslation(src, '연준은 9월 회의에서 금리를 동결했습니다. 참고로 이 문장은 금융 뉴스 헤드라인으로 보이며, 원문의 의미를 최대한 살려 번역했습니다. 추가로 다른 표현이 필요하시면 말씀해 주세요.')
    ? ok('[3] 긴 문장 + 덧붙인 설명을 잡는다') : bad('[3] 통과시켰다');
  looksLikeTranslation(src, '연준은 9월 회의에서 금리를 동결했습니다.')
    ? ok('[3b] 같은 문장의 정상 번역은 통과') : bad('[3b] 정상을 막았다');
}

// [4] 빈 값·공백은 번역이 아니다
{
  ['', '   ', null, undefined].some((x) => looksLikeTranslation('abc', x))
    ? bad('[4] 빈 값을 통과시켰다') : ok('[4] 빈 값 차단');
}

// [5] 원문을 따옴표로 되뇌는 것도 설명의 표시다 — 번역문은 원문을 인용하지 않는다
{
  !looksLikeTranslation('ROIC', '"ROIC"는 투자자본수익률을 뜻하는 약어입니다. 한국어로는 투자자본수익률이라고 합니다.')
    ? ok('[5] 원문을 인용하며 설명하는 답을 잡는다') : bad('[5] 통과시켰다');
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
