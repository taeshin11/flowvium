#!/usr/bin/env node
/**
 * rule-spec.test.mjs — 룰 스펙의 condition.type 이 엔진에 실재하는지 검증.
 *
 * 배경(2026-08-20 실증): buy-sell-engine 의 switch 에 default 절이 없어, 존재하지 않는 type 은
 *   null 을 돌려준다. "조건 미충족"과 구분이 안 된다.
 *     evaluateBuyRule({condition:{type:'trendPullbcak'}}, ctx) → null   (오타)
 *     evaluateBuyRule({condition:{type:'trendPullback'}},  ctx) → "정배열 눌림목 …"
 *   전향 연구에서 이건 가설이 검증된 적 없는데 통계표에 안 나타나 '아직 발화 안 함'처럼 보이는
 *   문제다. 스펙 오타 하나로 가설이 영구 미검증 상태가 된다.
 *
 * 엔진의 실제 switch 를 통과시켜 판정한다 — 알려진 타입 목록을 여기 복제하지 않으므로 drift 가 없다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const E = await import(resolve(ROOT, 'src/lib/buy-sell-engine.mjs'));
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

if (typeof E.takeUnknownConditionTypes !== 'function') {
  bad('takeUnknownConditionTypes 미구현 — 미지원 type 이 여전히 무음으로 통과한다');
  console.log('\n결과: 실패 1건'); process.exit(1);
}

// ① 오타를 넣으면 반드시 잡혀야 한다 (탐지 능력 자체를 먼저 증명)
E.takeUnknownConditionTypes();
E.evaluateBuyRule({ id: 'x', condition: { type: 'trendPullbcak' } }, {});
E.evaluateSellRule({ id: 'y', condition: { type: 'parabolicFadeee' } }, {});
const caught = E.takeUnknownConditionTypes();
(caught.includes('trendPullbcak') && caught.includes('parabolicFadeee'))
  ? ok(`오타 type 탐지: ${caught.join(', ')}`)
  : bad(`오타 type 미탐지 (탐지된 것: ${caught.join(', ') || '없음'})`);

// ② 탐지기가 소진형인지 (한 번 읽으면 비워져 다음 검사에 새는 것이 없어야)
E.takeUnknownConditionTypes().length === 0 ? ok('탐지 목록 소진형') : bad('탐지 목록이 안 비워짐');

// ③ 실제 스펙 3종에 미지원 type 이 없어야 한다
const SPECS = ['data/buy-rules-tuned.json', 'data/sell-rules-tuned.json', 'data/shadow-rules.json'];
const CTX = {};   // 빈 ctx — 조건은 어차피 미충족이나 switch 진입 여부만 본다
for (const f of SPECS) {
  E.takeUnknownConditionTypes();
  const rules = JSON.parse(readFileSync(resolve(ROOT, f), 'utf8')).rules ?? [];
  for (const r of rules) {
    (r.side === 'sell' || f.includes('sell')) ? E.evaluateSellRule(r, CTX) : E.evaluateBuyRule(r, CTX);
  }
  const unknown = E.takeUnknownConditionTypes();
  unknown.length ? bad(`${f}: 미지원 type ${unknown.join(', ')}`)
                 : ok(`${f} (${rules.length}룰) — 미지원 type 없음`);
}
console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
