#!/usr/bin/env node
/**
 * outro-locale.test.mjs — 광고 클립이 로케일을 받되, 못 읽는 말을 읽지 않는가.
 *
 * 배경(2026-09-15): 같은 광고를 일본어로도 붙이게 됐다(옆 세션 K연예 채널).
 *   사본을 뜨면 시간이 지나 어긋나므로 문구만 갈아끼우게 고쳤다.
 *
 * 여기서 못박는 것은 **조용히 틀리지 않는 것** 둘이다:
 *   · 우리 TTS 는 한국어 전용이다. ja 로케일에서 그대로 부르면 한국어 발음으로 일본어를 읽는다.
 *     그렇게 나가는 게 제일 나쁘다 — 소리를 못 만들면 멈춰야 한다.
 *   · 모르는 로케일은 통과시키지 않는다.
 */
import { spawnSync } from 'child_process';
import { join } from 'path';
import { ROOT } from './project-root.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const script = join(ROOT, 'scripts/video/make-outro-clip.mjs');
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 60_000 });

// [1] 소리 수단이 없는 로케일은 멈춘다 — 한국어 발음으로 읽히지 않게
{
  const r = run(['--locale', 'ja']);
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  (r.status === 2 && /한국어 전용/.test(out))
    ? ok('ja 로케일은 소리 없이 진행하지 않는다 (--audio 를 요구한다)')
    : bad(`ja 로케일이 그냥 진행한다 (exit ${r.status})`);
  /話すだけで/.test(out)
    ? ok('일본어 문구가 실제로 들어 있다')
    : bad('일본어 문구가 안 나온다');
}

// [2] 모르는 로케일은 막는다
{
  const r = run(['--locale', 'fr']);
  (r.status === 2 && /모르는 로케일/.test(`${r.stdout}${r.stderr}`))
    ? ok('모르는 로케일은 막는다')
    : bad(`모르는 로케일이 통과한다 (exit ${r.status})`);
}

// [3] 한국어 기본 경로가 그대로다 — make-shorts 가 이 경로를 본다
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(script, 'utf8');
  /assets\/outro\/aisvi\$\{LOCALE === 'ko' \? '' : `-\$\{LOCALE\}`\}\.mp4/.test(src)
    ? ok("한국어는 종전 경로(assets/outro/aisvi.mp4) 유지, 다른 로케일만 파일을 나눈다")
    : bad('한국어 출력 경로가 바뀌었다 — make-shorts 가 못 찾는다');
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
