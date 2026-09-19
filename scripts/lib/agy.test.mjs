#!/usr/bin/env node
/**
 * agy.test.mjs — agy 로 넘긴 뒤에도 **로컬 폴백이 살아 있는가**. 2026-09-19 신설.
 *
 * 이 테스트가 지키는 것: 오늘 구글이 Gemini CLI 를 하루아침에 닫는 걸 봤다(IneligibleTierError).
 *   agy 가 막히는 날 블로그와 쇼츠가 같이 멈추면 안 된다. 그래서 합성기는
 *   **agy 실패를 조용히 삼키지 않고 폴백을 부르고, 그 사유를 남긴다.**
 */
import { agyCaller } from './agy.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] agy 가 글을 주면 그걸 쓴다 — 폴백은 부르지 않는다
{
  let localCalls = 0;
  const call = agyCaller(async () => { localCalls++; return '로컬'; }, { agyImpl: () => '안티그래비티' });
  const got = await call('시험');
  got === '안티그래비티' && localCalls === 0 ? ok('[1] agy 성공 시 agy 결과, 로컬 미호출')
    : bad(`[1] got=${got} localCalls=${localCalls}`);
}

// [2] agy 가 null 이면 로컬로 내려간다
{
  const call = agyCaller(async () => '로컬', { agyImpl: () => null });
  const got = await call('시험');
  got === '로컬' ? ok('[2] agy 실패 → 로컬 폴백') : bad(`[2] got=${got}`);
}

// [3] agy 가 **던져도** 로컬로 내려간다 (spawn 자체가 깨지는 날)
{
  const call = agyCaller(async () => '로컬', { agyImpl: () => { throw new Error('spawn EPERM'); } });
  const got = await call('시험');
  got === '로컬' ? ok('[3] agy 예외 → 로컬 폴백') : bad(`[3] got=${got}`);
}

// [4] 폴백한 이유를 남긴다 — 조용히 내려가면 4B 로 돌아간 걸 아무도 모른다
{
  const lines = [];
  const call = agyCaller(async () => '로컬', { agyImpl: () => null, warn: (m) => lines.push(m) });
  await call('시험');
  lines.length === 1 && /agy/.test(lines[0]) ? ok(`[4] 사유 기록: ${lines[0]}`) : bad(`[4] ${JSON.stringify(lines)}`);
}

// [5] 빈 문자열·공백은 성공이 아니다 — 빈 본문이 블로그로 나가면 안 된다
{
  const call = agyCaller(async () => '로컬', { agyImpl: () => '   ' });
  const got = await call('시험');
  got === '로컬' ? ok('[5] 공백 응답은 실패로 본다') : bad(`[5] got=${JSON.stringify(got)}`);
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
