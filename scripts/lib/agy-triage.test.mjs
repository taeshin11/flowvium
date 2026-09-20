#!/usr/bin/env node
/** agy-triage.test.mjs — 진단을 넘길 때 무엇을 요구하는가. 2026-09-20 신설. */
import { evidenceBundle, collect, triagePrompt } from './agy-triage.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 증거 묶음에 경보 원문이 들어간다 — 경보 없이 추론시키면 엉뚱한 데를 판다
{
  const b = evidenceBundle('[G] /insider 0건');
  b[0].text === '[G] /insider 0건' ? ok('[1] 경보 원문 포함') : bad(`[1] ${JSON.stringify(b[0])}`);
  b.length >= 4 ? ok(`[1b] 증거 ${b.length}종`) : bad('[1b] 증거가 너무 적다');
}

// [2] 실패한 명령도 증거다 — 조용히 버리면 "왜 실패했는지" 가 사라진다
{
  const r = collect([{ name: '없는명령', cmd: 'this-command-does-not-exist-xyz' }], { cwd: process.cwd() });
  r[0].body.length > 0 ? ok(`[2] 실패 출력도 담는다: ${r[0].body.trim().slice(0, 40)}`) : bad('[2] 실패가 사라졌다');
}

// [3] 프롬프트가 **고치라고 시키지 않는다** — 이 단계는 좁히기다
{
  const p = triagePrompt('x');
  /고치는 것이 아니라 좁히는 것/.test(p) ? ok('[3] 좁히기로 못박는다') : bad('[3] 범위 제한 없음');
  /터미널 명령은 쓸 수 없다/.test(p) ? ok('[3b] 셸 없음을 알린다') : bad('[3b]');
}

// [4] 후보를 **가르는** 명령을 요구한다 — 같은 결과를 내는 check 는 쓸모없다
{
  /갈라지는 것을 써라/.test(triagePrompt('x')) ? ok('[4] 판별 명령을 요구') : bad('[4]');
}

// [5] 이미 해 보고 버린 방법을 묻는다 — 오늘 그걸 안 물어서 만든 것을 버렸다
{
  /이미 해 보고 버린/.test(triagePrompt('x')) ? ok('[5] 폐기 이력을 묻는다') : bad('[5]');
}

// [6] 모르는 것을 모른다고 적게 한다
{
  /모르는 것을 아는 것처럼 쓰지 마라/.test(triagePrompt('x')) ? ok('[6] unknown 요구') : bad('[6]');
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
