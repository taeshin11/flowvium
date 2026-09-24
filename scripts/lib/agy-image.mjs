/**
 * agy-image.mjs — agy(Antigravity CLI)의 generate_image 도구로 그림 한 장을 만든다. (2026-09-25 신설)
 *
 * 왜 (사장님 "flow 차단을 좀 줄일수있나해서"):
 *   Flow 는 브라우저 자동화라 화면이 바뀌거나 계정이 의심받으면 막힌다. agy 는 명령줄 하나다.
 *   agy 안의 도구 인자 구조(실행파일에서 확인): { Prompt, ImageName, AspectRatio, ImagePaths(최대 3) }
 *   모델 이름은 gemini-3.1-flash-image — Flow 의 Nano Banana 와 같은 계열이다.
 *   실측(2026-09-25): 정사각 1024x1024 · 9:16 768x1376, 한 장 약 25초. Flow 크레딧을 안 쓴다.
 *   **영상 도구는 없다**(agy 에게 도구 목록을 물어 확인) — Veo 는 여전히 Flow 다.
 *
 * 권한: 지금 설정(read_file 만 허용)을 **바꾸지 않았다.** generate_image 는 그 상태로 돌았다.
 *   --sandbox 로 부르고, 권한 건너뛰기는 쓰지 않는다. 터미널 금지 문구를 앞에 붙인다.
 *
 * 믿지 않고 재는 것 — 도구가 "성공" 해도 빈 그림일 수 있다:
 *   · 경로는 모델의 답이 아니라 **agy 가 남긴 도구 출력**(steps/N/output.txt)에서 찾는다
 *     (실측: 모델이 답에 쓴 경로와 무관하게 도구 출력이 진짜 위치를 적는다)
 *   · 크기·비율·밝기를 잰다. 새까맣거나 하얗게 날아간 그림, 비율이 틀린 그림은 실패다.
 *
 * ⚠ 뉴스 장면에 쓰지 않는다. 시험 그림(환율 급등)에 **묻지도 않은 환율 숫자**와 반대 방향 화살표가
 *   그려졌다 — 진짜 보도사진처럼 보이는 거짓이다. 배경·광고·카드처럼 사실을 말하지 않는 그림에만 쓴다.
 *   프롬프트에 "숫자·글자·실존 인물 없음" 을 넣는 것은 부르는 쪽 책임이다.
 */
import { spawnSync, execFile } from 'child_process';
import { existsSync, mkdtempSync, copyFileSync, readdirSync, readFileSync, rmSync, statSync, mkdirSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join, dirname, basename, resolve } from 'path';
import util from 'util';
import ffmpegPath from 'ffmpeg-static';
import { agyBin } from './agy.mjs';
import { AGY_MODEL_CHAIN } from './agy-report.mjs';

const execFileAsync = util.promisify(execFile);

/** 도구가 받는 비율(실행파일 문자열과 실측으로 확인한 것만). */
const ASPECTS = { '1:1': 1, '9:16': 9 / 16, '16:9': 16 / 9, '3:4': 3 / 4, '4:3': 4 / 3 };
const MAX_REFS = 3;
const DEFAULT_BRAIN = join(homedir(), '.gemini/antigravity-cli/brain');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 너비·높이·평균 밝기(Y, 0~255). 못 재면 null. */
function probe(path) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', path, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG',
    '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
  const err = String(r.stderr ?? '');
  const d = /,\s*(\d{2,5})x(\d{2,5})[\s,\[]/.exec(err);
  const y = /YAVG=([\d.]+)/.exec(err);
  if (!d || !y) return null;
  return { width: +d[1], height: +d[2], yavg: +y[1] };
}

/** agy 가 남긴 도구 출력에서 그림 경로를 찾는다. 없으면 대화 폴더의 그림 파일. */
function findImage(convDir) {
  const steps = join(convDir, '.system_generated/steps');
  if (existsSync(steps)) {
    for (const s of readdirSync(steps).sort((a, b) => Number(b) - Number(a))) {
      const f = join(steps, s, 'output.txt');
      if (!existsSync(f)) continue;
      const m = /Generated image is saved at (.+?\.(?:jpe?g|png|webp))/i.exec(readFileSync(f, 'utf8'));
      if (m && existsSync(m[1]) && resolve(m[1]).startsWith(resolve(convDir))) return m[1];
    }
  }
  if (!existsSync(convDir)) return null;
  const imgs = readdirSync(convDir).filter((n) => /\.(jpe?g|png|webp)$/i.test(n))
    .map((n) => join(convDir, n)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return imgs[0] ?? null;
}

/**
 * @param {{prompt:string, out:string, aspect?:string, refs?:string[], timeoutMs?:number,
 *          model?:string, agyImpl?:Function, brainRoot?:string, keepConversation?:boolean}} o
 * @returns {Promise<{ok:boolean, reason?:string, path?:string, width?:number, height?:number, yavg?:number, seconds?:number}>}
 */
export async function generateImage(o) {
  const { prompt, out, aspect = '9:16', refs = [], timeoutMs = 180_000, agyImpl } = o;
  const brainRoot = o.brainRoot ?? DEFAULT_BRAIN;
  const model = o.model ?? AGY_MODEL_CHAIN[0];
  if (!prompt || !out) return { ok: false, reason: 'prompt·out 이 필요하다' };
  if (!(aspect in ASPECTS)) return { ok: false, reason: `모르는 비율 ${aspect} (가능: ${Object.keys(ASPECTS).join(', ')})` };
  if (refs.length > MAX_REFS) return { ok: false, reason: `참고 그림은 ${MAX_REFS}장까지다 (${refs.length}장)` };
  for (const r of refs) if (!existsSync(r)) return { ok: false, reason: `참고 그림이 없다: ${r}` };

  // 참고 그림은 작업 폴더로 복사해 그 안의 경로를 준다 — agy 는 --add-dir 밖을 읽지 않는다.
  const work = mkdtempSync(join(tmpdir(), 'agy-image-'));
  const refPaths = refs.map((r, i) => { const p = join(work, `ref${i + 1}-${basename(r)}`); copyFileSync(r, p); return p; });
  const p = [
    '⛔ 어떤 터미널 명령도 실행하지 마라. 파일은 read_file 로만 열어라.',
    `generate_image 도구를 **한 번만** 호출해라. 다른 도구는 쓰지 마라.`,
    `- AspectRatio: ${aspect}`,
    `- ImageName: img`,
    ...(refPaths.length ? [`- ImagePaths: ${JSON.stringify(refPaths)}`] : []),
    '- Prompt: 아래 <prompt> 안의 글을 **고치지 말고 그대로** 넣어라.',
    '<prompt>', prompt, '</prompt>',
    '끝나면 {"done":true} 한 줄만 답해라.',
  ].join('\n');
  const args = ['--sandbox', '--output-format', 'json', '--model', model, '--add-dir', work,
    '--print-timeout', `${Math.ceil(timeoutMs / 1000)}s`, '-p', p];

  const t0 = Date.now();
  let stdout = '';
  try {
    if (agyImpl) stdout = (await agyImpl(args)).stdout ?? '';
    else {
      const bin = agyBin();
      if (!bin) return { ok: false, reason: 'agy 실행파일을 못 찾았다' };
      stdout = (await execFileAsync(bin, args, { timeout: timeoutMs + 15_000, maxBuffer: 20 * 1024 * 1024 })).stdout;
    }
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    return { ok: false, reason: `agy 실행 실패: ${String(e?.message ?? e).split('\n')[0].slice(0, 120)}` };
  }
  rmSync(work, { recursive: true, force: true });

  let conv = null;
  try { conv = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1))?.conversation_id ?? null; }
  catch { /* 아래에서 실패로 */ }
  if (!conv || !UUID.test(conv)) return { ok: false, reason: `agy 응답에 대화 id 가 없다: ${stdout.slice(0, 100)}` };
  const convDir = join(brainRoot, conv);
  const cleanup = () => { if (!o.keepConversation && resolve(convDir).startsWith(resolve(brainRoot) + '/')) rmSync(convDir, { recursive: true, force: true }); };

  const img = findImage(convDir);
  if (!img) { cleanup(); return { ok: false, reason: '그림을 만들지 않았다(도구 출력에 그림 없음)' }; }
  const m = probe(img);
  if (!m) { cleanup(); return { ok: false, reason: `그림을 못 읽는다: ${basename(img)}` }; }
  // 밝기: 새까맣거나(≤8) 하얗게 날아간(≥247) 그림은 빈 그림이다.
  if (m.yavg <= 8 || m.yavg >= 247) { cleanup(); return { ok: false, reason: `밝기 ${m.yavg.toFixed(1)} — 빈 그림`, ...m }; }
  const want = ASPECTS[aspect];
  const got = m.width / m.height;
  if (Math.abs(got - want) / want > 0.06) {
    cleanup(); return { ok: false, reason: `비율 ${m.width}x${m.height} — ${aspect} 가 아니다`, ...m };
  }
  mkdirSync(dirname(resolve(out)), { recursive: true });
  copyFileSync(img, out);
  cleanup();
  return { ok: true, path: out, ...m, seconds: Math.round((Date.now() - t0) / 1000) };
}
