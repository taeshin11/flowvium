#!/usr/bin/env node
/**
 * agy-image.mjs — 프롬프트 하나로 그림 한 장을 agy(generate_image)로 만든다. (2026-09-25)
 *
 * flow-image.mjs 와 같은 쓰임새다. **그림은 이쪽을 먼저** 쓴다 — 사장님 "flow 차단을 좀 줄일수있나".
 *   Flow 는 브라우저 자동화라 막히고, 이쪽은 명령줄 하나다(모델은 같은 Nano Banana 계열).
 *   Flow 는 영상(Veo)에만 남긴다. 자세한 근거와 검사는 scripts/lib/agy-image.mjs 머리말.
 *
 * ⚠ 뉴스 장면·사실을 말하는 그림에는 쓰지 않는다 — 숫자·글자를 지어 그린다(실측).
 *
 * 사용: node scripts/agy-image.mjs --prompt "..." --out assets/x.jpg [--aspect 9:16] [--ref a.jpg --ref b.jpg]
 */
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { generateImage } from './lib/agy-image.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); const v = i >= 0 ? argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : d; };
const refs = argv.flatMap((a, i) => (a === '--ref' && argv[i + 1] ? [resolve(ROOT, argv[i + 1])] : []));
const PROMPT = arg('--prompt');
const OUT = arg('--out');
if (!PROMPT || !OUT) { console.error('사용: --prompt "..." --out path.jpg [--aspect 9:16] [--ref a.jpg]'); process.exit(2); }

const r = await generateImage({ prompt: PROMPT, out: resolve(ROOT, OUT), aspect: arg('--aspect', '9:16'), refs });
if (!r.ok) { console.error(`❌ ${r.reason}`); process.exit(1); }
console.log(`✅ ${r.path} · ${r.width}x${r.height} · 밝기 ${r.yavg.toFixed(0)} · ${r.seconds}초`);
