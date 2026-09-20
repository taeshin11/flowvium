/**
 * agy-task.mjs — agy 에게 코드 작업을 맡기고 **테스트로 받아내는** 루프. (2026-09-20 신설)
 *
 * 왜 (사용자 "클로드를 최소로 쓰면서 antigravity 통해 할수는 없어?"):
 *   실측해 보니 agy 는 명세가 분명한 모듈 하나를 4분에 써낸다. 다만 헤드리스에서는
 *   **자기가 쓴 테스트를 돌려 볼 수 없다** — 권한 프롬프트를 띄울 수 없어 셸이 막힌다.
 *   그래서 첫 판 결과물은 자기 테스트가 깨진 채로 나왔다(실측: 6건 중 1건 실패).
 *   돌려 보고 고치는 일을 사람이 대신 해 주면 2회차에 통과한다.
 *
 *   그 왕복이 바로 사람(또는 클로드)이 끼는 자리다. 여기서 자동화한다 —
 *   agy 가 쓰고, **이 스크립트가 테스트를 돌리고**, 깨지면 그 출력을 그대로 되먹인다.
 *
 * 한계를 정직하게 적어 둔다: 이 루프는 "명세대로 됐는가" 만 본다.
 *   **명세가 옳은가는 못 본다.** 실측에서 agy 는 내가 준 틀린 명세(라틴 대문자면 고유명사)를
 *   그대로 구현했고, 그 모듈이 막으려던 실제 사고를 못 잡는다는 것도 지적하지 않았다.
 *   오히려 "이 사고는 잡히지 않는다" 를 테스트로 굳혔다. 무엇을 만들지 정하는 일은 사람이 한다.
 */
import { spawnSync } from 'child_process';
import { agyBin, agyReady } from './agy.mjs';

/** 테스트 출력에서 되먹일 부분만 남긴다. 전부 보내면 프롬프트가 로그로 가득 찬다. */
export function trimTestOutput(out, { maxLines = 40 } = {}) {
  const lines = String(out ?? '').split('\n');
  const fails = lines.filter((l) => /FAIL|✖|❌|Error|error|not ok/.test(l));
  // 실패 줄이 있으면 그것만, 없으면(예: 컴파일 오류) 끝부분을 준다 — 원인이 대개 끝에 있다.
  const keep = fails.length ? fails : lines.filter(Boolean).slice(-maxLines);
  return keep.slice(0, maxLines).join('\n');
}

/**
 * 다음 판에 보낼 프롬프트. **무엇이 깨졌는지**만 주고 고치는 방법은 주지 않는다 —
 * 방법까지 적으면 내가 코드를 쓰는 것과 같아서 맡기는 뜻이 없다.
 */
export function buildFeedback({ round, testCmd, output }) {
  return [
    `방금 네 수정본으로 \`${testCmd}\` 를 돌렸더니 실패했다(${round}회차).`,
    '',
    '```',
    trimTestOutput(output),
    '```',
    '',
    '실패한 것만 고쳐라. 통과한 테스트의 기대값을 바꿔서 맞추지 마라 —',
    '기대값이 틀렸다고 생각하면 고치기 전에 **왜 틀렸는지 주석으로 적고** 고쳐라.',
    '터미널 명령은 쓰지 마라. 파일만 고치면 내가 다시 돌려 본다.',
  ].join('\n');
}

/** 한 판 돌린 결과를 사람 말로. */
export function roundVerdict({ round, passed, changedFiles }) {
  if (passed) return `${round}회차 통과 · 바뀐 파일 ${changedFiles}개`;
  return `${round}회차 실패 · 바뀐 파일 ${changedFiles}개 — 실패 출력을 되먹인다`;
}

/**
 * agy 에게 프롬프트 하나를 던진다(파일 수정 허용). 성공 여부만 돌려준다.
 * 셸은 막아 둔다 — 헤드리스에서 어차피 권한 프롬프트를 못 띄우고, 막아야 범위가 좁다.
 */
export function runAgy(prompt, { dir, model, timeoutMs = 900_000 } = {}) {
  const bin = agyBin();
  if (!bin || !agyReady()) return { ok: false, why: 'agy 준비 안 됨' };
  const r = spawnSync(bin, ['-p', prompt,
    '--model', model || process.env.AGY_TEXT_MODEL || 'gemini-3.1-pro-high',
    '--mode', 'accept-edits', '--effort', 'high', '--sandbox', '--add-dir', dir],
  { cwd: dir, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  // 권한 거부로 "no output produced" 가 떠도 **파일 수정은 반영돼 있을 수 있다**(실측).
  //   그래서 종료코드로 성공을 판정하지 않는다 — 판정은 테스트가 한다.
  return { ok: true, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
