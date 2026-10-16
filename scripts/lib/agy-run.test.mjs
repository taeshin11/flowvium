#!/usr/bin/env node
/**
 * agy-run.test.mjs — agy 가 답을 다 내고도 **안 끝나는** 경우를 실행기가 견디는지. 2026-10-16 신설.
 *
 * 왜(10/16 실측): agy 1.3.6(03:05 자동 업데이트) 부터 보고서 portfolio 호출이 매번 3600초 시간 초과로 비었다
 *   (morning·noon 6/6, 사슬 두 모델 다). 고아 agy 가 5~8시간 살아 있었다.
 *   - SIGQUIT 덤프: main 고루틴이 CascadeManager.Shutdown → background Pool.close 에서 480분 대기,
 *     막힌 일은 maybeGenerateConversationTitle(대화 제목 짓기) 의 비스트리밍 호출.
 *   - 재현(같은 프롬프트): **75초에 stdout 으로 완전한 JSON** 이 나왔는데 프로세스는 안 끝났고,
 *     SIGTERM 도 무시(같은 종료 경로로 들어가 또 멈춘다) — SIGKILL 로만 끝났다.
 *   - 그래서 execFile 은 'close' 를 영영 못 받아 시간 초과까지 기다렸고, abort 의 SIGTERM 은 안 먹어 고아가 남았다.
 *   - spawnSync 는 timeout 이 나도 자식이 끝날 때까지 기다린다(실측: SIGTERM 무시 자식에 timeout 1초 → 12초 대기).
 * 그래서: 결과(완전한 JSON)가 오면 끝을 기다리지 않고 돌려준 뒤 SIGTERM→SIGKILL 로 거둔다. 동기 호출도 같은 실행기를 쓴다.
 * 가짜 agy: 받은 JSON 을 찍고 SIGTERM 을 무시하며 영영 잔다 — 실측과 같은 모양.
 */
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 'agy-run-test-'));
const fake = join(dir, 'fake-agy');
// 인자: --mode <hang|exit|silent|fail>. 자기 pid 를 pidfile 에 남긴다(거둬졌는지 보려고).
writeFileSync(fake, `#!/usr/bin/env node
const mode = process.argv[process.argv.indexOf('--mode') + 1];
require('fs').writeFileSync(${JSON.stringify(join(dir, 'pid-'))} + mode, String(process.pid));
process.on('SIGTERM', () => {});   // agy 1.3.6 처럼 SIGTERM 을 먹지 않는다
const env = JSON.stringify({ conversation_id: 'c1', status: 'success', response: '{"a":1}', num_turns: 1 }, null, 2);
if (mode === 'fail') { process.stderr.write('boom'); process.exit(3); }
if (mode !== 'silent') { const h = Math.floor(env.length / 2); process.stdout.write(env.slice(0, h)); setTimeout(() => process.stdout.write(env.slice(h) + '\\n'), 200); }
if (mode === 'exit') setTimeout(() => process.exit(0), 400);
else setInterval(() => {}, 1000);   // 영영 안 끝난다
`);
chmodSync(fake, 0o755);
const pidOf = (mode) => Number(readFileSync(join(dir, `pid-${mode}`), 'utf8'));

let mod = null;
try { mod = await import('./agy-run.mjs'); } catch (e) { bad(`[0] scripts/lib/agy-run.mjs 를 못 불러왔다: ${e.message}`); }

if (mod) {
  const { runAgy, runAgySync } = mod;
  {
    const t0 = Date.now();
    const r = await runAgy(fake, ['--output-format', 'json', '--mode', 'hang'], { timeoutMs: 20000, graceMs: 300 }).catch((e) => ({ err: e }));
    const sec = (Date.now() - t0) / 1000;
    r?.stdout && JSON.parse(r.stdout).response === '{"a":1}' && sec < 5
      ? ok(`[1] 완전한 JSON 이 오면 끝을 안 기다리고 돌려준다(${sec.toFixed(1)}초, 시간 초과 20초)`)
      : bad(`[1] ${sec.toFixed(1)}초 ${r?.err?.message ?? JSON.stringify(r).slice(0, 120)}`);
    await sleep(800);
    !alive(pidOf('hang')) ? ok('[2] 답을 받은 뒤 SIGTERM 무시하는 agy 를 SIGKILL 로 거뒀다(고아 없음)') : bad(`[2] pid ${pidOf('hang')} 가 살아 있다`);
  }
  {
    const r = await runAgy(fake, ['--output-format', 'json', '--mode', 'exit'], { timeoutMs: 20000, graceMs: 300 }).catch((e) => ({ err: e }));
    r?.stdout && JSON.parse(r.stdout).status === 'success' ? ok('[3] 정상 종료하는 agy 도 그대로 받는다') : bad(`[3] ${r?.err?.message}`);
  }
  {
    const t0 = Date.now();
    const r = await runAgy(fake, ['--output-format', 'json', '--mode', 'silent'], { timeoutMs: 1000, graceMs: 300 }).catch((e) => ({ err: e }));
    const sec = (Date.now() - t0) / 1000;
    r?.err?.name === 'AbortError' && sec < 4 ? ok(`[4] 답이 없으면 시간 초과는 AbortError(${sec.toFixed(1)}초)`) : bad(`[4] ${sec.toFixed(1)}초 ${r?.err?.name} ${r?.err?.message}`);
    await sleep(800);
    !alive(pidOf('silent')) ? ok('[5] 시간 초과 뒤 SIGTERM 무시하는 agy 를 SIGKILL 로 거뒀다') : bad(`[5] pid ${pidOf('silent')} 가 살아 있다`);
  }
  {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const r = await runAgy(fake, ['--output-format', 'json', '--mode', 'silent'], { timeoutMs: 20000, graceMs: 300, signal: ac.signal }).catch((e) => ({ err: e }));
    r?.err?.name === 'AbortError' ? ok('[6] 호출부 signal 로도 끊긴다') : bad(`[6] ${r?.err?.name}`);
  }
  {
    const r = await runAgy(fake, ['--output-format', 'json', '--mode', 'fail'], { timeoutMs: 20000, graceMs: 300 }).catch((e) => ({ err: e }));
    r?.err && r.err.code === 3 && /boom/.test(r.err.stderr) ? ok('[7] 0 아닌 종료는 execFile 처럼 code·stderr 를 실은 오류') : bad(`[7] ${JSON.stringify(r?.err ?? r).slice(0, 120)}`);
  }
  {
    const t0 = Date.now();
    const r = runAgySync(fake, ['--output-format', 'json', '--mode', 'hang'], { timeoutMs: 20000, graceMs: 300 });
    const sec = (Date.now() - t0) / 1000;
    r.status === 0 && JSON.parse(r.stdout).response === '{"a":1}' && sec < 8
      ? ok(`[8] 동기 실행기도 JSON 이 오면 바로 돌려준다(${sec.toFixed(1)}초)`) : bad(`[8] ${sec.toFixed(1)}초 status=${r.status} ${r.error?.code ?? ''} ${String(r.stderr).slice(0, 80)}`);
    await sleep(800);
    !alive(pidOf('hang')) ? ok('[9] 동기 실행기도 agy 를 거뒀다') : bad(`[9] pid ${pidOf('hang')} 가 살아 있다`);
  }
  {
    const t0 = Date.now();
    const r = runAgySync(fake, ['--output-format', 'json', '--mode', 'silent'], { timeoutMs: 1000, graceMs: 300 });
    const sec = (Date.now() - t0) / 1000;
    r.error?.code === 'ETIMEDOUT' && sec < 5 ? ok(`[10] 동기 시간 초과는 spawnSync 처럼 ETIMEDOUT(${sec.toFixed(1)}초 — 예전엔 끝없이 기다렸다)`) : bad(`[10] ${sec.toFixed(1)}초 ${r.error?.code} status=${r.status}`);
  }
}
if (mod) {
  const { isFinalEnvelope } = mod;
  !isFinalEnvelope('{"progress":1}') && isFinalEnvelope('\x1b[0m{"conversation_id":"c","status":"success","response":"x"}\n')
    && !isFinalEnvelope('{"conversation_id":"c","status":"succ')
    ? ok('[12] 봉투(conversation_id·status)만 답으로 본다 — 다른 JSON·잘린 JSON 은 종료를 기다린다') : bad('[12] 봉투 판정');
}
{
  // [11] agy 를 직접 띄우는 곳이 실행기 밖에 남아 있으면 같은 고장이 다시 난다(검사가 모든 경로에 걸려 있나).
  const root = new URL('../../', import.meta.url).pathname;
  let hits = '';
  try { hits = execFileSync('grep', ['-rlnE', "(spawn|spawnSync|execFile|execFileAsync)\\(\\s*(bin|b|agyBin\\(\\))\\s*,", 'scripts'], { cwd: root, encoding: 'utf8' }); } catch { /* 없음 */ }
  const direct = hits.split('\n').filter((f) => f && !/agy-run\.(mjs|test\.mjs)$|\.bak/.test(f));
  // 'models' 목록 조회는 대화를 만들지 않아 제목 짓기도 없다 — 그래도 SIGKILL 을 쓰는지 따로 본다.
  direct.length === 0 ? ok('[11] agy 실행은 lib/agy-run 한 곳에서만') : bad(`[11] 직접 실행: ${direct.join(', ')}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
