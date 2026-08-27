#!/usr/bin/env node
/**
 * flow-clip.mjs — Flow 로 b-roll 클립을 만든다.
 *
 * **text-to-video 로 간다.** 처음엔 이미지를 올려 image-to-video 를 노렸는데, 실측 결과
 *   업로드는 미디어 보관함에만 들어가고 요청에는 첨부되지 않았다(시장 풍경이 나왔다).
 *   그런데 프롬프트만으로 잘 나오고, 그러면 오히려 이점이 크다:
 *     · 권리 확인 모달이 없다
 *     · CC BY-SA 이미지의 파생물 문제가 사라진다(동일조건변경허락 전파)
 *     · 키워드 스톡 검색보다 소재 적합성이 낫다 — 검색은 있는 것 중에 고르고, 생성은 필요한 걸 만든다
 *
 * 모델은 `Veo 3.1 - Lite [Lower Priority]` 고정. 25,000 크레딧/월 중 **0 크레딧**이다.
 *   실측 생성 시간 약 60초/클립(2026-08-27).
 *
 * 사용: node scripts/flow-clip.mjs --prompt "..." --out <mp4> [--wait 600]
 */
import {
  openFlow, sessionCookiesPresent, setVideoModel, openProject, inProject,
  composerVisible, defaultsPanelOpen, typePrompt, dismissDialogs,
  videoUrls, downloadMedia, FREE_VIDEO_MODEL,
} from './lib/flow.mjs';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
// ⚠ **동영상임을 명시해야 한다.** 에이전트가 매체를 스스로 고른다 — 실측(2026-08-27):
//   "US Capitol dome at dusk, slow cinematic push-in, documentary news b-roll" 을 주니
//   Nano Banana Pro 로 **사진**을 만들었다(훌륭한 사진이었지만 영상이 아니다).
//   그리고 이미지 모델은 0 크레딧이 아닐 수 있다 — 우리가 고정한 건 동영상 모델뿐이다.
//   즉 이 한 줄이 품질 문제가 아니라 **과금 문제**다.
const VIDEO_DIRECTIVE = 'Create an 8 second VIDEO clip (not an image). ';
const PROMPT = VIDEO_DIRECTIVE + arg('--prompt',
  'documentary news b-roll, slow cinematic push-in, natural daylight, no on-screen text');
const OUT = resolve(arg('--out', 'assets/broll/flow-clip.mp4'));
const WAIT_S = Number(arg('--wait', 600));
const SHOTS = arg('--shots', null);
const MODEL = arg('--model', process.env.FLOW_VIDEO_MODEL ?? FREE_VIDEO_MODEL);
// 유료 등급은 **명시적으로 허용해야** 쓴다. 기본 가드는 0 크레딧 모델이 아니면 생성을 막는다 —
//   매일 도는 자동화가 실수로 크레딧을 태우지 않게 하려는 것이고, 그 기본값을 유지한다.
const ALLOW_PAID = argv.includes('--allow-paid');

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });
if (!sessionCookiesPresent()) { console.error('❌ 로그인 세션 없음 — node scripts/flow-login.mjs'); process.exit(1); }

const { ctx, page } = await openFlow({ headless: false });
let step = 0;
const shot = async (l) => { if (!SHOTS) return; step++; await page.screenshot({ path: `${SHOTS}/${step}-${l}.png` }).catch(() => {}); };
const die = async (msg, label) => { console.error(`❌ ${msg}`); await shot(label); await ctx.close().catch(() => {}); process.exit(1); };

const t0 = Date.now();
if (!(await openProject(page))) await die('프로젝트 화면 진입 실패', 'no-project');
console.log(`  프로젝트: ${page.url()}`);

// ── 모델 고정. 0 크레딧이 아니면 생성하지 않는다 ────────────────────────────
const shown = await setVideoModel(page, MODEL);
console.log(`  [모델] 요청 "${MODEL}" → 표시 "${shown}"`);
await shot('model');
if (!inProject(page)) await die(`프로젝트 화면을 벗어났다: ${page.url()}`, 'left-project');
if (!/Lower Priority/.test(shown) && !ALLOW_PAID) {
  await die('0 크레딧 모델이 반영되지 않았다 — 유료 모델로 생성하지 않는다(--allow-paid 로 해제)', 'model-fail');
}
if (!/Lower Priority/.test(shown)) console.log('  ⚠ 유료 등급으로 생성한다 — 크레딧이 소모된다');

// 생성 전에 이미 있는 결과를 기억해 둔다. "영상이 보인다" 만으로는 방금 시킨 것인지 알 수 없다.
const before = new Set(await videoUrls(page));
console.log(`  [기존] 결과 영상 ${before.size}개`);

// ── 프롬프트 → 제출 ────────────────────────────────────────────────────────
await dismissDialogs(page);
if (!(await composerVisible(page))) await die(`작성기를 쓸 수 없다 (설정 패널 열림=${await defaultsPanelOpen(page)})`, 'no-composer');
if (!(await typePrompt(page, PROMPT))) await die('프롬프트가 입력되지 않았다 — 빈 상태로 제출하지 않는다', 'no-prompt');
await shot('prompt');
console.log(`  [프롬프트] ${PROMPT.slice(0, 80)}`);
await page.keyboard.press('Enter').catch(() => {});
await page.waitForTimeout(4000);
await shot('submitted');
console.log('  [생성] 제출');

// ── 결과 대기. **새로 생긴** 영상만 인정한다 ────────────────────────────────
const deadline = Date.now() + WAIT_S * 1000;
let fresh = null;
while (Date.now() < deadline) {
  const now = await videoUrls(page);
  fresh = now.find((u) => !before.has(u)) ?? null;
  if (fresh) break;
  await dismissDialogs(page);                 // 생성 전 확인 모달이 뜰 수 있다
  await page.waitForTimeout(8000);
  process.stdout.write('.');
}
console.log('');
await shot('result');
if (!fresh) {
  // 사진이 생겼을 수도 있다 — 그건 크레딧을 썼을 가능성이 있으므로 구분해서 알린다.
  const imgs = await page.locator('img[src*="media"], img[src*="blob"]').count().catch(() => 0);
  await die(`${WAIT_S}초 안에 새 **동영상**이 없다 (화면의 이미지 ${imgs}개). `
    + '에이전트가 사진을 만들었을 수 있다 — 프롬프트에 VIDEO 를 명시했는지 확인하라', 'no-result');
}

const secs = ((Date.now() - t0) / 1000).toFixed(0);
let bytes = 0;
try { bytes = await downloadMedia(page, fresh, OUT); }
catch (e) { await die(`내려받기 실패: ${e.message}`, 'download-fail'); }

console.log(`✅ ${OUT}`);
console.log(`   ${(bytes / 1048576).toFixed(1)}MB · 전체 ${secs}초 · 모델 ${shown}`);
await ctx.close().catch(() => {});
