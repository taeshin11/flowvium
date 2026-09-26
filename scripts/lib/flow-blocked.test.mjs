#!/usr/bin/env node
/**
 * flow-blocked.test.mjs — Flow 를 Playwright 로 조작하지 않는다(예외: Omni Flash ×1). 2026-09-25 신설 · 09-26 개정.
 *
 * 9/25 FLOW_RULES 2항: CDP·Playwright 로 Flow 조작 금지. 9/26 사장님: 소재가 모자라면 **Omni Flash ×1(크레딧)** 은
 *   자동으로 써도 된다(되물어 확인 — "Omni Flash ×1 만 허용"). 그 밖의 목적(무료 Veo·그림·로그인 창…)은 그대로 막는다.
 * 입구(openFlow) 하나에서 가른다 — 목적이 안 맞으면 브라우저를 띄우기 **전에** 던진다.
 * flow-clip 이 그 목적일 때 모델=Omni·개수=x1 을 화면에서 확인하는지는 소스로 본다(실제 확인은 18시 이후 첫 회차).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from './project-root.mjs';
import { openFlow } from './flow.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 목적 없이 → 띄우기 전에 멈춘다
{
  delete process.env.FLOW_PURPOSE;
  const t0 = Date.now();
  try { const r = await openFlow({ headless: true }); await r?.ctx?.close?.(); bad('[1] 목적 없이 브라우저를 띄웠다'); }
  catch (e) { (/FLOW_RULES|자동화 금지/.test(e.message) && Date.now() - t0 < 2000) ? ok('[1] 목적 없음 → 띄우기 전에 멈춘다') : bad(`[1] ${e.message.slice(0, 80)}`); }
}
// [2] 다른 목적(예: 무료 Veo) → 멈춘다
{
  process.env.FLOW_PURPOSE = 'free-veo';
  try { const r = await openFlow({ headless: true }); await r?.ctx?.close?.(); bad('[2] 다른 목적으로 띄웠다'); }
  catch (e) { /자동화 금지/.test(e.message) ? ok('[2] 다른 목적 → 멈춘다') : bad(`[2] ${e.message.slice(0, 80)}`); }
  delete process.env.FLOW_PURPOSE;
}
// [3] flow-clip: Omni 목적이면 모델·개수·유료허용을 확인한다(소스)
{
  const src = readFileSync(join(ROOT, 'scripts/flow-clip.mjs'), 'utf8');
  (/omni-flash-x1/.test(src) && /readComposerChip/.test(src) && /\\bx1\\b/.test(src) && /readVideoModel/.test(src))
    ? ok('[3] flow-clip 이 Omni 목적일 때 모델(Omni)·개수(x1)를 화면에서 확인한다') : bad('[3] flow-clip 에 Omni ×1 확인이 없다');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
