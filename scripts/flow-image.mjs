#!/usr/bin/env node
/**
 * flow-image.mjs — 프롬프트 하나로 이미지 한 장을 Flow(Nano Banana)로 만든다.
 *
 * 왜 (2026-09-10 사용자 "aisvi 광고넣자. 자비스 되는 사진 넣어서"):
 *   flow-cards.mjs 는 **배경 카드 묶음**을 만드는 전용 스크립트라 프롬프트가 고정이다.
 *   특정 화면 한 장이 필요할 때 쓸 자리가 없어, 같은 흐름을 프롬프트 인자로 뽑았다.
 *
 * 이미지 모델은 크레딧을 쓰지 않는다(2026-08-28 실측: 25030 → 25030 무변).
 *   동영상은 무료 등급 확인이 필요하지만 이 스크립트는 이미지 전용이라 해당 없다.
 *
 * 사용: node scripts/flow-image.mjs --prompt "..." --out assets/outro/jarvis.jpg [--wait 600]
 */
import { resolve, dirname } from 'path';
import { mkdirSync, existsSync, statSync } from 'fs';
import { ROOT } from './lib/project-root.mjs';
import {
  openFlow, openProject, dismissDialogs, typePrompt, composerVisible,
  setImageModel, imageUrls, downloadMedia, IMAGE_MODEL,
} from './lib/flow.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const PROMPT = arg('--prompt');
const OUT = arg('--out');
const WAIT = Number(arg('--wait', '600'));
if (!PROMPT || !OUT) { console.error('사용: --prompt "..." --out path.jpg [--wait 600]'); process.exit(2); }

const dest = resolve(ROOT, OUT);
mkdirSync(dirname(dest), { recursive: true });

const { ctx, page } = await openFlow();
try {
  await openProject(page);
  await dismissDialogs(page);

  let r = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    r = await setImageModel(page, IMAGE_MODEL);
    console.log(`  [모델] 시도 ${attempt}: "${r.shown}" · ${r.status}`);
    if (r.ok || !r.retryable) break;
    await dismissDialogs(page);
    await page.waitForTimeout(1500);
  }
  if (!r.ok) { console.error(`❌ 이미지 모델을 지정하지 못했다 (${r.status}, 표시="${r.shown}")`); process.exit(1); }

  const before = new Set(await imageUrls(page));
  if (!(await composerVisible(page))) { console.error('❌ 작성기를 쓸 수 없다'); process.exit(1); }
  // "IMAGE (not a video)" 를 앞에 붙인다 — 같은 작성기가 동영상도 만들기 때문이다(flow-cards 와 동일).
  if (!(await typePrompt(page, `Generate one IMAGE (not a video). ${PROMPT}`))) {
    console.error('❌ 프롬프트가 입력되지 않았다 — 빈 상태로 제출하지 않는다'); process.exit(1);
  }
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(4000);

  let fresh = null;
  const deadline = Date.now() + WAIT * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(8000);
    const now = await imageUrls(page);
    // 개수가 **늘었을 때만** 새 결과로 본다 — 화면 전환으로 붙은 URL 을 오인하지 않는다.
    if (now.length > before.size) { fresh = now.find((u) => !before.has(u)) ?? null; if (fresh) break; }
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  if (!fresh) { console.error(`❌ ${WAIT}초 안에 생성되지 않았다`); process.exit(1); }

  await downloadMedia(page, fresh, dest);
  if (!existsSync(dest) || statSync(dest).size < 10_000) { console.error(`❌ 내려받은 파일이 비었다: ${dest}`); process.exit(1); }
  console.log(`✅ ${dest} · ${(statSync(dest).size / 1024).toFixed(0)}KB`);
} finally { await ctx.close(); }
