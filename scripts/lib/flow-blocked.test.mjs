#!/usr/bin/env node
/**
 * flow-blocked.test.mjs — Flow 를 Playwright 로 조작하지 않는다. 2026-09-25 신설.
 *
 * 규칙(사장님 승인 9/25, 드라이브 _bridge/FLOW_RULES.md): spinaiceo 계정 하나를 여러 기계가 같이 써서
 *   하루 다섯 번 「비정상적인 활동」 차단을 맞았다. "CDP·Playwright 로 Flow 조작 금지 — Flow 는 평소 크롬 + 사람 손으로만."
 * 이 저장소의 flow-*.mjs 9개가 모두 openFlow() 로 들어간다 — 입구 한 곳에서 막는다.
 * 브라우저를 **띄우기 전에** 멈춰야 한다(띄우는 것 자체가 자동화 세션이다).
 */
import { openFlow } from './flow.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const t0 = Date.now();
try {
  const r = await openFlow({ headless: true });
  await r?.ctx?.close?.();
  bad('openFlow 가 브라우저를 띄웠다 — Flow 자동화가 막히지 않았다');
} catch (e) {
  (/FLOW_RULES|자동화 금지/.test(String(e.message)) && Date.now() - t0 < 2000)
    ? ok(`띄우기 전에 멈춘다: ${String(e.message).split('\n')[0].slice(0, 70)}`)
    : bad(`다른 이유로 실패했다(${Date.now() - t0}ms): ${String(e.message).slice(0, 100)}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
