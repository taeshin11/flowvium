#!/usr/bin/env node
/**
 * flow-fetch-last.mjs — 프로젝트의 최신 생성물을 파일로 받는다.
 *
 * 화면에 워터마크처럼 보이는 게 **뷰어 오버레이인지 파일에 박힌 것인지**는
 * 스크린샷으로 판정할 수 없다. 파일을 받아 픽셀을 봐야 안다.
 */
import { openFlow, openProject, sessionCookiesPresent, downloadMedia, dismissDialogs } from './lib/flow.mjs';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

const OUT = resolve(process.argv[2] ?? 'reports/video/flow-last.bin');
mkdirSync(dirname(OUT), { recursive: true });
if (!sessionCookiesPresent()) { console.error('❌ 로그인 세션 없음'); process.exit(1); }

const { ctx, page } = await openFlow({ headless: false });
if (!(await openProject(page))) { console.error('❌ 프로젝트 진입 실패'); await ctx.close(); process.exit(1); }
await dismissDialogs(page);
await page.waitForTimeout(3000);

// 미디어 타일의 원본 URL. video 가 있으면 그걸, 없으면 최신 이미지.
const found = await page.evaluate(() => {
  const vids = [...document.querySelectorAll('video')].map((e) => e.currentSrc || e.src).filter(Boolean);
  const imgs = [...document.querySelectorAll('img')].map((e) => e.currentSrc || e.src)
    .filter((u) => u && /media|storage|googleusercontent/.test(u));
  return { vids, imgs: imgs.slice(0, 6) };
}).catch(() => ({ vids: [], imgs: [] }));
console.log(`  동영상 ${found.vids.length}개 · 이미지 ${found.imgs.length}개`);
const url = found.vids[0] ?? found.imgs[0];
if (!url) { console.error('❌ 받을 미디어가 없다'); await ctx.close(); process.exit(1); }
console.log(`  받는 중: ${url.slice(0, 100)}`);
const n = await downloadMedia(page, url, OUT).catch((e) => { console.error(`❌ ${e.message}`); return 0; });
if (n) console.log(`✅ ${OUT} (${(n / 1024).toFixed(0)}KB)`);
await ctx.close().catch(() => {});
