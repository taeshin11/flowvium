#!/usr/bin/env node
/**
 * handoff-runbook.test.mjs — 복구 runbook 이 이 기기에 없는 것을 지시하지 않는다.
 *
 * HANDOFF.md 는 "머신 사망 시" 사람이 *그대로 실행* 하는 문서다. 다른 문서와 위험도가 다르다 —
 *   틀린 문장이 있으면 가장 급할 때 가장 크게 실패한다.
 *
 * 2026-08-22 실측: 내용이 전부 Windows 시절이었다(2026-07-01 마지막 갱신, 51일).
 *   C:\\Flowvium · G:\\내 드라이브 · schtasks · pm2 · ollama pull qwen3:8b · run-report.bat
 *   — 이 맥에서는 하나도 없다. run-report.bat 는 오늘 내가 삭제하기까지 했다.
 *   후반부 온보딩/점검 절에도 `timeout 60 …`(맥 미설치) 과 `--model=qwen3:8b`(옛 모델)가 남아 있었다.
 *
 * 금지어는 '이 기기에 존재하지 않음' 을 실제로 확인한 것만 넣는다 — 추측으로 금지하지 않는다.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const doc = readFileSync(resolve(ROOT, 'HANDOFF.md'), 'utf8');
const lines = doc.split('\n');

// '실행되는 자리' 에 있는 것만 본다. 줄 어디에든 단어가 있으면 잡던 종전 방식은
//   "timeout 은 macOS 에 없다" 라고 *설명하는* 주석까지 결함으로 셌다(실제로 오탐이 났다).
//   명령은 줄 맨 앞(또는 프롬프트 '$ '/주석 '# ' 바로 뒤)에 온다 — 그 자리만 검사한다.
const cmdAt = (l, c) => new RegExp(`^\\s*(?:[$#]\\s*)?${c}\\b`).test(l);

const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
// 실제로 없는 것만 금지어로 삼는다(확인 결과를 함께 출력)
const missing = ['schtasks', 'pm2', 'ollama', 'timeout', 'robocopy', 'setx'].filter((c) => !has(c));
console.log(`  이 기기에 없는 명령: ${missing.join(', ')}`);

const BAD_PATHS = [/C:\\/, /G:\\내 드라이브/, /run-report\.bat/, /\.ps1\b/, /run-report-hidden\.vbs/];

// 검사 범위: *실행하는* runbook 절만. 그 아래는 2026-05-31 시점 기록이라
//   옛 경로·명령이 나오는 게 정상이다(아키텍처 다이어그램 등). 대신 그 절이
//   "그대로 실행하지 말 것" 이라고 명시하는지를 따로 검사한다 — 라벨 없는 역사는 함정이다.
const histAt = lines.findIndex((l) => l.startsWith('# 📋 FlowVium 인계장'));
const runbookEnd = histAt < 0 ? lines.length : histAt;
if (histAt < 0) bad('역사 절 경계를 못 찾음 — 테스트 앵커가 낡았다');
else {
  const banner = lines.slice(histAt, histAt + 8).join('\n');
  /그대로 실행하지 말 것|실행하지 말/.test(banner)
    ? ok('역사 절에 "그대로 실행하지 말 것" 경고가 있다')
    : bad('역사 절이 시점 표시 없이 옛 명령을 담고 있다 — 새 담당자가 실행할 위험');
}

// 사람이 *복붙하는 것* 만 검사한다 = 코드펜스(```) 안.
//   종전엔 줄 어디에든 단어가 있으면 잡아, "이건 이 기기에 없다" 고 경고하는 산문까지
//   결함으로 셌다(오탐 2건 실측). 경고문을 못 쓰게 만드는 테스트는 문서를 나쁘게 만든다.
let inFence = false;
let hits = 0;
lines.slice(0, runbookEnd).forEach((l, i) => {
  if (/^\s*```/.test(l)) { inFence = !inFence; return; }
  if (!inFence) return;
  for (const c of missing) {
    if (cmdAt(l, c)) { bad(`HANDOFF.md:${i + 1} — 이 기기에 없는 '${c}' 를 실행하라고 한다: ${l.trim().slice(0, 62)}`); hits++; return; }
  }
  for (const rx of BAD_PATHS) {
    if (rx.test(l)) { bad(`HANDOFF.md:${i + 1} — 존재하지 않는 경로/파일: ${l.trim().slice(0, 62)}`); hits++; return; }
  }
});
if (!hits) ok('runbook 에 이 기기에 없는 명령·경로가 없다');

// runbook 이 지시하는 핵심 자산이 실제로 있는지
for (const [p, why] of [
  ['scripts/run-report.sh', '보고서 런처'],
  ['scripts/backup-takeover.mjs', '백업'],
  ['scripts/cron-runner.mjs', 'cron'],
]) existsSync(resolve(ROOT, p)) ? ok(`실존 확인: ${p} (${why})`) : bad(`runbook 전제 파일 없음: ${p}`);

// 갱신 시점 — 이 문서만은 오래되면 그 자체가 결함이다
const m = doc.match(/최종 검증[:\s]*(\d{4}-\d{2}-\d{2})/);
if (!m) bad("문서에 '최종 검증: YYYY-MM-DD' 가 없다 — 언제 기준인지 모르는 복구 문서는 위험하다");
else ok(`최종 검증 표기 ${m[1]}`);

console.log(fail === 0 ? '\n✅ handoff-runbook 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
