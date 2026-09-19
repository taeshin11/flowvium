/**
 * video-eye.mjs — 만든 영상을 **다른 눈으로** 확인한다. (2026-09-19 신설)
 *
 * 사용자 요청: "영상 다 만들고 gemini한테 눈검증 시켜서 문제없는지 확인해."
 *
 * 왜 다른 모델인가: 만든 쪽이 스스로 보면 자기가 의도한 것을 읽는다. 오늘만 해도
 *   썸네일이 새까만 채로 발행됐고(스크린샷·업로드 모두 성공했다), 광고에서 시연이
 *   통째로 빠진 것도 며칠 못 봤다. **결과를 모르는 눈**이 봐야 잡힌다.
 *
 * 모델: 기본 gemini-2.5-flash. 3 Pro 계열(gemini-3.1-pro-preview)은 무료 할당량이 0이라
 *   429 가 온다 — 과금을 켜면 GEMINI_EYE_MODEL 로 바꾸면 된다(코드 수정 불필요).
 *
 * 판정은 **구조화해서** 받는다. 자유 서술로 받으면 "괜찮아 보입니다" 같은 답이 와서
 *   자동 차단에 쓸 수 없다.
 */
import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import { loadEnvLocal } from './llm-config.mjs';

loadEnvLocal?.();
const MODEL = process.env.GEMINI_EYE_MODEL || 'gemini-2.5-flash';
const ENDPOINT = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

/**
 * 영상에서 고르게 뽑는다. 첫 프레임은 검은 경우가 많아 살짝 뒤에서 시작한다.
 *
 * 장수는 길이에 맞춘다(초당 약 1장, 4~8장). 2026-09-19 실측: 6초 광고를 4장으로 봤더니
 *   0.75·2.25·3.75·5.25초가 뽑혀 2.9초의 '전송 완료' 장면을 통째로 건너뛰었고,
 *   검수 모델이 "전송 완료가 안 보인다" 고 옳게 답했다 — **검수가 틀린 게 아니라 표본이 성글었다.**
 */
export function grabFrames(video, n = 0, durationSec = null) {
  if (!existsSync(video)) throw new Error(`파일이 없다: ${video}`);
  // 이미지(썸네일)는 시간축이 없다 — 뽑지 말고 그대로 쓴다.
  if (/\.(jpe?g|png|webp)$/i.test(video)) return [{ at: 0, file: video }];
  let dur = durationSec;
  if (!dur) {
    const p = spawnSync(ffmpegPath, ['-i', video], { encoding: 'utf8' });
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(p.stderr ?? '');
    dur = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 10;
  }
  const count = n > 0 ? n : Math.max(4, Math.min(8, Math.round(dur)));
  const dir = mkdtempSync(join(tmpdir(), 'eye-'));
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = Math.max(0.3, (dur * (i + 0.5)) / count);
    const f = join(dir, `f${i}.jpg`);
    const r = spawnSync(ffmpegPath, ['-v', 'error', '-y', '-ss', String(t.toFixed(2)), '-i', video,
      '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '4', f], { encoding: 'utf8' });
    if (r.status === 0 && existsSync(f)) out.push({ at: Number(t.toFixed(2)), file: f });
  }
  if (!out.length) throw new Error('프레임을 못 뽑았다');
  return out;
}

// ── Antigravity CLI(agy) 경로 ────────────────────────────────────────────────
//
// 2026-09-19: 사용자 Ultra 계정으로 `agy` 로그인이 되면서 **gemini-3.1-pro-high** 를 쓸 수 있게 됐다.
//   무료 API 키로는 3 Pro 가 429(할당량 0)라 2.5-flash 를 쓰고 있었다.
//
// 권한: agy 는 코딩 에이전트라 이미지를 읽을 때도 셸을 쓴다. 이 기계에서는 보고서·쇼츠가 돌고
//   있으므로 통째로 허용할 수 없다. 그래서
//     · --sandbox 로 터미널을 제한하고
//     · **프레임만 들어 있는 임시 폴더를 작업 디렉터리로 준다** — 건드릴 것이 프레임뿐이다.
//   그래도 자율 에이전트를 부르는 일이므로, 실패하면 조용히 API 경로로 내려간다.
// agy 실행 파일을 **절대 경로로** 찾는다.
//   2026-09-19: spawnSync 가 물려받는 PATH 에 ~/.local/bin 이 없어 agy 를 못 찾고 조용히
//   무료 API 로 떨어졌다. 로그에는 모델 이름만 찍혀서, 보지 않으면 모른다.
//   설치 경로는 install.sh 가 쓰는 ~/.local/bin 이 기본이고, AGY_BIN 으로 덮을 수 있다.
// 왜 agy 를 못 썼는지 남긴다. 조용히 떨어지면 값싼 모델로 검사한 줄 모른다(2026-09-19 실제로 그랬다).
const EYE_WHY = [];
export const eyeWhy = () => EYE_WHY.slice();

function agyBin() {
  const cands = [process.env.AGY_BIN, join(process.env.HOME ?? '', '.local/bin/agy'), '/usr/local/bin/agy'];
  for (const c of cands) if (c && existsSync(c)) return c;
  const w = spawnSync('which', ['agy'], { encoding: 'utf8' });
  return w.status === 0 ? (w.stdout ?? '').trim() : null;
}

function agyAvailable() {
  const bin = agyBin();
  if (!bin) return false;
  const r = spawnSync(bin, ['models'], { encoding: 'utf8', timeout: 60000 });
  return r.status === 0 && !/sign in/i.test(`${r.stdout ?? ''}${r.stderr ?? ''}`);
}

function agyInspect(frames, prompt, model, timeoutMs) {
  // 프레임을 임시 폴더로 옮기고 거기서 돌린다(작업 디렉터리 격리).
  const dir = mkdtempSync(join(tmpdir(), 'agy-eye-'));
  const names = frames.map((f, i) => {
    const n = `frame${i}_${f.at}s.jpg`;
    copyFileSync(f.file, join(dir, n));
    return n;
  });
  const schema = join(dir, 'schema.json');
  writeFileSync(schema, JSON.stringify({
    type: 'object',
    properties: { ok: { type: 'boolean' }, issues: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
    required: ['ok', 'issues', 'notes'],
  }));
  const full = `${prompt}\n\n볼 파일(시간 순): ${names.join(', ')}`;
  const bin = agyBin();
  if (!bin) return null;
  // --add-dir 로 **작업 공간에 넣어야** 본다. cwd 만 주면 "파일을 찾을 수 없음" 이라고 답한다(실측).
  const r = spawnSync(bin, ['-p', full, '--model', model, '--sandbox', '--dangerously-skip-permissions',
    '--add-dir', dir, '--json-schema', join(dir, 'schema.json'), '--output-format', 'json'],
  { cwd: dir, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) { EYE_WHY.push(`agy 실행 실패(status ${r.status}${r.error ? ` ${r.error.message}` : ''})`); return null; }
  try {
    const j = JSON.parse(r.stdout.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim());
    const d = j.structured_output;
    if (!d) { EYE_WHY.push('agy 응답에 structured_output 없음'); return null; }
    return { ok: d.ok !== false, checked: true, issues: Array.isArray(d.issues) ? d.issues.map(String) : [],
      readable: true, notes: String(d.notes ?? ''), model: `agy:${model}` };
  } catch (e) { EYE_WHY.push(`agy 응답 파싱 실패: ${String(e.message).slice(0, 50)}`); return null; }
}

const SCHEMA_HINT = `아래 JSON 하나만 출력하라(설명·코드펜스 금지):
{"ok":true|false,"issues":["..."],"readable":true|false,"notes":"한 줄"}
issues 에는 **눈에 보이는 결함만** 적어라. 없으면 빈 배열.`;

/**
 * 프레임들을 보고 판정한다.
 * @param {{at:number,file:string}[]} frames
 * @param {{kind?:string, expect?:string[], model?:string, timeoutMs?:number}} opt
 * @returns {Promise<{ok:boolean, issues:string[], readable:boolean, notes:string, model:string, raw?:string}>}
 */
export async function inspectFrames(frames, opt = {}) {
  const key = process.env.GEMINI_API_KEY;
  // checked=false 는 "검사를 못 했다" 는 뜻이다. ok=true 와 뜻이 다르다 —
  //   구분하지 않으면 과부하(503)로 못 본 것이 "이상 없음" 으로 보고된다(2026-09-19 실제로 그랬다).
  if (!key) return { ok: true, checked: false, issues: [], readable: true, notes: 'GEMINI_API_KEY 없음', model: 'none' };
  const model = opt.model || MODEL;
  const what = opt.kind === 'ad' ? '세로 광고 영상' : opt.kind === 'thumb' ? '쇼츠 썸네일' : '세로 뉴스 쇼츠';
  const expect = (opt.expect ?? []).length
    ? `\n이 화면에는 다음이 보여야 한다: ${opt.expect.join(' · ')}. 안 보이면 issues 에 적어라.` : '';
  const prompt = `너는 영상 품질 검수자다. 아래는 ${what}에서 시간 순으로 뽑은 프레임이다.
다음을 확인하라 — 글자가 잘리거나 화면 밖으로 나갔는가 · 글자가 서로 겹쳤는가 ·
화면이 거의 검거나 비었는가 · 글자가 너무 작아 안 읽히는가 · 깨진 문자(□ � 등)가 있는가 ·
사진과 글자가 겹쳐 안 읽히는가.${expect}
**우리가 얹은 글자만** 본다 — 검은 띠 위의 훅(흰색·노랑), 아래 띠의 형광 연두 캡션, 배지·브랜드·주소.
사진이나 영상 **안에 원래 박혀 있던 글자**(방송사 자막, 기사 사진 속 문구, 화면 속 이메일 본문)는
**잘려 보여도 정상이다** — 우리가 소재를 띠 크기에 맞춰 잘라 쓰기 때문이다. 그걸 문제로 적지 마라.
2026-09-19 실측: 사진 속 방송 자막이 잘린 것을 우리 자막이 잘렸다고 보고한 오탐이 있었다.
우리 캡션인지 아닌지 헷갈리면 **색으로 가른다** — 우리 캡션은 형광 연두(#b6ff3b), 훅은 흰색/노랑이다.
그 색이 아니면 소재 안의 글자다.
"보기 좋다/나쁘다" 같은 취향도 적지 마라. 눈에 보이는 결함만 적어라.
${SCHEMA_HINT}`;

  // Ultra 계정이 붙어 있으면 3 Pro 로 본다. 실패하면 조용히 API(2.5-flash)로 내려간다.
  if (process.env.EYE_BACKEND === 'api') EYE_WHY.push('EYE_BACKEND=api 지정');
  else if (!agyAvailable()) EYE_WHY.push('agy 없음/미로그인');
  if (process.env.EYE_BACKEND !== 'api' && agyAvailable()) {
    const viaAgy = agyInspect(frames, prompt, process.env.AGY_EYE_MODEL || 'gemini-3.1-pro-high', opt.timeoutMs ?? 300000);
    if (viaAgy) return viaAgy;
  }

  const parts = [{ text: prompt }];
  for (const f of frames) {
    parts.push({ text: `[${f.at}초]` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: readFileSync(f.file).toString('base64') } });
  }
  // 503(과부하)은 잠깐 뒤 풀리는 일이 많다 — 두 번까지 다시 시도한다.
  let r = null; let j = {}; let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opt.timeoutMs ?? 120000);
    try {
      r = await fetch(`${ENDPOINT(model)}?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0 } }),
        signal: ctl.signal,
      });
      lastStatus = r.status;
      j = await r.json().catch(() => ({}));
      if (r.ok || (r.status !== 503 && r.status !== 429)) break;
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 2) return { ok: true, checked: false, issues: [], readable: true, model, notes: `검사 오류: ${String(e?.message).slice(0, 60)}` };
      r = null;
    } finally { clearTimeout(timer); }
    await new Promise((res) => { setTimeout(res, 4000 * (attempt + 1)); });
  }
  try {
    if (!r || !r.ok) {
      // 할당량·장애로 못 본 것을 '문제 없음'으로 적지 않는다 — 검사를 안 한 것이다.
      return { ok: true, checked: false, issues: [], readable: true, model, notes: `검사 실패(HTTP ${lastStatus})` };
    }
    const raw = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    const m = /\{[\s\S]*\}/.exec(raw.replace(/```json|```/g, ''));
    if (!m) return { ok: true, checked: false, issues: [], readable: true, model, notes: '응답을 못 읽음', raw: raw.slice(0, 200) };
    const d = JSON.parse(m[0]);
    return {
      ok: d.ok !== false,
      checked: true,
      issues: Array.isArray(d.issues) ? d.issues.map(String) : [],
      readable: d.readable !== false,
      notes: String(d.notes ?? ''),
      model,
    };
  } catch (e) {
    return { ok: true, checked: false, issues: [], readable: true, model, notes: `검사 오류: ${String(e?.message).slice(0, 60)}` };
  }
}

/** 영상 하나를 통째로 검사한다. */
export async function inspectVideo(video, opt = {}) {
  const frames = grabFrames(video, opt.frames ?? 0, opt.durationSec);
  const res = await inspectFrames(frames, opt);
  return { ...res, frames: frames.map((f) => f.at) };
}
