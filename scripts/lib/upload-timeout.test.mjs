#!/usr/bin/env node
/**
 * upload-timeout.test.mjs — 쇼츠 업로드 자식 프로세스에 상한이 있는가. 2026-10-20 신설.
 *
 * 코드 점검(사장님 지시 10/20, Claude 서브에이전트·ChatGPT 둘 다 REAL): video-publish 의 run() 은 spawnSync 에 timeout 이 없고,
 *   업로드(yt.videos.insert)에도 요청 상한이 없다. 소켓 하나가 멎으면 video-publish 가 락을 쥔 채 영영 살아 있고,
 *   뒤 슬롯은 락을 15분 기다리다 '건너뜀 … 겹치지 않는다'(정상처럼 읽히는 말)로 끝난다 — 조용히 하루가 빈다.
 *   렌더 호출에는 이미 RENDER_TIMEOUT_MS 가 있다. 업로드만 비어 있었다.
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const pub = readFileSync(new URL('../video-publish.mjs', import.meta.url), 'utf8');
const runDef = /const run = \([^)]*\) => \{[\s\S]*?\n\};/.exec(pub)?.[0] ?? '';
(/spawnSync\(node, args, \{[^}]*timeout:/.test(runDef) && /killSignal: 'SIGKILL'/.test(runDef))
  ? ok('[1] run() 의 spawnSync 에 상한·SIGKILL') : bad('[1] run() 에 상한이 없다 — 멎은 업로드가 락을 영영 쥔다');
(/ETIMEDOUT/.test(runDef)) ? ok('[2] 시간 초과를 따로 적는다(고장으로 보이게)') : bad('[2] 시간 초과가 다른 실패와 구분되지 않는다');
/run\(upArgs, '업로드', UPLOAD_TIMEOUT_MS\)/.test(pub) ? ok('[3] 업로드가 상한을 넘긴다') : bad('[3] 업로드 호출에 상한이 없다');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
