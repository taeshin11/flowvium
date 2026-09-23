#!/usr/bin/env node
/**
 * report-source.test.mjs — agy 로 돌린 보고서가 last-good 캐시에 **들어가는가.** 2026-09-23 신설.
 *
 * 하마터면 낸 사고: 보고서 라벨을 'local-Qwen…' → 'agy-gemini…' 로 바꾸는 순간
 *   investment-strategy/route.ts 의 rememberGood() 이 `startsWith('local-')` 로 걸러서
 *   agy 회차가 last-good 캐시에 한 번도 안 들어간다. Upstash 가 튀면 generic 이 서빙된다 —
 *   2026-06-13 사용자 신고("원래 나오던게 안나와")와 같은 증상.
 */
import { isGeneratedSource } from './report-source.mjs';
import { reportProvenance } from './model-provenance.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 종전 경로는 그대로 통과 — 넓히면서 있던 걸 떨구면 안 된다
{
  ['local-Qwen3.8-27B-8bit', 'vllm-anything', 'cron'].every(isGeneratedSource)
    ? ok('[1] 종전 라벨 전부 통과') : bad('[1] 종전 라벨 일부가 막혔다');
}

// [2] 이번에 하마터면 낸 사고 — agy/mixed 라벨이 막히면 캐시가 빈다
{
  isGeneratedSource('agy-gemini-3.1-pro-high') ? ok('[2] agy 통과') : bad('[2] agy 가 막힌다');
  isGeneratedSource('mixed-agy12(gemini-3.1-pro-high)+local6(Qwen3.8-27B-8bit)')
    ? ok('[2b] mixed 통과') : bad('[2b] mixed 가 막힌다');
}

// [3] 대체물은 막는다 — 이게 캐시에 들어가면 하루 종일 중립 전략이 서빙된다
{
  ['static-fallback', 'generic', 'missing', '', null, undefined, 'fallback'].some(isGeneratedSource)
    ? bad('[3] 대체물이 통과했다') : ok('[3] generic·static-fallback·빈값은 막힌다');
}

// [4] 접두사만 있고 모델명이 없으면 막는다 — 'agy-' 는 모른다는 뜻이다
{
  !isGeneratedSource('agy-') && !isGeneratedSource('local-')
    ? ok('[4] 접두사뿐이면 막힌다') : bad('[4] 빈 모델명이 통과했다');
}

// [5] ★ 짝 맞추기 — reportProvenance 가 내는 source 는 **전부** 여기를 통과해야 한다.
//     이 둘이 어긋나는 것이 이번 사고의 형태였다. 한쪽만 고치면 또 어긋난다.
{
  const cases = [
    { agyCalls: 18, localCalls: 0, agyModel: 'gemini-3.1-pro-high', localModel: 'Qwen3.8-27B-8bit' },
    { agyCalls: 0, localCalls: 17, localModel: 'Qwen3.8-27B-8bit' },
    { agyCalls: 12, localCalls: 6, agyModel: 'gemini-3.1-pro-high', localModel: 'Qwen3.8-27B-8bit' },
    { agyCalls: 3, localCalls: 0, agyModel: null, localModel: 'Qwen3.8-27B-8bit' },
  ];
  const out = cases.map((c) => reportProvenance(c).source);
  const blocked = out.filter((s) => !isGeneratedSource(s));
  blocked.length === 0
    ? ok(`[5] 생성 라벨 ${out.length}종이 모두 통과 — ${out.map((s) => s.split('(')[0]).join(' · ')}`)
    : bad(`[5] 막힌 라벨: ${blocked.join(', ')}`);
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
