#!/usr/bin/env node
/**
 * flow-clip.mjs — Flow 로 **클립 한 편**을 만든다(image-to-video). 자동화의 최소 단위.
 *
 * 모델은 `Veo 3.1 - Lite [Lower Priority]` 를 고정한다 — 25,000 크레딧/월 중 **0 크레딧**이라
 *   매일 발행에 쓸 수 있는 유일한 선택지다(느린 큐가 대가). 다른 항목을 고르면 크레딧이 녹는다.
 *   목록 실측(2026-08-27): Omni Flash / Veo 3.1 - Lite / Fast / Quality / Lite [Lower Priority]
 *
 * 생성 기본값 패널은 상단 기어가 아니라 **프롬프트 입력창의 슬라이더(tune) 아이콘**이 연다.
 *   기어는 "보기 모드"(그리드 크기)만 연다 — 둘을 혼동해 한 번 헛돌았다.
 *
 * 사용: node scripts/flow-clip.mjs --image <path> --prompt "..." --out <mp4> [--wait 900]
 */
import { openFlow, sessionCookiesPresent, setVideoModel, openProject, inProject, composerVisible, defaultsPanelOpen, typePrompt, dismissDialogs, waitUpload, FREE_VIDEO_MODEL } from './lib/flow.mjs';
import { mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const IMAGE = arg('--image', null);
const PROMPT = arg('--prompt', 'slow cinematic push in, documentary news b-roll, no text, no people talking');
const OUT = resolve(arg('--out', 'reports/video/flow-clip.mp4'));
const WAIT_S = Number(arg('--wait', 900));
const SHOTS = arg('--shots', '/tmp/flow-clip');
const MODEL = process.env.FLOW_VIDEO_MODEL ?? FREE_VIDEO_MODEL;

mkdirSync(SHOTS, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });
if (!sessionCookiesPresent()) { console.error('❌ 로그인 세션 없음 — node scripts/flow-login.mjs'); process.exit(1); }
if (IMAGE && !existsSync(IMAGE)) { console.error(`❌ 이미지 없음: ${IMAGE}`); process.exit(1); }

const { ctx, page } = await openFlow({ headless: false });
let step = 0;
const shot = async (l) => { step++; await page.screenshot({ path: `${SHOTS}/${step}-${l}.png` }).catch(() => {}); };

if (!(await openProject(page))) {
  console.error('❌ 프로젝트 화면 진입 실패');
  await shot('no-project'); await ctx.close().catch(() => {}); process.exit(1);
}
console.log(`  프로젝트: ${page.url()}`);

// ── 1. 모델 고정 ────────────────────────────────────────────────────────────
const shown = await setVideoModel(page, MODEL);
console.log(`  [모델] 요청 "${MODEL}" → 표시 "${shown}"`);
await shot('model');
// 설정을 만지다 프로젝트 밖으로 튕겨나올 수 있다(닫기 버튼 오인). 매번 확인한다.
if (!inProject(page)) {
  console.error(`❌ 프로젝트 화면을 벗어났다: ${page.url()}`);
  await shot('left-project'); await ctx.close().catch(() => {}); process.exit(1);
}
if (!/Lower Priority/.test(shown)) {
  console.error('❌ 0 크레딧 모델이 반영되지 않았다 — 유료 모델로 생성하지 않는다');
  await shot('model-fail'); await ctx.close().catch(() => {}); process.exit(1);
}

// ── 2. 이미지 첨부 + 프롬프트 ───────────────────────────────────────────────
if (IMAGE) {
  const fi = page.locator('input[type=file][accept*="image"]').first();
  if (!(await fi.count().catch(() => 0))) { console.error('❌ 이미지 입력 없음'); await ctx.close(); process.exit(1); }
  await fi.setInputFiles(IMAGE).catch((e) => console.log(`  첨부 실패 ${e.message.slice(0, 60)}`));
  await page.waitForTimeout(4000);
  await shot('attached');
  // 업로드하면 권리 확인 모달이 뜬다. 처리 안 하면 그 아래 UI 를 못 만진다(실측).
  const cleared = await dismissDialogs(page);
  await page.waitForTimeout(2500);
  await shot('after-dialog');
  if (!cleared) {
    console.error('❌ 권리 확인 모달이 닫히지 않았다 — 아래 UI 를 만질 수 없다');
    await ctx.close().catch(() => {}); process.exit(1);
  }
  console.log('  [모달] 닫힘 확인');
  // 업로드 완료를 기다린다. 진행률이 도는 중에 보내면 첨부 없이 생성될 수 있다.
  if (!(await waitUpload(page))) console.log('  ⚠ 업로드 진행률이 안 끝났다 — 그래도 계속한다');
  else console.log('  [업로드] 완료');
  await shot('uploaded');
  console.log(`  [첨부] ${IMAGE}`);
}
if (!(await composerVisible(page))) {
  console.error(`❌ 작성기를 쓸 수 없다 (설정 패널 열림=${await defaultsPanelOpen(page)})`);
  await shot('no-composer'); await ctx.close().catch(() => {}); process.exit(1);
}
if (!(await typePrompt(page, PROMPT))) {
  console.error('❌ 프롬프트가 입력되지 않았다 — 빈 상태로 제출하지 않는다');
  await shot('no-prompt'); await ctx.close().catch(() => {}); process.exit(1);
}
await shot('prompt');
console.log(`  [프롬프트] ${PROMPT.slice(0, 70)}`);

await page.keyboard.press('Enter').catch(() => {});
console.log('  [생성] 제출 — Lower Priority 큐라 오래 걸린다');
await page.waitForTimeout(5000);
await shot('submitted');

// ── 3. 결과 대기 ────────────────────────────────────────────────────────────
const deadline = Date.now() + WAIT_S * 1000;
let videoUrl = null;
while (Date.now() < deadline) {
  videoUrl = await page.evaluate(() => {
    const v = [...document.querySelectorAll('video')].map((e) => e.currentSrc || e.src).filter(Boolean);
    return v[v.length - 1] ?? null;
  }).catch(() => null);
  if (videoUrl) break;
  await page.waitForTimeout(10_000);
  process.stdout.write('.');
}
console.log('');
await shot('result');
if (!videoUrl) { console.error(`❌ ${WAIT_S}초 안에 결과 없음`); await ctx.close().catch(() => {}); process.exit(1); }
console.log(`  [결과] ${videoUrl.slice(0, 90)}`);
console.log('  ⓘ 다운로드는 다음 단계에서 붙인다 — 우선 생성이 되는지부터 확인한다.');
await new Promise((r) => setTimeout(r, 120_000));
await ctx.close().catch(() => {});
