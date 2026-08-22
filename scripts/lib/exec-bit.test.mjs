#!/usr/bin/env node
/**
 * exec-bit.test.mjs — 직접 실행되는 스크립트가 git 에 실행권한으로 커밋돼 있는가.
 *
 * 배경(2026-08-22): CI 환경을 시뮬레이션하려고 저장소를 깨끗이 clone 해서 테스트를 돌렸더니
 *   report-launcher.test.mjs 가 "런처가 실행 불가(chmod +x 안 됨)" 로 실패했다. 확인해 보니:
 *
 *     로컬 파일:  -rwxr-xr-x  scripts/run-report.sh     ← 실행 가능
 *     git 인덱스: 100644      scripts/run-report.sh     ← 실행 불가
 *
 *   저장소의 .sh 16개 전부가 100644 였다. 로컬에서만 chmod 를 했고 그게 커밋되지 않았다.
 *
 * 왜 심각한가: launchd 잡이 이 파일들을 **argv[0] 로 직접** 실행한다 —
 *     com.spinai.flowvium-report-{morning,noon,afternoon,evening,midnight} → scripts/run-report.sh
 *     com.spinai.flowvium-embed                                            → scripts/rag/serve-embed.sh
 *   argv[0] 실행은 실행권한이 없으면 EACCES 로 실패한다. 즉 **깨끗한 clone 에서는
 *   보고서 잡 5개와 임베딩 서비스가 기동하지 못한다.** 깨끗한 clone 이란 곧
 *   HANDOFF.md 의 '기기 사망 시 복구' 상황이고, 런북이 정작 필요한 순간에 깨진다.
 *   이 기기에서는 로컬 파일이 이미 실행 가능해서 몇 달간 아무 증상이 없었다 —
 *   현재 기기에서 안 보이는 결함이라 실행해 보는 것만으로는 절대 안 잡힌다.
 *
 * 규칙: **shebang 이 있는 `.sh` 는 실행 의도의 선언이다. 실행권한으로 커밋한다.**
 *   (`.mjs` 는 `node <path>` 로 불리므로 대상이 아니다 — 실제 launchd argv[0] 도 전부 node 다.)
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let rows;
try {
  rows = execFileSync('git', ['ls-files', '-s', '--', '*.sh'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .map((l) => { const m = l.match(/^(\d{6})\s+\S+\s+\d+\t(.+)$/); return m ? { mode: m[1], path: m[2] } : null; })
    .filter(Boolean);
} catch (e) {
  bad(`git ls-files 실패: ${String(e.message).slice(0, 60)} — 이 검사는 git 저장소 안에서만 유효하다`);
  console.log('\n❌ 1건 실패'); process.exit(1);
}

rows.length ? ok(`추적 중인 .sh ${rows.length}개`) : bad('.sh 가 하나도 없다 — 앵커가 낡았다');

const shebanged = rows.filter((r) => {
  try { return readFileSync(resolve(ROOT, r.path), 'utf8').startsWith('#!'); } catch { return false; }
});
const notExec = shebanged.filter((r) => r.mode !== '100755');

notExec.length
  ? bad(`shebang 이 있는데 실행권한 없이 커밋된 .sh ${notExec.length}건: ${notExec.map((r) => r.path).join(', ')}`)
  : ok(`shebang 이 있는 .sh ${shebanged.length}개 전부 100755 로 커밋됨`);

console.log(fail === 0 ? '\n✅ exec-bit 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
