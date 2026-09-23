#!/usr/bin/env node
/**
 * machine-bound-tests.test.mjs — 이 맥에 매인 테스트가 **전제조건을 선언했는가.** 2026-09-23 신설.
 *
 * 왜: 오늘 같은 실수를 **두 번 연속** 했다.
 *   ① ci.yml 에 lib 스위트를 켜 놓고 CI 에서 안 돌려 봐서 10개가 빨간불이 났다 → 10개에 선언을 달았다.
 *   ② 바로 다음 커밋에서 만든 report-backend.test 가 또 launchd plist 를 읽어 빨간불이 났다.
 *   고치는 것만으로는 안 된다 — **다음에 또 만든다.** 그래서 만들 때 잡는다.
 *
 * 로컬에서는 전부 갖춰져 있어 스킵이 안 나고, 그래서 CI 에 가서야 드러난다.
 *   그 시차가 문제의 핵심이다. 이 테스트는 **로컬에서** 그 시차를 없앤다.
 *
 * 무엇을 보는가: 테스트 파일이 이 기계에만 있는 것을 만지는지(launchd·macOS 전용 명령·
 *   홈 밑 도구 경로), 만진다면 requires() 로 선언했거나 스스로 건너뛰는 분기가 있는지.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const LIB = resolve(ROOT, 'scripts/lib');
/** 이 기계에만 있는 것을 만지는 흔적. 주석은 세지 않는다 — 설명에 적었다고 의존은 아니다. */
const MACHINE_BOUND = [
  [/LaunchAgents/, 'launchd plist'],
  [/launchctl/, 'launchctl'],
  [/\bsay\s+-v|say\(/, 'macOS say'],
  [/vm_stat/, 'vm_stat'],
  [/\.flowvium-tools/, '홈 밑 도구 경로'],
  [/process\.platform\s*===\s*['"]darwin/, 'darwin 분기'],
];
/**
 * 선언했거나 **스스로 건너뛰는** 흔적.
 * 2026-09-23: 처음엔 `SKIP` 글자만 봤더니 llm-memory.test 를 오탐했다 —
 *   거기는 `– plist 없음 — 이 기계 전용 검사 건너뜀` 으로 이미 건너뛰고 있었다.
 *   헛우는 게이트는 곧 무시당한다. 사람이 쓰는 말로 넓힌다.
 */
const DECLARED = [/requires\s*\(/, /SKIP_CODE/, /LIB_TEST_AS_CI/,
  /console\.log\([^)]*(SKIP|건너뜀|건너뛴|skip)/i];

const stripComments = (src) => String(src)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * **다른 소스를 검색하는** 용도는 기계 의존이 아니다.
 * 2026-09-23: report-llm-release.test 는 run-report.sh 의 본문에서 'launchctl unload' 를
 *   찾는다 — 이 기계에 launchctl 이 없어도 돈다(실제로 CI 에서 통과한다).
 *   includes/match/test 의 인자로 들어간 것은 데이터이지 호출이 아니다. 빼고 본다.
 */
const stripSearchArgs = (src) => String(src)
  .replace(/\.(includes|match|test|search|replace)\s*\([^)]*\)/g, '.$1()');

const offenders = [];
for (const f of readdirSync(LIB).filter((x) => x.endsWith('.test.mjs'))) {
  if (f === 'machine-bound-tests.test.mjs') continue;   // 자기 자신은 위 정규식을 문자열로 들고 있다
  const raw = readFileSync(resolve(LIB, f), 'utf8');
  const code = stripSearchArgs(stripComments(raw));
  const hits = MACHINE_BOUND.filter(([re]) => re.test(code)).map(([, name]) => name);
  if (!hits.length) continue;
  if (DECLARED.some((re) => re.test(code))) continue;
  offenders.push(`${f} (${hits.join('·')})`);
}

// [1] 기계에 매인 테스트는 전부 선언돼 있어야 한다
offenders.length === 0
  ? ok(`[1] 기계 의존 테스트가 전부 전제조건을 선언했다 (lib ${readdirSync(LIB).filter((x) => x.endsWith('.test.mjs')).length}개 검사)`)
  : bad(`[1] 선언 없는 기계 의존 테스트 ${offenders.length}개 — CI(우분투)에서 빨간불이 난다:\n       ${offenders.join('\n       ')}\n     → requires({ macos:true, launchd:[...], paths:[...] }) 를 달거나 그 단언만 건너뛰게 할 것`);

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
