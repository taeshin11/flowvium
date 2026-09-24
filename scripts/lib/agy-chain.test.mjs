#!/usr/bin/env node
/**
 * agy-chain.test.mjs — 짧은 글(번역 등)도 사슬을 돈다. 2026-09-23 신설.
 *
 * 오늘의 사고: 27B 를 내린 뒤 번역 시드를 돌렸더니 **한 건도 못 넣었다.**
 *     ↩ agy 실패 → 로컬 27B 로 (structured_output.text 비어 있음)
 *     ✗ tyChg3m — fetch failed
 *   agyText 는 **한 모델만** 부르고, 실패하면 로컬로 떨어지게 돼 있었다.
 *   보고서는 사슬(agyReport)로 옮겼는데 짧은 글 경로는 그대로였다 —
 *   같은 규율을 한 경로에만 적용한 것이다.
 */
import { agyTextChain, AGY_TEXT_CHAIN } from './agy-chain.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 사슬은 **gemini 모델들**이고, 보고서 사슬과 같은 목록이다 (2026-09-25 사장님 "gemini 쓰면되지")
//   종전 원칙은 "계열이 다르면 같은 이유로 같이 안 죽는다" 였다. 실측은 반대였다 —
//   claude-opus 37회 · gpt-oss 4회가 할당량 소진(429)으로 떨어졌고 gemini 는 0회.
//   다른 계열이 **예비가 아니라 매번 ~155초를 버리는 칸**이었다. 두 사슬을 따로 적어 둔 것도
//   어긋날 자리라 한 곳(agy-report 의 AGY_MODEL_CHAIN)에서 가져온다.
{
  const { AGY_MODEL_CHAIN } = await import('./agy-report.mjs');
  const allGemini = AGY_TEXT_CHAIN.every((m) => /^gemini-/.test(m));
  const distinct = new Set(AGY_TEXT_CHAIN).size === AGY_TEXT_CHAIN.length;
  (AGY_TEXT_CHAIN.length >= 2 && allGemini && distinct && JSON.stringify(AGY_TEXT_CHAIN) === JSON.stringify(AGY_MODEL_CHAIN))
    ? ok(`[1] ${AGY_TEXT_CHAIN.join(' → ')} (보고서 사슬과 같다)`) : bad(`[1] text=${JSON.stringify(AGY_TEXT_CHAIN)} report=${JSON.stringify(AGY_MODEL_CHAIN)}`);
}

// [2] 1차가 빈 답을 내면 2차로 간다 — 오늘 실제로 난 모양이다
{
  const seen = [];
  const out = agyTextChain('번역해라', { impl: (p, o) => { seen.push(o.model); return o.model === AGY_TEXT_CHAIN[0] ? null : '결과'; } });
  out === '결과' && seen.length === 2 ? ok(`[2] 1차 빈답 → 2차(${seen[1]})`) : bad(`[2] out=${out} seen=${JSON.stringify(seen)}`);
}

// [3] 공백만 온 것도 실패로 본다 — '' 를 성공으로 세면 빈 번역이 사전에 박힌다
{
  const seen = [];
  const out = agyTextChain('x', { impl: (p, o) => { seen.push(o.model); return o.model === AGY_TEXT_CHAIN[0] ? '   ' : '결과'; } });
  out === '결과' ? ok('[3] 공백 답은 실패로 본다') : bad(`[3] ${JSON.stringify(out)}`);
}

// [4] 1차가 성공하면 더 부르지 않는다 — 번역은 하루 수백 건이라 한 번이 비싸다
{
  let n = 0;
  agyTextChain('x', { impl: () => { n++; return '결과'; } });
  n === 1 ? ok('[4] 1차 성공이면 한 번만') : bad(`[4] ${n}회`);
}

// [5] ★ 전부 실패하면 **null 을 돌려준다.** 로컬로 떨어뜨리지 않는다 —
//     27B 는 내렸고, 4B 는 금융 용어를 틀려서 이 잡이 존재하는 이유다.
//     못 하면 못 했다고 하고 다음 회차에 다시 한다. 틀린 번역을 사전에 박는 것이 더 나쁘다.
{
  const seen = [];
  const out = agyTextChain('x', { impl: (p, o) => { seen.push(o.model); return null; } });
  out === null && seen.length === AGY_TEXT_CHAIN.length
    ? ok(`[5] 전부 실패 → null (${seen.length}단 다 시도)`) : bad(`[5] out=${out} seen=${seen.length}`);
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
