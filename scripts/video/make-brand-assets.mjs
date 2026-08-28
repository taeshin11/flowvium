#!/usr/bin/env node
/**
 * make-brand-assets.mjs — 채널 프로필 사진과 배너를 만든다.
 *
 * 유튜브 API 로는 프로필·배너를 못 올린다(Studio 에서 사람이 올려야 한다).
 *   그래서 **올릴 파일을 만들어 두는 것**까지가 자동화의 몫이다.
 *
 * 글자는 생성형 이미지 모델에 맡기지 않는다 — 로고의 철자가 틀리면 그걸로 끝이다.
 *   배경만 필요하면 따로 생성해 깔고, 글자는 여기서 정확히 그린다.
 *
 * 규격(2026-08 기준):
 *   프로필 800x800 (원형으로 잘림 — 가장자리 여백 필수), 4MB 이하
 *   배너   2560x1440, 모든 기기에서 보이는 안전영역은 가운데 1546x423, 6MB 이하
 */
import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { ROOT } from '../lib/project-root.mjs';
import { resolveMediaRoot, ensureDir } from '../lib/media-root.mjs';
import { envValue } from '../lib/footage.mjs';

const argv = process.argv.slice(2);
const MEDIA = resolveMediaRoot({
  configured: envValue('MEDIA_ROOT'),
  localFallback: resolve(ROOT, 'reports/video'),
  allowLocal: argv.includes('--local-media'),
});
const OUT = ensureDir(join(ensureDir(MEDIA.root), 'brand'));

const NAVY = '#070d1c';
const RED = '#ff2b2b';

// 원형 크롭 때문에 글자는 안쪽 76% 안에 있어야 한다.
const avatar = `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:800px;height:800px}
body{background:radial-gradient(520px 520px at 50% 42%,#16233f 0%,${NAVY} 70%);
  font-family:-apple-system,Helvetica,sans-serif;color:#fff;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px}
.f{font-size:360px;font-weight:900;letter-spacing:-.06em;line-height:.82}
.bar{width:190px;height:16px;background:linear-gradient(90deg,${RED},#c81e3a);border-radius:2px}
.n{font-size:62px;font-weight:800;letter-spacing:.22em;text-indent:.22em;color:#dbe6ff}
</style><div class="f">F</div><div class="bar"></div><div class="n">FLOWVIUM</div>`;

// 안전영역 밖은 잘려도 되는 장식만 둔다.
const banner = `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:2560px;height:1440px}
body{background:radial-gradient(1700px 900px at 50% 50%,#16233f 0%,${NAVY} 68%);
  font-family:-apple-system,Helvetica,sans-serif;color:#fff;position:relative}
.safe{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:1546px;height:423px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:30px;text-align:center}
.w{font-size:196px;font-weight:900;letter-spacing:.20em;text-indent:.20em;line-height:1}
.bar{width:280px;height:12px;background:linear-gradient(90deg,${RED},#c81e3a)}
.s{font-size:52px;font-weight:600;letter-spacing:.10em;color:#9fb2d4}
/* 안전영역 밖 장식 — 넓은 화면에서만 보인다. */
.g{position:absolute;inset:0;background:
  repeating-linear-gradient(115deg,rgba(255,255,255,.028) 0 2px,transparent 2px 90px)}
</style><div class="g"></div>
<div class="safe"><div class="w">FLOWVIUM</div><div class="bar"></div>
<div class="s">DAILY US NEWS &amp; ISSUES</div></div>`;

const b = await chromium.launch();
try {
  for (const [name, html, w, h] of [
    ['avatar-800.png', avatar, 800, 800],
    ['banner-2560x1440.png', banner, 2560, 1440],
  ]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(html);
    await p.screenshot({ path: join(OUT, name) });
    await p.close();
    console.log(`  ${join(OUT, name)}`);
  }
} finally { await b.close(); }
console.log('\n유튜브 API 로는 못 올린다 — Studio → 맞춤설정 → 브랜딩 에서 직접 올릴 것.');
