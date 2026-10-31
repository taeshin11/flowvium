/**
 * thumb-gate.mjs — 올리기 전 썸네일 3자 채점 관문. (2026-10-28 사장님, Mac mini2 경유) 머리말 규칙은 thumb-gate.test.mjs.
 *
 * 심판 셋이 따로 10점 만점: ChatGPT · agy(gemini-4-argon-medium, 그림 첨부) · Claude(claude -p, 그림을 Read).
 *   통과 = 정해진 심판(need)이 모두 매겼고, 셋 다 FLOOR 이상 + 하나라도 PASS_ONE 이상(10/28 18:3x 사장님: 7.5·8). 못 매긴 심판은 통과가 아니다(울릴 수 없는 경보 금지).
 *   7 이하가 있으면 가장 낮은 심판이 낸 글로 부르는 쪽이 다시 굽고(rerender) 다시 매긴다 — 최대 3번, 전체 10분.
 *   그래도 안 되면 가장 나은 판(최저점 → 합)을 쓰고 flagged 에 이유를 남긴다(22:00 보고).
 * 고칠 수 있는 건 **썸네일 글뿐**이다. 사진은 그 뉴스의 실제 사진이라 바꾸지 않는다(바꾸면 낚시 — make-shorts 머리말).
 *   심판이 낸 글은 safeText 로 거른다: 원문에 없는 숫자(지어낸 수치)·매수/매도 권유·길이 밖은 버린다.
 * ChatGPT: 이 기계는 9334 크롬을 안 건드린다 — Mac mini3 의 공용 채점 대기열(~/history/_thumbq)에 넣고 답을 받는다(chatgptJudge).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync, existsSync, appendFileSync, mkdirSync, renameSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { CALL } from './comment-reply.mjs';

// 10/28 18:3x 사장님이 다시 바꿈(desktop1 창, Mac mini2 경유): 셋 다 7.5 이상 + 하나라도 8 이상. (그 전: 셋 다 7 + 하나 7.5 → 8·8·7.5 → 셋 다 8)
export const FLOOR = 7.5;
export const PASS_ONE = 8;
export const PASS = PASS_ONE; // 고칠 글을 낼 만큼 낮은 점수의 선(심판에게 '이 아래면 고칠 글')
export const NEED = ['chatgpt', 'agy', 'claude'];

// 10/29 16:0x 사장님(desktop1 → Mac mini2 경유): 잘 되는 채널(지난 7일 조회 > 그 전 7일)은 셋 다 7.0 + 하나 7.5.
//   나머지는 위 7.5·8 그대로. 날마다 다시 잰다 — scripts/thumb-bar.mjs 가 logs/thumb-bar.json 에 두 숫자를 적는다.
//   하루 반 넘게 안 잰 값·모르는 값은 믿지 않고 엄한 쪽(미채점이 통과가 아닌 것과 같은 이유).
export const RELAXED = { floor: 7, passOne: 7.5 };
export const BAR_FILE = join(dirname(new URL(import.meta.url).pathname), '../../logs/thumb-bar.json');
export function barFrom(rec, now = Date.now()) {
  const fresh = rec && Number.isFinite(Date.parse(rec.at)) && now - Date.parse(rec.at) <= 36 * 3600e3;
  const good = fresh && Number.isFinite(rec.last7) && Number.isFinite(rec.prev7) && rec.last7 > rec.prev7;
  const nums = { last7: fresh ? rec.last7 ?? null : null, prev7: fresh ? rec.prev7 ?? null : null, measuredAt: fresh ? rec.at : null };
  return good ? { ...RELAXED, name: '잘 되는 채널', ...nums } : { floor: FLOOR, passOne: PASS_ONE, name: '기본', ...nums };
}
export function currentBar(now = Date.now(), file = process.env.THUMB_BAR_FILE || BAR_FILE) {
  try { return barFrom(JSON.parse(readFileSync(file, 'utf8')), now); } catch { return barFrom(null, now); }
}

// 10/29 사장님: 심판마다 3번 따로(매번 새 대화·새 호출) 매겨 가운데 값. 한 번 점수는 ±2 흔들린다.
//   둘만 매겼으면 낮은 쪽(통과를 부풀리지 않는다), 하나 이하면 못 매김. 지적·고칠 글은 고른 답의 것.
export function medianOf(results) {
  const ok = results.filter(scored);
  if (ok.length < 2) {
    const sk = results.find((r) => r?.skipped);
    return sk && !ok.length ? { skipped: sk.skipped } : { error: `가운데 값을 낼 만큼 못 매김(${ok.length}/${results.length}) ${results.map((r) => r?.error).filter(Boolean)[0] ?? ''}`.trim() };
  }
  const sorted = [...ok].sort((a, b) => a.score - b.score);
  const pick = ok.length >= 3 ? sorted[Math.floor((sorted.length - 1) / 2)] : sorted[0];
  return { ...pick, samples: results.map((r) => (scored(r) ? r.score : null)) };
}   // 사장님: 셋 다 8 이상. 못 매긴 심판(야간 미채점 포함)이 있으면 통과가 아니다

export function judgePrompt({ title, kind, file, textRule, anchors = null }) {
  // 기준 그림(10/28 Mac mini3·Mac mini2): 심판마다 눈금이 달라 실제 성적이 있는 두 장을 먼저 보여 준다.
  const anchorLines = anchors ? [
    `그림 세 장을 모두 열어라: ${anchors.high} = 이 채널에서 실제로 잘 된 표지 → 8.5 기준, ${anchors.low} = 실제로 안 된 표지 → 5 기준.`,
    `${file} 만 매겨라. 눈금은 두 기준 그림에 맞춘다.`,
  ] : [];
  return [
    ...anchorLines,
    `유튜브 ${kind === 'shorts-open' ? '쇼츠 피드에 보이는 영상 첫 화면' : kind === 'shorts' ? '쇼츠 맞춤 썸네일' : '영상 썸네일'} 그림 ${file} 을 직접 열어 보고, 클릭률(CTR) 기준으로 10점 만점(0.5 점 단위)으로 매겨라.`,
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
    '답은 JSON 하나: {"score":0~10(0.5 단위),"weak":"가장 약한 점 한 줄","text":"더 나은 썸네일 글(점수가 8 이상이면 빈 글)","image_ok":true|false}',
  ].join('\n');
}

export function parseJudge(o) {
  if (!o || typeof o !== 'object') return null;
  const n = Number(o.score);
  if (o.score == null || o.score === '' || !Number.isFinite(n) || n < 0 || n > 10) return null;
  const s = Math.round(n * 10) / 10;   // 소수 한 자리(ChatGPT 대기열 7.5 등 — 7.5 기준이 있어서 정수로 자르지 않는다)
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

const scored = (r) => r && Number.isFinite(r.score);

/**
 * 통과 = 정해진 심판(need)이 모두 매겼고, 매긴 점수가 모두 FLOOR 이상이며 하나라도 PASS_ONE 이상(지금 7.5·8 — 위 상수).
 * low = 기준을 깨는 심판(FLOOR 미만, 또는 PASS_ONE 이상이 하나도 없으면 전부) — 고칠 글은 이들의 것에서 고른다.
 * settled = 통과는 아니지만 더 고쳐도 소용없는 경우 — ChatGPT 만 못 매겼고 나머지는 기준을 넘었다.
 *   그 편은 통과가 아니다(사장님: 미채점·오류는 통과로 세지 않는다). 다시 굽지 않고 멈춘다.
 */
export function decide(scores, need = NEED, bar = { floor: FLOOR, passOne: PASS_ONE }) {
  const missing = need.filter((k) => !scored(scores[k]));
  const vals = Object.entries(scores).filter(([, r]) => scored(r));
  const under = vals.filter(([, r]) => r.score < bar.floor);
  const top = vals.some(([, r]) => r.score >= bar.passOne);
  const low = under.length ? under.map(([k]) => k) : top ? [] : vals.map(([k]) => k);
  const pass = !missing.length && !low.length;
  const settled = !pass && missing.length === 1 && missing[0] === 'chatgpt' && !low.length && vals.length > 0;
  return { pass, settled, missing, low };
}

/** 판 고르기 — 못 매긴 심판(error)이 있는 판은 아래, 그다음 최저점, 같으면 합. 미채점(skipped)은 세지 않는다. */
export function rankKey(scores) {
  const v = Object.values(scores);
  const nums = v.filter(scored).map((r) => r.score);
  const sum = nums.reduce((a, b) => a + b, 0);
  if (!nums.length || v.some((r) => r?.error)) return -1000 + sum;
  return Math.min(...nums) * 100 + sum;
}

async function scoreAll(judges, a, lazy = [], repeat = 1, floor = FLOOR) {
  const out = {};
  const once = async (fn) => {
    try {
      const r = await fn(a);
      return r?.skipped ? { skipped: r.skipped } : (parseJudge(r) ?? { error: `답 모양이 틀림: ${JSON.stringify(r).slice(0, 80)}` });
    } catch (e) { return { error: String(e?.message ?? e).slice(0, 160) }; }
  };
  // 한 심판의 세 번은 차례로 — 매번 새 호출(새 대화)이고, 미채점(야간 등)이면 더 묻지 않는다.
  const ask = async ([k, fn]) => {
    if (repeat <= 1) { out[k] = await once(fn); return; }
    const rs = [];
    for (let i = 0; i < repeat; i++) { const r = await once(fn); rs.push(r); if (r?.skipped) break; }
    out[k] = medianOf(rs);
  };
  const all = Object.entries(judges);
  await Promise.all(all.filter(([k]) => !lazy.includes(k)).map(ask));
  // 아껴 쓰는 심판(ChatGPT — 대기열의 파일 첨부 한도, 10/28 Mac mini3): 나머지가 모두 매겼고 모두 7 이상일 때만 묻는다.
  //   하나라도 FLOOR 미만·못 매김이면 그 판은 어차피 떨어지니 묻지 않는다(PASS_ONE 은 ChatGPT 가 채울 수 있어 FLOOR 로 본다).
  const rest = all.filter(([k]) => !lazy.includes(k)).map(([k]) => out[k]);
  const worth = rest.every((r) => scored(r) && r.score >= floor);
  for (const j of all.filter(([k]) => lazy.includes(k))) {
    if (worth) await ask(j); else out[j[0]] = { skipped: '안 물음(다른 심판이 이미 기준 미달)' };
  }
  return out;
}

/**
 * @param {{image:string, text:string, title:string, source?:string, kind:'shorts'|'long', maxChars?:number, maxWords?:number, digits?:boolean,
 *   textRule?:string, judges?:object, need?:string[], rerender:(text:string)=>Promise<string|null>, log?:Function,
 *   now?:()=>number, deadlineMs?:number, maxFixes?:number, accept?:(t:string)=>boolean}} o  accept: 부르는 쪽 글 규칙(롱폼 두 줄 등)
 */
export async function runThumbGate(o) {
  const { title, kind, source = o.text, maxChars = 24, maxWords = 6, digits = true, rerender, log = () => {}, now = Date.now,
    deadlineMs = 600_000, maxFixes = 3, need = NEED, accept = () => true, lazy = [],
    repeat = Number(process.env.THUMB_REPEAT ?? 3), bar = currentBar() } = o;
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
      anchors: o.anchors ?? null,
      prompt: (file, anchorFiles = null) => judgePrompt({ title, kind, file, textRule, anchors: anchorFiles }) }, lazy, repeat, bar.floor);
    rounds.push({ image, text, scores, ms: now() - r0 });
    log(`[썸네일 관문] ${rounds.length}판 "${text}" — ${fmtScores(scores)}${rounds.length === 1 ? ` · 기준 ${bar.name} ${bar.floor}·${bar.passOne}(7일 ${bar.last7 ?? '?'} / 그 전 ${bar.prev7 ?? '?'})` : ''}`);
    const d = decide(scores, need, bar);
    if (d.pass) break;
    if (d.settled) { flagged = `ChatGPT 미채점(${scores.chatgpt?.skipped ?? scores.chatgpt?.error ?? '없음'}) — 나머지는 기준을 넘었다`; break; }
    if (rounds.length > maxFixes) { flagged = maxFixes ? `${maxFixes}번 고쳐도 기준 미달` : '기준 미달'; break; }
    const roundMs = rounds.at(-1).ms;
    if (deadlineMs - (now() - t0) < roundMs) { flagged = `시간 상한 ${Math.round(deadlineMs / 60000)}분`; break; }
    const fix = Object.values(scores).filter((r) => scored(r) && r.score < bar.passOne).sort((a, b) => a.score - b.score)
      .map((r) => safeText(r.text, { source, maxChars, maxWords, digits })).find((t) => t && !tried.has(t) && accept(t));
    if (!fix) { flagged = d.missing.length && !d.low.length ? `${d.missing.join('·')} 못 매김` : '쓸 수 있는 고칠 글이 없다'; break; }
    tried.add(fix);
    const next = await rerender(fix).catch((e) => { log(`[썸네일 관문] 다시 굽기 실패: ${e?.message ?? e}`); return null; });
    if (!next) { flagged = '다시 굽기 실패'; break; }
    image = next; text = fix;
  }
  const best = rounds.reduce((b, r, i) => (rankKey(r.scores) > rankKey(rounds[b].scores) ? i : b), 0);
  const passed = decide(rounds[best].scores, need, bar).pass;
  if (passed) flagged = null;
  else if (!flagged) flagged = '기준 미달';
  return { passed, flagged, image: rounds[best].image, text: rounds[best].text, best, rounds, bar };
}

export function fmtScores(scores) {
  return Object.entries(scores).map(([k, r]) => `${k} ${scored(r) ? r.score : r?.skipped ? '미채점' : `✗(${String(r?.error).slice(0, 40)})`}`).join(' · ');
}

/** 업로드 기록에 붙일 요약 — 고른 판의 점수 셋. */
export function gateSummary(g) {
  if (!g) return null;
  const s = g.rounds[g.best].scores;
  const pick = (k) => (scored(s[k]) ? s[k].score : s[k]?.skipped ? '미채점' : s[k] ? '못 매김' : '없음');
  return { passed: g.passed, flagged: g.flagged, bar: g.bar ? { name: g.bar.name, floor: g.bar.floor, passOne: g.bar.passOne, last7: g.bar.last7, prev7: g.bar.prev7 } : null,
    chatgpt: pick('chatgpt'), ...(s.chatgpt?.error ? { chatgptWhy: String(s.chatgpt.error).slice(0, 120) } : {}), agy: pick('agy'), claude: pick('claude'),
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

/** claude CLI 실행(agy 아님 — agy 는 lib/agy-run 으로만, agy-run.test [11]). */
function runCli(exe, args, { cwd, timeoutMs }) {
  return new Promise((res) => {
    const c = spawn(exe, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { c.kill('SIGTERM'); setTimeout(() => c.kill('SIGKILL'), 5000).unref(); }, timeoutMs);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('error', (e) => { clearTimeout(timer); res({ code: -1, out, err: String(e.message) }); });
    c.on('close', (code, sig) => { clearTimeout(timer); res({ code: sig ? `signal ${sig}` : code, out, err }); });
  });
}

function stage(image, anchors = null) {
  const dir = mkdtempSync(join(tmpdir(), 'thumb-gate-'));
  const file = `thumb${extname(image) || '.jpg'}`;
  copyFileSync(image, join(dir, file));
  let anchorFiles = null;
  if (anchors?.high && anchors?.low && existsSync(anchors.high) && existsSync(anchors.low)) {
    anchorFiles = { high: 'anchor-high.jpg', low: 'anchor-low.jpg' };
    copyFileSync(anchors.high, join(dir, anchorFiles.high)); copyFileSync(anchors.low, join(dir, anchorFiles.low));
  }
  return { dir, file, anchorFiles };
}

/** Claude — claude -p 가 그림을 Read 로 연다. 도구를 안 쓰고(턴 1) 낸 점수는 그림을 안 본 것이라 버린다. */
export async function claudeJudge({ image, prompt, anchors = null, timeoutMs = 180_000 }) {
  const bin = process.env.CLAUDE_BIN || [join(homedir(), '.local/bin/claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'].find((p) => existsSync(p));
  if (!bin) throw new Error('claude 실행파일 없음');
  const { dir, file, anchorFiles } = stage(image, anchors);
  try {
    const r = await runCli(bin, ['-p', prompt(file, anchorFiles), '--allowedTools', 'Read', '--max-turns', '4', '--output-format', 'json'], { cwd: dir, timeoutMs });
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
export async function agyJudge({ image, prompt, anchors = null, timeoutMs = 240_000 }) {
  const { agyBin, agyReady } = await import('./agy.mjs');
  const { runAgy, NO_SHELL_P } = await import('./agy-run.mjs');
  const { viewedImages } = await import('./agy-viewed.mjs');
  const { PREFERRED_VISION } = await import('./agy-models.mjs');
  const bin = agyBin();
  if (!bin || !agyReady()) throw new Error('agy 준비 안 됨');
  const { dir, file, anchorFiles } = stage(image, anchors);
  try {
    writeFileSync(join(dir, 'schema.json'), JSON.stringify({ type: 'object',
      properties: { score: { type: 'number' }, weak: { type: 'string' }, text: { type: 'string' }, image_ok: { type: 'boolean' } }, required: ['score', 'weak', 'text', 'image_ok'] }));
    const model = process.env.THUMB_GATE_AGY_MODEL || PREFERRED_VISION[0];
    let r;
    try {
      r = await runAgy(bin, ['-p', `${NO_SHELL_P}${prompt(file, anchorFiles)}\n그림은 read_file 로 연다.`, '--model', model, '--sandbox', '--add-dir', dir,
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

/** Mac mini3 대기열이 처리하지 않는 시간(23:35~02:40 KST, 공용 맥 창 금지). */
export function inNightBan(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600e3);
  const m = k.getUTCHours() * 60 + k.getUTCMinutes();
  return m >= 23 * 60 + 35 || m < 2 * 60 + 40;
}

/**
 * ChatGPT — Mac mini3 의 공용 채점 대기열(10/28, 9334 크롬은 그쪽 한 프로세스만 쓴다 — 이 기계는 그 크롬을 안 건드린다).
 *   in/<id>.json {image,title,channel,lang} → out/<id>.json {score|null, fix, fixes, better_text, error?}. 60초마다·한 건 30초 안팎·저쪽 일이 먼저.
 *   score null = 못 매김(던진다 — 통과로 세지 않는다). 23:35~02:40 은 처리하지 않으니 기다리지 않고 미채점으로 둔다.
 *   그림은 대기열이 읽을 때까지 남아 있어야 해서 대기열 폴더(img/)에 복사해 두고, 답을 받으면 지운다.
 */
export async function chatgptJudge({ image, title, anchors = null, timeoutMs = 300_000, qdir = process.env.THUMBQ_DIR || join(homedir(), 'history/_thumbq'),
  pollMs = 5000, now = () => new Date(), channel = 'FlowVium', lang = 'ko', retryWaitMs = 20_000 }) {
  if (inNightBan(now())) return { skipped: 'ChatGPT 야간 미채점(23:35~02:40 대기열 쉼)' };
  if (!existsSync(join(qdir, 'in'))) throw new Error(`대기열 없음: ${qdir}`);
  // 10/29 Mac mini2: 대기열이 ChatGPT 첨부 한도에 걸리면 .upload-limit 를 둔다 — 못 매김(=실패)으로, 기다리지도 넣지도 않는다(세 번 묻기라 시간만 세 배로 버린다).
  //   10/31: 안에 적힌 '풀리는 시각'(ms)이 지났으면 지우고 묻는다 — 아무도 안 지워 10/28 저녁부터 사흘간 전 판이 미채점이었다(thumb-gate.test).
  //   시각이 없거나 아직이면 전처럼 못 매김(언제 풀릴지 모르는 걸 풀렸다고 치지 않는다).
  const limitF = join(qdir, '.upload-limit');
  if (existsSync(limitF)) {
    let until = NaN;
    try { until = Number(readFileSync(limitF, 'utf8').trim()); } catch { /* 그새 지워졌다 */ }
    if (until > 0 && until <= now().getTime()) { try { rmSync(limitF, { force: true }); } catch { /* 남이 먼저 지웠다 */ } }
    else if (existsSync(limitF)) throw new Error('ChatGPT 대기열 첨부 한도(.upload-limit) — 못 매김');
  }
  const t0 = Date.now(), deadline = t0 + timeoutMs;
  const once = async () => {
    const id = `flowvium-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    mkdirSync(join(qdir, 'img'), { recursive: true });
    const img = join(qdir, 'img', `${id}${extname(image) || '.jpg'}`);
    copyFileSync(image, img);
    const req = join(qdir, 'in', `${id}.json`);
    // 기준 그림은 대기열이 자기 자리(anchors/<channel>/high·low.jpg)의 것을 쓴다 — 우리는 켜기만 한다.
    writeFileSync(`${req}.tmp`, JSON.stringify({ image: img, title, channel, lang, ...(anchors ? { anchors: true } : {}) }));
    renameSync(`${req}.tmp`, req);
    const out = join(qdir, 'out', `${id}.json`);
    for (; Date.now() < deadline; await new Promise((r) => setTimeout(r, pollMs))) {
      if (!existsSync(out)) continue;
      let a; try { a = JSON.parse(readFileSync(out, 'utf8')); } catch { continue; }   // 원자적으로 쓴다지만 한 번 더 기다려도 손해 없다
      // 받은 요청도 지운다 — 저쪽은 처리한 in 을 남겨 두고(10/28 실측), 답(out)을 지운 뒤 in 이 남으면 다시 매길 수 있다.
      rmSync(out, { force: true }); rmSync(req, { force: true }); rmSync(img, { force: true });
      if (a.score == null || a.error) throw new Error(`ChatGPT 못 매김: ${String(a.error ?? '이유 없음').slice(0, 100)}`);
      // 10/28 실측: 크롬이 막 살아난 뒤 'score 0' 이 세 번 왔다(직전 판 7.2·7.8, 11초 만에) — 0점에 고칠 점도 고칠 글도 없으면 답을 못 읽은 것이다.
      if (Number(a.score) === 0 && !String(a.fix ?? '').trim() && !String(a.better_text ?? '').trim()) throw new Error('ChatGPT 못 매김: 0점 빈 답');
      return { score: a.score, weak: String(a.fix ?? '').slice(0, 300), text: String(a.better_text ?? '') };
    }
    // 요청은 남긴다 — 저쪽이 지금 처리 중일 수 있다. 늦게 온 답(out)과 그림은 다음 정리 때 지운다(thumb-gate-report).
    throw new Error(`ChatGPT 시간초과 ${Math.round(timeoutMs / 1000)}초(대기열 밀림)`);
  };
  // 10/31 Mac mini2: 9334 는 launchd 잡이 되살리는데 그 틈이 ~10초 — 대기열 답이 '크롬에 못 닿음'이면 20초 쉬고 한 번만 다시 넣는다.
  //   시간초과·로그인·못 읽음은 다시 안 넣는다(thumb-gate.test).
  try { return await once(); } catch (e) {
    if (!CHROME_UNREACHABLE.test(e.message) || Date.now() + retryWaitMs >= deadline) throw e;
    await new Promise((r) => setTimeout(r, retryWaitMs));
    return once();
  }
}
const CHROME_UNREACHABLE = /크롬\(포트 \d+\)이 꺼져|ECONNREFUSED|ECONNRESET|fetch failed|창을? 못 열|디버거 주소를 못 찾/;

export function defaultJudges() { return { chatgpt: chatgptJudge, agy: agyJudge, claude: claudeJudge }; }
