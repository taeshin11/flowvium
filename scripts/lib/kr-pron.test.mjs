#!/usr/bin/env node
/**
 * kr-pron.test.mjs — 낱말을 소리 나는 대로(된소리). 2026-09-25 신설.
 * 사장님(테크이슈 세션 공지 1항): "불법 을 '불 법' 이렇게 읽는다… 이것만이 아니고 다른 것도 다 그래."
 * Melo g2p 는 사전 허용 발음 중 된소리를 넣지 않아 [불법] 으로 끊어 읽는다. 뉴스 발음은 [불뻡].
 * 귀로 확인한 낱말만 표에 올린다(규칙으로 넓히면 멀쩡한 낱말까지 바뀐다). 자막에는 원문이 간다.
 */
import { speakWords } from './kr-pron.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const cases = [['불법 체류자', '불뻡 체류자'], ['불법적인 거래', '불뻡적인 거래'], ['불법행위', '불뻡행위'], ['법원 판결', '법원 판결']];
for (const [i, w] of cases) speakWords(i) === w ? ok(`${i} → ${w}`) : bad(`${i} → ${speakWords(i)} (기대 ${w})`);
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
