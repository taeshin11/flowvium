#!/usr/bin/env node
/**
 * agy-do.mjs — 코드 작업을 agy 에게 맡기고 테스트로 받아낸다.
 *
 *   node scripts/agy-do.mjs --task <명세파일> --test "node scripts/lib/foo.test.mjs" [--rounds 3]
 *   node scripts/agy-do.mjs --task <명세파일> --test all      # run-lib-tests 전체
 *
 * 왜 (2026-09-20, 사용자 "클로드를 최소로 쓰면서 antigravity 통해 할수는 없어?"):
 *   실측 — agy 는 명세가 분명한 모듈 하나를 4분에 써낸다. 그런데 헤드리스에서는
 *   자기 테스트를 돌려 볼 수 없어(권한 프롬프트를 못 띄운다) **깨진 채로 내놓는다**.
 *   첫 판 6건 중 1건 실패. 실패 출력을 그대로 되먹였더니 2회차에 통과했다.
 *   그 왕복이 사람이 끼던 자리다. 여기서 자동으로 돈다.
 *
 * 커밋은 하지 않는다. 무엇이 바뀌었는지 보여 주고 끝낸다 — 올릴지는 사람이 정한다.
 *   (이 저장소의 크론은 origin/master 를 checkout 한다. 커밋·푸시는 사람의 판단이다.)
 *
 * ⚠ 이 루프가 보장하는 것은 "명세대로 됐는가" 뿐이다. **명세가 옳은가는 못 본다.**
 *   실측에서 agy 는 내가 준 틀린 명세를 그대로 구현했고, 그 모듈이 막으려던 실제 사고를
 *   못 잡는다는 것도 지적하지 않았다. 무엇을 만들지 정하는 일은 여전히 사람이 한다.
 */
import { readFileSync, existsSync } from 'fs';
import { spawnSync, execSync } from 'child_process';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { buildFeedback, roundVerdict, runAgy } from './lib/agy-task.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const TASK = arg('task');
const ROUNDS = Number(arg('rounds', 3));
let TEST = arg('test', 'all');
if (TEST === 'all') TEST = 'node scripts/run-lib-tests.mjs';

if (!TASK || !existsSync(resolve(TASK))) {
  console.error('사용: node scripts/agy-do.mjs --task <명세파일> --test "<테스트 명령>" [--rounds 3]');
  process.exit(2);
}

const sh = (c) => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const dirty = () => sh('git status --porcelain').split('\n').filter(Boolean).length;

const before = dirty();
let prompt = readFileSync(resolve(TASK), 'utf8')
  // 헤드리스 agy 는 셸 권한 프롬프트를 못 띄운다. 쓰지 말라고 명시하지 않으면 작업이 통째로 취소된다.
  + '\n\n## 도구 제한\n터미널 명령을 쓰지 마라(node·ls·cat·git 전부). 파일만 읽고 써라.'
  + '\n테스트는 내가 대신 돌려서 실패를 알려 준다.';

let passed = false;
for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n── ${round}/${ROUNDS} 회차 — agy 에게 맡긴다 ──`);
  const t0 = Date.now();
  const r = runAgy(prompt, { dir: ROOT });
  if (!r.ok) { console.error(`  ❌ ${r.why}`); process.exit(1); }
  console.log(`  agy ${Math.round((Date.now() - t0) / 1000)}초`);

  const tr = spawnSync('bash', ['-lc', TEST], { cwd: ROOT, encoding: 'utf8', timeout: 900_000, maxBuffer: 16 * 1024 * 1024 });
  const out = `${tr.stdout ?? ''}${tr.stderr ?? ''}`;
  passed = tr.status === 0;
  console.log(`  ${roundVerdict({ round, passed, changedFiles: dirty() - before })}`);
  if (passed) break;
  console.log(out.split('\n').filter((l) => /FAIL|✖|❌|Error/.test(l)).slice(0, 6).map((l) => `    ${l}`).join('\n'));
  prompt = buildFeedback({ round, testCmd: TEST, output: out });
}

console.log('\n── 바뀐 것 ──');
console.log(sh('git status --porcelain') || '  (없음)');
console.log(sh('git diff --stat') || '');
console.log(passed
  ? '\n✅ 테스트 통과. 커밋은 하지 않았다 — 내용을 보고 올릴지 정할 것.'
  : `\n❌ ${ROUNDS}회차까지 통과 못 했다. 명세가 틀렸을 수 있다 — 무엇을 만들지부터 다시 볼 것.`);
process.exit(passed ? 0 : 1);
