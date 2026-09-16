#!/usr/bin/env node
/**
 * report-llm-release.test.mjs — 보고서가 **어떻게 끝나든** 28GB 모델을 반납하는가.
 *
 * 2026-09-16 실측: 11:50 회차가 `[FATAL] 치명 데이터 소스 실패(rc=2)` 로 177행에서
 *   exit 2 했다. 내려놓기는 236행(정상 종료 경로)에 있어 건너뛰었고,
 *   **28GB 가 1시간 40분 동안 남았다**(여유 2.2GB · 스왑 3.2GB/4GB).
 *   바로 위 알림 해제가 2026-09-12 에 같은 이유로 cleanup() 으로 옮겨졌는데
 *   이쪽은 안 옮겨져 있었다.
 *
 * 실제 스크립트를 읽어서 본다 — 주석이 아니라 코드가 그렇게 되어 있는지.
 */
import { readFileSync } from 'fs';
import { ROOT } from './project-root.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(`${ROOT}/scripts/run-report.sh`, 'utf8');
const lines = src.split('\n');

const unloadAt = lines.findIndex((l) => l.includes('launchctl unload') && l.includes('flowvium-llm'));
const cleanupAt = lines.findIndex((l) => /^cleanup\(\)\s*\{/.test(l));
const trapAt = lines.findIndex((l) => /^trap cleanup EXIT/.test(l));

// [1] 내려놓기가 cleanup() 안에 있는가 — 여기 있어야 모든 종료 경로에 걸린다
(unloadAt > cleanupAt && cleanupAt >= 0 && unloadAt < trapAt)
  ? ok(`모델 내려놓기가 cleanup() 안에 있다 (${cleanupAt + 1}행 < ${unloadAt + 1}행 < trap ${trapAt + 1}행)`)
  : bad(`cleanup() 밖에 있다 — cleanup ${cleanupAt + 1} / unload ${unloadAt + 1} / trap ${trapAt + 1}`);

// [2] 중단 경로들이 cleanup 보다 **뒤**에 있어야 trap 이 걸린다
{
  const fatal = lines.map((l, i) => ({ l, i }))
    .filter(({ l }) => /exit [12]\s*$/.test(l.trim()) || /exit [12];/.test(l));
  const uncovered = fatal.filter(({ i }) => i < trapAt);
  uncovered.length === 0
    ? ok(`중단 경로 ${fatal.length}곳이 모두 trap 뒤에 있다 (${fatal.map(({ i }) => i + 1).join(', ')}행)`)
    : bad(`trap 앞에서 exit 하는 곳: ${uncovered.map(({ i }) => i + 1).join(', ')}행 — 여기선 모델이 안 내려간다`);
}

// [3] SKIP 경로는 trap **앞**이어야 한다 — 남의 회차가 쓰는 모델을 내리면 안 된다
{
  const skips = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.includes('[SKIP]'));
  const risky = skips.filter(({ i }) => i > trapAt);
  (skips.length > 0 && risky.length === 0)
    ? ok(`SKIP 경로 ${skips.length}곳이 trap 앞이다 — 돌고 있는 남의 모델을 내리지 않는다`)
    : bad(`trap 뒤에서 SKIP 하는 곳: ${risky.map(({ i }) => i + 1).join(', ')}행 — 남의 28GB 를 내린다`);
}

// [4] 내려놓기가 두 번 있으면 안 된다(옮기면서 원래 것을 안 지웠는가)
{
  const n = (src.match(/launchctl unload .*flowvium-llm/g) ?? []).length;
  n === 1 ? ok('내려놓기가 한 곳뿐이다') : bad(`내려놓기가 ${n}곳 — 옮기면서 원본을 안 지웠다`);
}

// [5] 디버깅 탈출구는 남아 있는가
/REPORT_LLM_KEEP/.test(src) ? ok('REPORT_LLM_KEEP=1 로 떠 있게 둘 수 있다')
  : bad('REPORT_LLM_KEEP 탈출구가 사라졌다');

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
