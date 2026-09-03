#!/usr/bin/env node
/**
 * youtube-banner.mjs — 채널 배너를 만들고 올린다.
 *
 * 사용자(2026-09-03): "youtube 채널 배너에도 flowvium.net 광고 좀 적어놔야할듯"
 *
 * 왜 새로 만드나: 기존 배너는 "DAILY US NEWS & ISSUES" 영어 문구뿐이고 주소가 없다.
 *   채널을 한국어로 돌렸는데 배너만 영어로 남아 있었다.
 *
 * ⚠ 안전영역(safe area)이 이 작업의 핵심이다.
 *   배너는 2560×1440 으로 올리지만, TV 는 전체, PC 는 가운데 넓은 띠, **휴대폰은 1546×423 만** 보인다.
 *   대부분의 시청자는 휴대폰이다. 글자가 그 밖으로 나가면 정작 아무도 못 본다.
 *   그래서 모든 글자를 가운데 1546×423 안에 넣는다.
 *
 * API 로 되는 것: 배너 업로드(channelBanners.insert → channels.update).
 *   API 로 안 되는 것: 채널 이름, 프로필 사진, 배너 위의 '링크' 칩(About 링크).
 *     링크 칩은 Studio 에서 사람이 넣어야 한다 — 그래서 주소를 **그림 안에** 적는다.
 *
 * 사용:
 *   node scripts/youtube-banner.mjs                 # 이미지만 만들고 미리보기
 *   node scripts/youtube-banner.mjs --apply         # 만들고 채널에 적용
 */
import { existsSync, mkdirSync, readFileSync, createReadStream } from 'fs';
import { dirname, resolve } from 'path';
import { google } from 'googleapis';
import { chromium } from 'playwright';
import { ROOT } from './lib/project-root.mjs';
import { authorizedClient } from './lib/youtube.mjs';
import { resolveMediaRoot } from './lib/media-root.mjs';

const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const APPLY = a.includes('--apply');

const W = 2560, H = 1440;
// 휴대폰에서 보이는 영역. 여기를 벗어난 글자는 대부분의 시청자에게 안 보인다.
const SAFE_W = 1546, SAFE_H = 423;
const SITE = process.env.SITE_URL || 'flowvium.net';

const OUT = arg('--out', resolve(resolveMediaRoot().root, 'brand/banner-ko-2560x1440.png'));

/** 배너 HTML. 색은 사용자 방침(노랑·빨강 강조)과 기존 배너의 남색 바탕을 잇는다. */
export function bannerHtml() {
  return `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{background:
  repeating-linear-gradient(115deg, rgba(255,255,255,.022) 0 2px, transparent 2px 190px),
  radial-gradient(120% 90% at 50% 45%, #16233f 0%, #0d1526 55%, #070c16 100%);
  font-family:'Apple SD Gothic Neo',-apple-system,Helvetica,sans-serif;
  display:flex;align-items:center;justify-content:center}
/* 안전영역 — 모든 글자는 이 안에 있어야 한다(휴대폰에서 보이는 유일한 부분) */
.safe{width:${SAFE_W}px;height:${SAFE_H}px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;text-align:center}
.wordmark{font-size:128px;font-weight:800;color:#fff;letter-spacing:.20em;
  text-indent:.20em;line-height:1}
.rule{width:200px;height:8px;background:#e23b3b;margin:22px 0 20px;border-radius:2px}
.tag{font-size:42px;font-weight:700;color:#aab8d4;letter-spacing:.02em}
/* 주소 — 이 배너를 다시 만든 이유. 가장 눈에 띄는 노랑으로, 띠를 둘러 광고처럼 보이게. */
.site{margin-top:28px;display:inline-flex;align-items:center;gap:18px;
  background:rgba(255,212,0,.10);border:3px solid #ffd400;border-radius:999px;
  padding:16px 42px}
.site .u{font-size:48px;font-weight:800;color:#ffd400;letter-spacing:.01em}
.site .s{font-size:30px;font-weight:600;color:#e6edf9}
</style>
<div class="safe">
  <div class="wordmark">FLOWVIUM</div>
  <div class="rule"></div>
  <div class="tag">한국과 미국의 오늘을, 군더더기 없이</div>
  <div class="site"><span class="u">${SITE}</span><span class="s">전체 분석 · 실시간 시장 데이터</span></div>
</div>`;
}

async function render() {
  mkdirSync(dirname(OUT), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(bannerHtml(), { waitUntil: 'networkidle' });
    // 안전영역을 실제로 벗어나지 않았는지 **재어서** 확인한다. 눈짐작으로 두면 휴대폰에서 잘린다.
    const overflow = await page.evaluate((safe) => {
      const box = document.querySelector('.safe').getBoundingClientRect();
      const bad = [];
      for (const el of document.querySelectorAll('.safe *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) {
          bad.push(`${el.className || el.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
      }
      return bad;
    }, { SAFE_W, SAFE_H });
    if (overflow.length) {
      console.error(`❌ 안전영역을 벗어난 요소: ${overflow.join(', ')} — 휴대폰에서 잘린다`);
      process.exit(1);
    }
    await page.screenshot({ path: OUT });
  } finally { await browser.close(); }
  console.log(`✅ 배너 생성 ${OUT}`);
  console.log(`   ${W}×${H} · 안전영역 ${SAFE_W}×${SAFE_H} 안에 전부 들어감(측정 확인)`);
}

await render();
if (!APPLY) { console.log('\n적용하려면 --apply'); process.exit(0); }

const yt = google.youtube({ version: 'v3', auth: authorizedClient() });
const before = await yt.channels.list({ part: ['brandingSettings'], mine: true });
const ch = before.data.items[0];
console.log(`  이전 배너: ${ch.brandingSettings?.image?.bannerExternalUrl ? '있음' : '(없음)'}`);

const up = await yt.channelBanners.insert({ media: { body: createReadStream(OUT) } });
const url = up.data.url;
if (!url) { console.error('❌ 업로드는 됐는데 url 이 안 왔다'); process.exit(1); }

await yt.channels.update({
  part: ['brandingSettings'],
  requestBody: {
    id: ch.id,
    brandingSettings: { ...ch.brandingSettings, image: { ...(ch.brandingSettings?.image ?? {}), bannerExternalUrl: url } },
  },
});
// "보냈다" 와 "바뀌었다" 는 다르다 — 다시 읽어 확인한다.
const after = await yt.channels.list({ part: ['brandingSettings'], mine: true });
const now = after.data.items[0].brandingSettings?.image?.bannerExternalUrl;
console.log(now && now !== ch.brandingSettings?.image?.bannerExternalUrl
  ? '✅ 배너 교체 확인 (채널에서 다시 읽음)'
  : `⚠ 반영을 확인 못 했다 — 이전 ${ch.brandingSettings?.image?.bannerExternalUrl?.slice(-20)} / 지금 ${String(now).slice(-20)}`);
console.log('  ℹ 반영에 몇 분 걸릴 수 있다. 배너 위의 링크 칩은 API 로 못 넣어 Studio 에서 사람이 넣는다.');
