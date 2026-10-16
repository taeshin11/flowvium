/**
 * agy-run.mjs — agy 프로세스를 띄우는 **유일한** 곳. 2026-10-16 신설.
 *
 * 왜(근거·실측은 agy-run.test.mjs 머리말): agy 1.3.6 은 답(완전한 JSON)을 stdout 에 다 쓰고도
 *   종료 단계에서 대화 제목 짓기(maybeGenerateConversationTitle)를 끝없이 기다리며 **안 끝날 때가 있다.**
 *   SIGTERM 도 같은 종료 경로로 들어가 무시된다. 그래서
 *   - execFile 은 'close' 를 못 받아 시간 초과까지 기다렸다(보고서 portfolio 2시간 · 빈 결과),
 *   - abort/timeout 의 SIGTERM 이 안 먹어 고아 agy 가 5~8시간 남았고,
 *   - spawnSync 는 timeout 이 나도 자식이 끝날 때까지 기다린다(끝없이).
 * 그래서 여기서:
 *   1. `--output-format json` 이면 stdout 이 **완전한 JSON** 이 되는 순간 결과로 돌려준다(끝을 안 기다린다).
 *   2. 돌려준 뒤든 시간 초과든, 자식은 SIGTERM → graceMs 뒤 SIGKILL 로 반드시 거둔다.
 *   3. 동기 호출(runAgySync)은 이 파일을 자식 node 로 띄워 같은 규칙을 쓴다 — spawnSync 로 agy 를 직접 띄우지 않는다.
 * 정상 종료하는 agy 는 예전과 똑같이 받는다(종료가 JSON 완성보다 먼저 오면 그대로 끝).
 */
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g;

/**
 * stdout 이 agy 의 **최종 결과 봉투**로 끝났나. 끝이 } 일 때만 parse 한다(긴 출력에서 매 조각 parse 를 피한다).
 * 아무 JSON 이 아니라 봉투(conversation_id·status — 10/16 실측 키: conversation_id,status,response,duration_seconds,
 * num_turns,usage)일 때만 — 앞에 다른 JSON 조각이 찍혀도 그걸 답으로 오인하지 않는다. 못 알아보면 예전처럼 종료를 기다린다.
 */
export function isFinalEnvelope(text) {
  const t = text.replace(ANSI, '').trim();
  if (!t.endsWith('}')) return false;
  const a = t.indexOf('{');
  if (a < 0) return false;
  try { const j = JSON.parse(t.slice(a)); return !!j && typeof j === 'object' && 'conversation_id' in j && 'status' in j; } catch { return false; }
}

function reap(child, graceMs) {
  if (child.exitCode != null || child.signalCode != null) return;
  try { child.kill('SIGTERM'); } catch { /* 이미 끝 */ }
  const t = setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) { try { child.kill('SIGKILL'); } catch { /* 이미 끝 */ } }
  }, graceMs);
  t.unref?.();
  child.once('exit', () => clearTimeout(t));
}

/**
 * agy 를 띄우고 결과를 받는다. execFile 과 같은 모양: 성공 → {stdout, stderr}, 실패 → Error(code, stderr, stdout).
 * 시간 초과·signal 중단은 name 이 'AbortError' 인 오류.
 * @param {string} bin @param {string[]} args
 * @param {{cwd?:string, env?:object, timeoutMs?:number, signal?:AbortSignal, graceMs?:number, maxBuffer?:number}} o
 */
export function runAgy(bin, args, o = {}) {
  const { cwd, env, timeoutMs = 0, signal, graceMs = 5000, maxBuffer = 32 * 1024 * 1024 } = o;
  const wantJson = args.some((a, i) => a === '--output-format' && args[i + 1] === 'json');
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false, timer = null;
    // 자식이 실제로 끝난(거둬진) 시점 — 동기판 자식 node 가 이걸 기다린 뒤 끝나야 agy 가 고아가 안 된다.
    const exited = new Promise((r) => { child.once('exit', r); child.once('error', r); });
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      if (v && typeof v === 'object') Object.defineProperty(v, 'exited', { value: exited, enumerable: false });
      fn(v);
      reap(child, graceMs);
    };
    const abortErr = (why) => Object.assign(new Error(why), { name: 'AbortError', stdout, stderr });
    const onAbort = () => finish(reject, abortErr('aborted'));
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (timeoutMs > 0) timer = setTimeout(() => finish(reject, abortErr(`timeout ${timeoutMs}ms`)), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.length > maxBuffer) return finish(reject, Object.assign(new Error('stdout maxBuffer exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', stdout, stderr }));
      if (wantJson && isFinalEnvelope(stdout)) finish(resolve, { stdout, stderr, early: child.exitCode == null });
    });
    child.stderr.on('data', (d) => { if (stderr.length < maxBuffer) stderr += d; });
    child.on('error', (e) => finish(reject, Object.assign(e, { stdout, stderr })));
    child.on('close', (code, sig) => {
      if (code === 0) return finish(resolve, { stdout, stderr, early: false });
      finish(reject, Object.assign(new Error(`agy exited ${code ?? sig}: ${stderr.slice(0, 200)}`), { code, signal: sig, stdout, stderr }));
    });
  });
}

const SELF = fileURLToPath(import.meta.url);

/**
 * 동기판 — spawnSync 와 같은 모양({status, stdout, stderr, error}). 시간 초과는 error.code 'ETIMEDOUT'.
 * 자식 node 가 runAgy 로 agy 를 띄우고 거둔다. 바깥 spawnSync 는 SIGKILL 로 막혀도 끝나게 둔다.
 */
export function runAgySync(bin, args, o = {}) {
  const { cwd, env, timeoutMs = 0, graceMs = 5000, maxBuffer = 32 * 1024 * 1024 } = o;
  const spec = JSON.stringify({ bin, args, timeoutMs, graceMs, maxBuffer });
  const outer = timeoutMs > 0 ? timeoutMs + graceMs + 10_000 : undefined;
  const r = spawnSync(process.execPath, [SELF, '--run-agy'], {
    cwd, env, input: spec, encoding: 'utf8', maxBuffer: maxBuffer * 2 + 1024 * 1024, timeout: outer, killSignal: 'SIGKILL',
  });
  if (r.error) return { status: null, stdout: '', stderr: String(r.stderr ?? ''), error: r.error };
  let res = null;
  try { res = JSON.parse(r.stdout); } catch { /* 아래 */ }
  if (!res) return { status: r.status, stdout: '', stderr: String(r.stderr ?? ''), error: new Error(`agy-run 자식 출력 없음(status ${r.status})`) };
  if (res.timedOut) return { status: null, stdout: res.stdout, stderr: res.stderr, error: Object.assign(new Error(`agy timeout ${timeoutMs}ms`), { code: 'ETIMEDOUT' }) };
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, error: res.spawnError ? new Error(res.spawnError) : undefined };
}

// 자식 모드: stdin 의 spec 으로 runAgy 를 돌리고 결과를 JSON 한 줄로 낸다.
if (process.argv[1] === SELF && process.argv[2] === '--run-agy') {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', async () => {
    const { bin, args, timeoutMs, graceMs, maxBuffer } = JSON.parse(input);
    let out, exited = null;
    try {
      const r = await runAgy(bin, args, { timeoutMs, graceMs, maxBuffer });
      exited = r.exited;
      out = { status: 0, stdout: r.stdout, stderr: r.stderr };
    } catch (e) {
      exited = e?.exited ?? null;
      out = e?.name === 'AbortError' ? { timedOut: true, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
        : typeof e?.code === 'number' ? { status: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
          : { status: null, stdout: e?.stdout ?? '', stderr: e?.stderr ?? '', spawnError: String(e?.message ?? e) };
    }
    // 거두기(SIGKILL)까지 기다린 뒤 끝난다 — 먼저 끝나면 agy 가 고아가 된다. 상한은 grace+2초.
    await Promise.race([exited ?? Promise.resolve(), new Promise((r) => setTimeout(r, (graceMs ?? 5000) + 2000))]);
    process.stdout.write(JSON.stringify(out), () => process.exit(0));
  });
}
