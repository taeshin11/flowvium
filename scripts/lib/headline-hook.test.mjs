#!/usr/bin/env node
/**
 * headline-hook.test.mjs — 공인도 대립도 없는 헤드라인을 편성에서 뒤로 미는가. 2026-10-24 신설.
 *
 * 사장님 10/24 "지표가 자라는지 보고 안 되면 고쳐라"(Mac mini2 경유). 실측(7주 382편, 48시간 조회 ÷ 같은 날 중앙값):
 *   공인 실명/직함도 대립도 없는 헤드라인 n165 — 붕괴(lift<0.4, 첫 화면에서 넘김) 22% · 평균 0.83.
 *   나머지 n217 — 붕괴 약 5% · 평균 약 1.03. 국내정치 안에서도, 기간을 반으로 갈라도 같은 방향.
 *   주제 등급('증시 약')은 '또래 이상 비율' 검정이라 국내정치 말고는 다 약으로 나와 이 차이를 못 가른다.
 *   거르지는 않는다 — 그런 편도 평균 0.83 이라 안 내는 것보다 낫다. 대안이 있을 때만 뒤로 민다.
 * 교차 검증(ChatGPT·agy·Claude, 10/24 22시): 셋 다 '거르지 말고 뒤로'. 둘(agy·Claude)이 '용어 중심 & 공인 없음' 도 약하게
 *   (국내정치 안에서도 붕괴 19% vs 1%) · 둘(agy·Claude)이 실험 칸은 예외로 남겨 대조군으로. 효과는 붕괴율로 잰다(셋 다).
 */
import { classifyHooks, hookPrompt, hookWeak, orderByHook } from './headline-hook.mjs';
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const H = ['신한은행, 중저신용자 대출 금리 0.3%P 낮춘다', '김민석, 강훈식 서울시장 후보 질문에 "가능성 열려있다"', '국민의힘 최고위 고성 충돌'];

{
  const r = await classifyHooks(H, { call: async () => JSON.stringify({ h: { 0: [0, 0, 1], 1: [1, 0, 0], 2: [0, 1, 0] } }) });
  JSON.stringify(r) === JSON.stringify([{ person: 0, conflict: 0, jargon: 1 }, { person: 1, conflict: 0, jargon: 0 }, { person: 0, conflict: 1, jargon: 0 }]) ? ok('[1] 정상 표시(공인·대립·용어)') : bad(`[1] ${JSON.stringify(r)}`);
}
{
  const r = await classifyHooks(H, { call: async () => JSON.stringify({ h: { "'0'": [0, 0, 0], ' 1': [1, 0, 0], 2: [0, 1, 0] } }) });
  r?.[0]?.person === 0 && r?.[1]?.person === 1 ? ok('[2] 키에 따옴표·공백이 붙어도 번호로 맞춘다') : bad(`[2] ${JSON.stringify(r)}`);
}
{
  const miss = await classifyHooks(H, { call: async () => JSON.stringify({ h: { 0: [0, 0, 0], 1: [1, 0, 0] } }) });
  const badv = await classifyHooks(H, { call: async () => JSON.stringify({ h: { 0: [0, 0, 0], 1: ['예', 0, 0], 2: [0, 1] } }) });
  miss === null && badv === null ? ok('[3] 하나라도 빠지거나 0/1 이 아니면 null(일부만 표시된 채로 순서를 바꾸지 않는다)') : bad(`[3] ${JSON.stringify([miss, badv])}`);
}
{
  (await classifyHooks(H, { call: async () => null })) === null
  && (await classifyHooks(H, { call: async () => { throw new Error('x'); } })) === null
  && (await classifyHooks(H, { call: async () => '깨진' })) === null
    ? ok('[4] 실패·예외·깨진 응답 → null(쇼츠를 막지 않는다)') : bad('[4]');
}
{
  const p = hookPrompt(H);
  (/공인/.test(p) && /대립/.test(p) && /용어/.test(p) && /도구도 쓰지 마라/.test(p) && p.includes('0|신한은행')) ? ok('[5] 기준(공인·대립) + 도구 금지 + 번호|헤드라인') : bad('[5]');
}
(hookWeak({ person: 0, conflict: 0, jargon: 0 }) && hookWeak({ person: 0, conflict: 1, jargon: 1 })
  && !hookWeak({ person: 1, conflict: 0, jargon: 1 }) && !hookWeak({ person: 0, conflict: 1, jargon: 0 }) && !hookWeak(null) && !hookWeak(undefined))
  ? ok('[6] 약함 = 공인도 대립도 없음, 또는 용어 중심인데 공인 없음 — 표시가 없으면 약하지 않다(판단 안 함)') : bad('[6]');
{
  const c = ['a', 'b', 'c', 'd'].map((k) => ({ keyword: k }));
  const f = [{ person: 0, conflict: 0, jargon: 0 }, { person: 1, conflict: 0, jargon: 0 }, { person: 0, conflict: 0, jargon: 0 }, { person: 0, conflict: 1, jargon: 0 }];
  const r = orderByHook(c, f);
  (r.order.map((x) => x.keyword).join('') === 'bdac' && r.moved === 2) ? ok('[7] 약한 것만 뒤로, 나머지 순서는 그대로(안정 정렬)') : bad(`[7] ${JSON.stringify(r)}`);
  const all = orderByHook(c.slice(0, 2), [{ person: 0, conflict: 0, jargon: 0 }, { person: 0, conflict: 0, jargon: 0 }]);
  (all.order.map((x) => x.keyword).join('') === 'ab' && all.moved === 0) ? ok('[8] 전부 약하면 순서를 안 바꾼다(회차를 거르지 않는다 — 평균 0.83 이 0 보다 낫다)') : bad(`[8] ${JSON.stringify(all)}`);
  const none = orderByHook(c, null);
  (none.order === c && none.moved === 0) ? ok('[9] 표시 실패(null)면 그대로') : bad('[9]');
}
{
  const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  const iHook = ms.indexOf("import('../lib/headline-hook.mjs')");
  const iTrend = ms.indexOf('if (TREND) try {');
  const iProbe = ms.indexOf('for (const cand of fresh.slice(0, PROBE_N))');
  (iHook > iTrend && iHook < iProbe) ? ok('[10] make-shorts: 트렌드 정렬 뒤·소재 탐색 앞에서 건다(뒤 정렬이 덮지 않게)') : bad(`[10] 위치 ${iTrend}/${iHook}/${iProbe}`);
  (/orderByHook\(/.test(ms) && /issue = fresh\[0\];[\s\S]{0,400}공인·대립/.test(ms.slice(iHook, iProbe))) ? ok('[11] 정렬 결과로 1순위를 다시 정하고 로그를 남긴다') : bad('[11]');
  (/if \(!EXPLORE\) try \{\s*\n\s*const \{ classifyHooks/.test(ms.slice(iHook - 400, iHook + 200))) ? ok('[13] 실험 칸은 예외 — 대조군으로 남겨 붕괴율을 비교한다') : bad('[13] 실험 칸에도 건다');
  (/IS_HOOK_WEAK/.test(ms) && /!IS_WEAK\(x\.cand\) && !IS_HOOK_WEAK\(x\.cand\)/.test(ms)) ? ok('[12] 소재 기준 재선택에서도 같은 판단(사진 많은 약한 편이 되살아나지 않게)') : bad('[12] 소재 재선택이 훅 판단을 안 본다');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
