/**
 * agy.mjs — Antigravity CLI 를 **한 번 묻고 끝내는 텍스트 호출**로 쓴다. (2026-09-19 신설)
 *
 * 왜 로컬 4B 대신 쓰나 (사용자 "4B쓰던것들 다 넘기고"):
 *   · 품질 — 로컬 4B 는 번역투와 **한자 섞임**을 냈다(2026-09-18 "한국两地" 가 블로그에 발행됐다).
 *     같은 문장을 gemini-3.1-pro 로 돌리니 19초에 자연스러운 존댓말이 나왔다.
 *   · 자원 — :8001 이 하루에 세 번 죽었고 스왑이 95% 까지 찼다. 배치 작업을 밖으로 빼면
 *     그 레인은 **사이트 번역·챗**만 맡는다(그건 사용자가 기다리는 요청이라 못 옮긴다).
 *
 * ⚠ 이 경로는 언제든 막힐 수 있다. 오늘 구글이 Gemini CLI 를 IneligibleTierError 로 닫는 걸 봤다.
 *   그래서 **호출부는 반드시 로컬 폴백을 남긴다.** 여기서는 실패를 null 로 돌려줄 뿐이다.
 *
 * 권한: agy 는 코딩 에이전트다. --sandbox 로 터미널을 제한하고, 재료만 든 임시 폴더를
 *   작업 디렉터리로 준다 — 건드릴 것이 그 파일들뿐이다.
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export function agyBin() {
  const cands = [process.env.AGY_BIN, join(process.env.HOME ?? '', '.local/bin/agy'), '/usr/local/bin/agy'];
  for (const c of cands) if (c && existsSync(c)) return c;
  const w = spawnSync('which', ['agy'], { encoding: 'utf8' });
  return w.status === 0 ? (w.stdout ?? '').trim() : null;
}

let _ok = null;
/** 로그인까지 되어 있는가. 한 프로세스 안에서 한 번만 본다(매번 재면 60초씩 든다). */
export function agyReady() {
  if (_ok !== null) return _ok;
  const bin = agyBin();
  if (!bin) { _ok = false; return _ok; }
  const r = spawnSync(bin, ['models'], { encoding: 'utf8', timeout: 60000 });
  _ok = r.status === 0 && !/sign in/i.test(`${r.stdout ?? ''}${r.stderr ?? ''}`);
  return _ok;
}

/**
 * 프롬프트 하나를 던지고 **문자열 하나**를 받는다. 실패하면 null — 호출부가 폴백한다.
 * @param {string} prompt
 * @param {{model?:string, timeoutMs?:number, files?:Record<string,string>}} opt
 *   files: 임시 폴더에 써 줄 재료(이름 → 내용). 긴 원문은 프롬프트에 넣지 말고 파일로 준다.
 * @returns {string|null}
 */
let _why = null;
/** 마지막 agyText 가 왜 못 돌려줬는지. 폴백한 사유를 로그에 남기려고 둔다. */
export function agyLastWhy() { return _why; }

export function agyText(prompt, opt = {}) {
  _why = null;
  const bin = agyBin();
  if (!bin) { _why = 'agy 실행파일 없음'; return null; }
  if (!agyReady()) { _why = 'agy 로그인 안 됨'; return null; }
  const dir = mkdtempSync(join(tmpdir(), 'agy-t-'));
  try {
    for (const [name, body] of Object.entries(opt.files ?? {})) writeFileSync(join(dir, name), String(body));
    writeFileSync(join(dir, 'schema.json'), JSON.stringify({
      type: 'object', properties: { text: { type: 'string' } }, required: ['text'],
    }));
    const r = spawnSync(bin, ['-p', prompt,
      '--model', opt.model || process.env.AGY_TEXT_MODEL || 'gemini-3.1-pro-high',
      '--sandbox', '--add-dir', dir,
      '--json-schema', join(dir, 'schema.json'), '--output-format', 'json'],
    { cwd: dir, encoding: 'utf8', timeout: opt.timeoutMs ?? 180000, maxBuffer: 8 * 1024 * 1024 });
    if (r.error?.code === 'ETIMEDOUT') { _why = `시간초과 ${Math.round((opt.timeoutMs ?? 180000) / 1000)}초`; return null; }
    if (r.status !== 0 || !r.stdout) {
      _why = `종료코드 ${r.status} ${String(r.stderr ?? '').replace(/\s+/g, ' ').slice(0, 120)}`.trim();
      return null;
    }
    const j = JSON.parse(r.stdout.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim());
    const t = j?.structured_output?.text;
    if (typeof t === 'string' && t.trim()) return t.trim();
    _why = 'structured_output.text 비어 있음';
    return null;
  } catch (e) { _why = `예외 ${e?.message ?? e}`; return null; } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 비치명 */ } }
}

/**
 * 로컬 호출기를 **감싸서** agy 를 앞에 둔다. agy 가 안 되는 날엔 그대로 로컬로 간다.
 *
 * 왜 llmCaller 를 고치지 않고 합성하나: llmCaller 는 fetchImpl 을 받는 순수 함수라
 *   테스트가 그 경로를 그대로 검사한다. 거기에 "agy 가 준비됐으면 다른 데로 간다" 를
 *   넣으면 기계마다 다른 것을 시험하게 된다. 선택은 **호출부에서 눈에 보이게** 한다.
 *
 * @param {(p:string)=>Promise<string>} fallback 로컬 호출기(보통 llmCaller('web'))
 * @param {{model?:string, timeoutMs?:number, agyImpl?:Function, warn?:Function}} opt
 */
export function agyCaller(fallback, opt = {}) {
  const impl = opt.agyImpl ?? agyText;
  const warn = opt.warn ?? ((m) => console.error(m));
  return async (prompt) => {
    let out = null, why = null;
    try { out = impl(prompt, { model: opt.model, timeoutMs: opt.timeoutMs }); } catch (e) { why = `예외 ${e?.message ?? e}`; }
    if (typeof out === 'string' && out.trim()) return out.trim();
    warn(`  ↩ agy 실패 → 로컬 LLM 으로 (${why ?? (opt.agyImpl ? '응답 없음' : agyLastWhy()) ?? '응답 없음'})`);
    return fallback(prompt);
  };
}
