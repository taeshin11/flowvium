#!/usr/bin/env node
/**
 * flow-cards.mjs — 실사를 못 찾은 장면에 깔 **배경 이미지**를 Flow(Nano Banana)로 만들어 둔다.
 *
 * 왜 미리 만드는가: 렌더 중에 브라우저를 띄우면 편당 1분이 더 걸리고, UI 자동화가
 *   깨지는 날엔 그날 영상이 통째로 안 나온다. 배경은 **사건과 무관한 추상 화면**이라
 *   재사용해도 손해가 없다 — 한 번 만들어 두고 돌려 쓴다.
 *
 * 왜 실사를 대체하지 않는가: 뉴스 썸네일·배경에 생성 이미지를 쓰면
 *   "그 사건의 사진" 이 아니게 된다. 실사가 있으면 언제나 실사가 먼저다.
 *
 * 사용: node scripts/flow-cards.mjs [--count 6] [--wait 600]
 * 저장: <MEDIA_ROOT>/cards/card-NN.jpg
 */
import { resolve, join } from 'path';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { mkdirSync, readdirSync, existsSync, renameSync } from 'fs';
import { ROOT } from './lib/project-root.mjs';
import { resolveMediaRoot, ensureDir } from './lib/media-root.mjs';
import { envValue } from './lib/footage.mjs';
import {
  openFlow, openProject, dismissDialogs, typePrompt, composerVisible,
  setImageModel, setVideoModel, imageUrls, videoUrls, downloadMedia,
  isFreeModel, IMAGE_MODEL, FREE_VIDEO_MODEL,
} from './lib/flow.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const COUNT = Number(arg('--count', '6'));
const WAIT = Number(arg('--wait', '600'));
// 기본은 **영상**이다. 움직이는 배경이 정지 이미지보다 낫고, Veo 의 무료 등급은 0 크레딧이다.
const KIND = arg('--kind', 'video');
if (KIND !== 'video' && KIND !== 'image') { console.error(`❌ --kind 는 video 또는 image (got '${KIND}')`); process.exit(1); }
const EXT = KIND === 'video' ? 'mp4' : 'jpg';

const MEDIA = resolveMediaRoot({
  configured: envValue('MEDIA_ROOT'),
  localFallback: resolve(ROOT, 'reports/video'),
  allowLocal: argv.includes('--local-media'),
});
const OUT = ensureDir(join(ensureDir(MEDIA.root), 'cards'));

// 사건과 무관한 **뉴스 스튜디오 톤의 추상 배경**. 사람·글자·로고가 없어야 한다 —
//   글자가 들어가면 생성 모델이 철자를 틀리고, 사람이 들어가면 그 기사의 인물로 읽힌다.
const PROMPTS = [
  'A dark navy blue abstract background for a television news broadcast. Soft diagonal light streaks, subtle depth of field, deep shadows. No text, no letters, no people, no logos, no faces.',
  'An abstract dark blue and charcoal news studio background with softly blurred out-of-focus screen glow. Cinematic, moody, minimal. No text, no people, no logos.',
  'A deep midnight blue gradient background with faint geometric grid lines fading into darkness, broadcast graphics style. No text, no people, no logos.',
  'Abstract dark background of blurred city lights at night in blue and slate tones, heavy bokeh, shallow depth of field. No text, no people, no logos.',
  'A dark slate background with soft red and blue light streaks crossing diagonally, television news title card style. No text, no people, no logos.',
  'An abstract dark blue background with soft flowing waves of light, subtle grain, cinematic news broadcast tone. No text, no people, no logos.',
];

/**
 * 생성 이미지 우하단의 ✦ 워터마크를 **잘라낸다.**
 *
 * 실측(2026-08-28, 1376x768): 마크는 x 1257~1305, y 646~694 — 우하단 모서리다.
 *   그대로 두면 켄번스로 화면이 움직이면서 자막 밴드 위로 올라온다.
 *   지우는 게 아니라 **그 모서리를 빼고 쓰는 것**이다 — 배경은 어차피 채워서 자른다.
 *   가로 88% · 세로 84% 를 왼쪽 위에서 잘라내면 그 자리가 남지 않는다(여유 5% 이상).
 */
function trimWatermark(file, kind) {
  // 실측 마크 위치(우하단):
  //   이미지 1376x768 → ✦  x 1257~1305 (91~95%), y 646~694 (84~90%)  → 88% x 84% 로 자른다
  //   영상   1280x720 → Veo x 1240~1268 (97~99%), y 694~704 (96~98%) → 95% x 95% 면 충분하다
  // 잘라내는 폭이 작을수록 해상도 손실이 적다 — 종류별로 다르게 잡는다.
  const [fw, fh] = kind === 'video' ? [0.95, 0.95] : [0.88, 0.84];
  const tmp = `${file}.trim.${kind === 'video' ? 'mp4' : 'jpg'}`;
  const vf = `crop=floor(iw*${fw}/2)*2:floor(ih*${fh}/2)*2:0:0`;
  const args = kind === 'video'
    ? ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-vf', vf,
       '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an', tmp]
    : ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-vf', vf, '-q:v', '3', tmp];
  const r = spawnSync(ffmpegPath, args);
  if (r.status !== 0) return false;
  try { renameSync(tmp, file); return true; } catch { return false; }
}

const pad = (n) => String(n).padStart(2, '0');
const existing = existsSync(OUT) ? readdirSync(OUT).filter((f) => new RegExp(`^card-\\d+\\.${EXT}$`).test(f)) : [];
console.log(`  [카드] ${KIND} · 기존 ${existing.length}개 · 목표 ${COUNT}개 · ${OUT}`);
if (existing.length >= COUNT) {
  console.log('  이미 충분하다 — 다시 만들지 않는다. 다시 만들려면 파일을 지울 것.');
  process.exit(0);
}

const { ctx, page } = await openFlow({ headless: false });
const die = async (msg) => { console.error(`❌ ${msg}`); await ctx.close(); process.exit(1); };
try {
  if (!(await openProject(page))) await die('프로젝트를 열지 못했다');
  await dismissDialogs(page);

  const want = KIND === 'video' ? FREE_VIDEO_MODEL : IMAGE_MODEL;
  let r = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    r = KIND === 'video' ? await setVideoModel(page, want) : await setImageModel(page, want);
    console.log(`  [모델] 시도 ${attempt}: "${r.shown}" · ${r.status}`);
    if (r.ok || !r.retryable) break;
    await dismissDialogs(page);
    await page.waitForTimeout(1500);
  }
  if (!r.ok) await die(`${KIND} 모델을 지정하지 못했다 (${r.status}, 표시="${r.shown}") — ${r.hint}`);
  // 동영상은 무료 등급인지 확인한다 — 매일 도는 자동화에서 조용히 크레딧을 태우면 안 된다.
  if (KIND === 'video' && !isFreeModel(r.shown)) await die(`0 크레딧 모델이 아니다 — "${r.shown}"`);

  let made = 0;
  for (let i = existing.length; i < COUNT; i++) {
    const prompt = PROMPTS[i % PROMPTS.length];
    const list = KIND === 'video' ? videoUrls : imageUrls;
    const before = new Set(await list(page));
    await dismissDialogs(page);
    if (!(await composerVisible(page))) await die('작성기를 쓸 수 없다');
    const directive = KIND === 'video'
      ? 'Create an 8 second VIDEO clip (not an image). Slow, gentle, continuous motion. '
      : 'Generate one IMAGE (not a video). ';
    if (!(await typePrompt(page, `${directive}${prompt}`)))
      await die('프롬프트가 입력되지 않았다 — 빈 상태로 제출하지 않는다');
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(4000);

    let fresh = null;
    const deadline = Date.now() + WAIT * 1000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(8000);
      const now = await list(page);
      // 개수가 **늘었을 때만** 새 결과로 본다. 화면 전환으로 붙은 URL 을 오인하지 않는다.
      if (now.length > before.size) { fresh = now.find((u) => !before.has(u)) ?? null; if (fresh) break; }
      process.stdout.write('.');
    }
    process.stdout.write('\n');
    if (!fresh) { console.error(`  ⚠ ${i + 1}번째 생성 실패 — 건너뛴다`); continue; }
    const dest = join(OUT, `card-${pad(i)}.${EXT}`);
    await downloadMedia(page, fresh, dest);
    if (!trimWatermark(dest, KIND)) console.error(`  ⚠ 워터마크 제거 실패 — ${dest}`);
    made++;
    console.log(`  ✅ ${dest}`);
  }
  const total = readdirSync(OUT).filter((f) => new RegExp(`^card-\\d+\\.${EXT}$`).test(f)).length;
  console.log(`\n  ${made}개 생성 · 총 ${total}개 (${KIND})`);
} finally { await ctx.close(); }
