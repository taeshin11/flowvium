#!/usr/bin/env node
/**
 * run-report-selfcopy.test.mjs — 사본으로 갈아타도 저장소를 제대로 찾는가.
 *
 * 배경(2026-09-13~14): 실행 중 편집으로 회차가 죽는 걸 막으려고 run-report.sh 가
 *   자기 사본을 /var/folders 에 만들어 exec 하게 바꿨다. 그런데 스크립트가 APP_DIR 을
 *   `dirname(dirname($BASH_SOURCE))` 로 구한다 — 사본 위치 기준이면 저장소가 아니다.
 *     Error: Cannot find module '/var/folders/.../scripts/llm-health-check.mjs'
 *   **회차 다섯 번(09-13 오후 ~ 09-14 점심)이 통째로 죽었다.** 24시간 동안 보고서가 없었다.
 *   편집 사고를 막으려던 변경이 더 큰 사고를 냈다.
 *
 *   그때 붙였던 시험은 "편집해도 완주하는가" 만 봤다. 그 시험 스크립트는 BASH_SOURCE 로
 *   경로를 구하지 않아서 이 결함을 볼 수 없었다. **진짜 스크립트를 돌려 봐야 잡힌다.**
 *
 * 그래서 여기서는 run-report.sh 자체를 돌린다. LLM 대기 전까지만 가면 충분하다 —
 *   APP_DIR 이 틀리면 그 지점에 닿기도 전에 죽는다.
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { ROOT } from './project-root.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const script = join(ROOT, 'scripts/run-report.sh');
if (!existsSync(script)) { bad('run-report.sh 없음'); process.exit(1); }

// [1] 사본으로 갈아타는 배선이 남아 있는가 (편집 사고 방지책이 사라지면 안 된다)
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(script, 'utf8');
  /REPORT_SELF_COPY/.test(src) && /exec bash/.test(src)
    ? ok('실행 중 편집 대비 자기 사본 배선이 있다')
    : bad('자기 사본 배선이 사라졌다 — 실행 중 편집에 다시 취약해진다');
  /APP_DIR="\$_orig_app"/.test(src)
    ? ok('사본에 원본 APP_DIR 을 넘긴다')
    : bad('사본이 APP_DIR 을 물려받지 못한다 — /var/folders 를 저장소로 착각한다');
}

// [2] 실제로 돌려 본다. LLM 이 없어도 **모듈을 못 찾는 오류는 나오면 안 된다.**
{
  const r = spawnSync('bash', [script, '--session=__selftest__'], {
    encoding: 'utf8', timeout: 45_000,
    env: { ...process.env, LLM_WAIT_S: '1', SKIP_PREFLIGHT: '1', SKIP_INGEST: '1', SKIP_LLM_PROBE: '1' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  /MODULE_NOT_FOUND|Cannot find module/.test(out)
    ? bad(`모듈을 못 찾는다 — APP_DIR 이 틀렸다:\n         ${(out.match(/Cannot find module.*/) ?? [''])[0].slice(0, 110)}`)
    : ok('모듈 해석 오류 없음 (APP_DIR 이 저장소를 가리킨다)');

  /var\/folders/.test(out) && /scripts\//.test(out)
    ? bad(`임시폴더 경로로 저장소 파일을 찾고 있다:\n         ${(out.match(/\/var\/folders[^\s'"]*/) ?? [''])[0].slice(0, 110)}`)
    : ok('임시폴더를 저장소로 착각하지 않는다');

  // APP_DIR 검증 관문이 실제로 작동하는가 — 틀린 값을 주면 즉시 멈춰야 한다
  const badRun = spawnSync('bash', [script, '--session=__selftest__'], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, APP_DIR: '/tmp', LLM_WAIT_S: '1' },
  });
  const bo = `${badRun.stdout ?? ''}${badRun.stderr ?? ''}`;
  badRun.status === 4 && /저장소가 아니다/.test(bo)
    ? ok('APP_DIR 이 틀리면 15분 기다리지 않고 즉시 멈춘다')
    : bad(`틀린 APP_DIR 로도 진행한다 (exit ${badRun.status}) — 15분 뒤에야 실패한다`);
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
