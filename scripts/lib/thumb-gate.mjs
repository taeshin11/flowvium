/**
 * thumb-gate.mjs — 올리기 전 썸네일 3자 채점 관문. (2026-10-28 사장님, Mac mini2 경유) 머리말 규칙은 thumb-gate.test.mjs.
 *
 * 심판 셋이 따로 10점 만점: ChatGPT · agy(gemini-4-argon-medium, 그림 첨부) · Claude(claude -p, 그림을 Read).
 *   통과 = 정해진 심판(need)이 모두 매겼고, 매긴 점수가 모두 8 이상. 못 매긴 심판은 통과가 아니다(울릴 수 없는 경보 금지).
 *   7 이하가 있으면 가장 낮은 심판이 낸 글로 부르는 쪽이 다시 굽고(rerender) 다시 매긴다 — 최대 3번, 전체 10분.
 *   그래도 안 되면 가장 나은 판(최저점 → 합)을 쓰고 flagged 에 이유를 남긴다(22:00 보고).
 * 고칠 수 있는 건 **썸네일 글뿐**이다. 사진은 그 뉴스의 실제 사진이라 바꾸지 않는다(바꾸면 낚시 — make-shorts 머리말).
 *   심판이 낸 글은 safeText 로 거른다: 원문에 없는 숫자(지어낸 수치)·매수/매도 권유·길이 밖은 버린다.
 * ChatGPT: 이 기계에선 9334 크롬을 못 쓰고 API 키도 없다 — Mac mini2 가 채점 대기열을 만들 때까지 'ChatGPT 미채점'.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { CALL } from './comment-reply.mjs';

export const PASS = 8;
export const NEED = ['agy', 'claude'];
const CHATGPT_SKIP = 'ChatGPT 미채점';

export function judgePrompt({ title, kind, file, textRule }) {
  return [
    `유튜브 ${kind === 'shorts' ? '쇼츠 첫 화면(표지)' : '영상 썸네일'} 그림 ${file} 을 직접 열어 보고, 클릭률(CTR) 기준으로 10점 만점 정수로 매겨라.`,
    `영상 제목: "${title}"`,
    '기준(모두 본다):',
    '1. 폰 피드 크기에서 1초 안에 읽힌다',
    '2. 호기심이나 얻을 것(이득)이 분명하다',
    '3. 글은 3~6낱말, 크고 대비가 강하다',
    '4. 주인공(사람·물건)이 크다',
    '5. 제목을 되풀이하지 않고 제목을 보완한다',
    '6. 채널의 다른 썸네일 사이에서 눈에 띈다',
    `고칠 수 있는 것은 썸네일 글뿐이다(사진은 그 뉴스의 실제 사진이라 못 바꾼다). 글 규칙: ${textRule}.`,
    '사실은 제목·그림에 있는 것만 써라 — 없는 숫자·과장·매수/매도 권유 금지.',
    'image_ok: 그림(사진)이 주제와 바로 이어지고 주인공이 크면 true, 주제와 동떨어져 보이면 false.',
    '답은 JSON 하나: {"score":정수0~10,"weak":"가장 약한 점 한 줄","text":"더 나은 썸네일 글(점수가 8 이상이면 빈 글)","image_ok":true|false}',
  ].join('\n');
}

export function parseJudge(o) {
  if (!o || typeof o !== 'object') return null;
  const s = Number(o.score);
  if (!Number.isInteger(s) || s < 0 || s > 10) return null;
  const r = { score: s, weak: String(o.weak ?? '').trim(), text: String(o.text ?? '').trim() };
  if (typeof o.image_ok === 'boolean') r.imageOk = o.image_ok;   // 그림이 주제와 맞는가 — 상시 쇼츠는 false 면 표지를 다시 그린다
  return r;
}

/** 심판이 낸 글을 쓸 수 있는가. 쓸 수 있으면 정리한 글, 아니면 null. */
export function safeText(t, { source = '', maxChars = 24, maxWords = 6, digits = true } = {}) {
  const s = String(t ?? '').replace(/^[\s"'“”‘’「」]+|[\s"'“”‘’「」]+$/g, '').replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > maxChars) return null;
  if (s.split(' ').length > maxWords) return null;
  if (CALL.test(s)) return null;
  const nums = s.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (nums.length && (!digits || nums.some((n) => !String(source).includes(n)))) return null;
  return s;
}

const scored = (r) => r && Number.isInteger(r.score);

export function decide(scores, need = NEED) {
  const missing = need.filter((k) => !scored(scores[k]));
  const low = Object.entries(scores).filter(([, r]) => scored(r) && r.score < PASS).map(([k]) => k);
  return { pass: !missing.length && !low.length, missing, low };
}

/** 판 고르기 — 못 매긴 심판(error)이 있는 판은 아래, 그다음 최저점, 같으면 합. 미채점(skipped)은 세지 않는다. */
export function rankKey(scores) {
  const v = Object.values(scores);
  const nums = v.filter(scored).map((r) => r.score);
  const sum = nums.reduce((a, b) => a + b, 0);
  if (!nums.length || v.some((r) => r?.error)) return -1000 + sum;
  return Math.min(...nums) * 100 + sum;
}

async function scoreAll(judges, a) {
  const out = {};
  await Promise.all(Object.entries(judges).map(async ([k, fn]) => {
    try {
      const r = await fn(a);
      out[k] = r?.skipped ? { skipped: r.skipped } : (parseJudge(r) ?? { error: `답 모양이 틀림: ${JSON.stringify(r).slice(0, 80)}` });
    } catch (e) { out[k] = { error: String(e?.message ?? e).slice(0, 160) }; }
  }));
  return out;
}

/**
 * @param {{image:string, text:string, title:string, source?:string, kind:'shorts'|'long', maxChars?:number, maxWords?:number, digits?:boolean,
 *   textRule?:string, judges?:object, need?:string[], rerender:(text:string)=>Promise<string|null>, log?:Function,
 *   now?:()=>number, deadlineMs?:number, maxFixes?:number, accept?:(t:string)=>boolean}} o  accept: 부르는 쪽 글 규칙(롱폼 두 줄 등)
 */
export async function runThumbGate(o) {
  const { title, kind, source = o.text, maxChars = 24, maxWords = 6, digits = true, rerender, log = () => {}, now = Date.now,
    deadlineMs = 600_000, maxFixes = 3, need = NEED, accept = () => true } = o;
  const judges = o.judges ?? defaultJudges();
  const textRule = o.textRule ?? `${maxWords}낱말·${maxChars}자 안`;
  const t0 = now();
  const rounds = [];
  const tried = new Set([o.text]);
  let image = o.image, text = o.text, flagged = null;
  for (;;) {
    const r0 = now();
    const left = deadlineMs - (r0 - t0);
    const scores = await scoreAll(judges, { image, title, kind, text, timeoutMs: Math.max(30_000, Math.min(240_000, left)),
      prompt: (file) => judgePrompt({ title, kind, file, textRule }) });
    rounds.push({ image, text, scores, ms: now() - r0 });
    log(`[썸네일 관문] ${rounds.length}판 "${text}" — ${fmtScores(scores)}`);
    const d = decide(scores, need);
    if (d.pass) break;
    if (rounds.length > maxFixes) { flagged = `${maxFixes}번 고쳐도 8점 미만`; break; }
    const roundMs = rounds.at(-1).ms;
    if (deadlineMs - (now() - t0) < roundMs) { flagged = `시간 상한 ${Math.round(deadlineMs / 60000)}분`; break; }
    const fix = Object.values(scores).filter((r) => scored(r) && r.score < PASS).sort((a, b) => a.score - b.score)
      .map((r) => safeText(r.text, { source, maxChars, maxWords, digits })).find((t) => t && !tried.has(t) && accept(t));
    if (!fix) { flagged = d.missing.length && !d.low.length ? `${d.missing.join('·')} 못 매김` : '쓸 수 있는 고칠 글이 없다'; break; }
    tried.add(fix);
    const next = await rerender(fix).catch((e) => { log(`[썸네일 관문] 다시 굽기 실패: ${e?.message ?? e}`); return null; });
    if (!next) { flagged = '다시 굽기 실패'; break; }
    image = next; text = fix;
  }
  const best = rounds.reduce((b, r, i) => (rankKey(r.scores) > rankKey(rounds[b].scores) ? i : b), 0);
  const passed = decide(rounds[best].scores, need).pass;
  if (passed) flagged = null;
  else if (!flagged) flagged = '8점 미만';
  return { passed, flagged, image: rounds[best].image, text: rounds[best].text, best, rounds };
}

export function fmtScores(scores) {
  return Object.entries(scores).map(([k, r]) => `${k} ${scored(r) ? r.score : r?.skipped ? '미채점' : `✗(${String(r?.error).slice(0, 40)})`}`).join(' · ');
}

/** 업로드 기록에 붙일 요약 — 고른 판의 점수 셋. */
export function gateSummary(g) {
  if (!g) return null;
  const s = g.rounds[g.best].scores;
  const pick = (k) => (scored(s[k]) ? s[k].score : s[k]?.skipped ? '미채점' : s[k] ? '못 매김' : '없음');
  return { passed: g.passed, flagged: g.flagged, chatgpt: pick('chatgpt'), agy: pick('agy'), claude: pick('claude'),
    text: g.text, rounds: g.rounds.length, imageBad: Object.values(s).filter((r) => r?.imageOk === false).length, weak: Object.values(s).filter((r) => scored(r) && r.score < PASS).map((r) => r.weak).filter(Boolean) };
}

export function appendGateLog(entry, file) {
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); } catch { /* 기록 실패로 발행을 막지 않는다 */ }
}

// ── 실제 심판 ────────────────────────────────────────────────────────────────

export function firstJson(s) {
  const t = String(s ?? '').trim();
  // 봉투 전체가 JSON 이면 그대로 — 안쪽 답(result)에 든 ```json 울타리를 먼저 잡으면 봉투를 놓친다(10/28 실측).
  try { const j = JSON.parse(t); if (j && typeof j === 'object') return j; } catch { /* 아래로 */ }
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = m ? m[1] : t;
  const a = body.indexOf('{'); const b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

function run(bin, args, { cwd, timeoutMs }) {
  return new Promise((res) => {
    const c = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { c.kill('SIGTERM'); setTimeout(() => c.kill('SIGKILL'), 5000).unref(); }, timeoutMs);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('error', (e) => { clearTimeout(timer); res({ code: -1, out, err: String(e.message) }); });
    c.on('close', (code, sig) => { clearTimeout(timer); res({ code: sig ? `signal ${sig}` : code, out, err }); });
  });
}

function stage(image) {
  const dir = mkdtempSync(join(tmpdir(), 'thumb-gate-'));
  const file = `thumb${extname(image) || '.jpg'}`;
  copyFileSync(image, join(dir, file));
  return { dir, file };
}

/** Claude — claude -p 가 그림을 Read 로 연다. 도구를 안 쓰고(턴 1) 낸 점수는 그림을 안 본 것이라 버린다. */
export async function claudeJudge({ image, prompt, timeoutMs = 180_000 }) {
  const bin = process.env.CLAUDE_BIN || [join(homedir(), '.local/bin/claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'].find((p) => existsSync(p));
  if (!bin) throw new Error('claude 실행파일 없음');
  const { dir, file } = stage(image);
  try {
    const r = await run(bin, ['-p', prompt(file), '--allowedTools', 'Read', '--max-turns', '4', '--output-format', 'json'], { cwd: dir, timeoutMs });
    if (r.code !== 0) throw new Error(`종료 ${r.code}: ${r.err.slice(0, 120)}`);
    const j = firstJson(r.out);
    if (!j) throw new Error('출력을 못 읽음');
    if (!(j.num_turns >= 2)) throw new Error('그림을 안 열고 답함');
    const v = firstJson(j.result);
    if (!v) throw new Error(`판정 없음: ${String(j.result).slice(0, 80)}`);
    return v;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** agy — gemini-4-argon-medium(사장님 지정). 그림을 read_file 로 실제로 열었는지 대화 기록으로 확인한다(lib/agy-viewed). */
export async function agyJudge({ image, prompt, timeoutMs = 240_000 }) {
  const { agyBin, agyReady } = await import('./agy.mjs');
  const { runAgy, NO_SHELL_P } = await import('./agy-run.mjs');
  const { viewedImages } = await import('./agy-viewed.mjs');
  const { PREFERRED_VISION } = await import('./agy-models.mjs');
  const bin = agyBin();
  if (!bin || !agyReady()) throw new Error('agy 준비 안 됨');
  const { dir, file } = stage(image);
  try {
    writeFileSync(join(dir, 'schema.json'), JSON.stringify({ type: 'object',
      properties: { score: { type: 'integer' }, weak: { type: 'string' }, text: { type: 'string' }, image_ok: { type: 'boolean' } }, required: ['score', 'weak', 'text', 'image_ok'] }));
    const model = process.env.THUMB_GATE_AGY_MODEL || PREFERRED_VISION[0];
    let r;
    try {
      r = await runAgy(bin, ['-p', `${NO_SHELL_P}${prompt(file)}\n그림은 read_file 로 연다.`, '--model', model, '--sandbox', '--add-dir', dir,
        '--json-schema', join(dir, 'schema.json'), '--output-format', 'json'], { cwd: dir, timeoutMs });
    } catch (e) { throw new Error(e?.name === 'AbortError' ? `시간초과 ${Math.round(timeoutMs / 1000)}초` : String(e?.message ?? e).slice(0, 120)); }
    const j = firstJson(String(r.stdout).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ''));
    const v = j?.structured_output ?? firstJson(j?.response);
    if (!v) throw new Error('판정 없음');
    const seen = viewedImages(j.conversation_id, [file]);
    if (!seen || seen.missing.length) throw new Error(seen ? '그림을 안 열고 답함' : '그림을 열었는지 확인 불가');
    return v;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** ChatGPT — 길이 생길 때까지(Mac mini2 채점 대기열) 미채점. 통과 판정에서 빼되 기록엔 남긴다. */
export async function chatgptJudge() { return { skipped: CHATGPT_SKIP }; }

export function defaultJudges() { return { chatgpt: chatgptJudge, agy: agyJudge, claude: claudeJudge }; }
