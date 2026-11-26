// Studio 는 'HeadlessChrome' 을 보면 '지원되지 않는 브라우저' 페이지를 낸다(11/26 yt-channel-links before.png).
// 헤드리스로 Studio 를 여는 스크립트는 모두 같은 일반 크롬 UA 를 써야 한다.
import { readFileSync } from 'fs';
import assert from 'assert';
const files = ['scripts/yt-channel-links.mjs', 'scripts/yt-endscreen.mjs', 'scripts/yt-related-video.mjs'];
let fail = 0;
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  try { assert.match(s, /userAgent:\s*STUDIO_UA/, `${f}: Studio 헤드리스인데 STUDIO_UA 를 안 쓴다`); console.log('ok', f); }
  catch (e) { fail++; console.log('FAIL', e.message); }
}
try {
  const { STUDIO_UA } = await import('./studio-ua.mjs');
  assert.ok(/Chrome\/\d+/.test(STUDIO_UA) && !/Headless/i.test(STUDIO_UA), 'STUDIO_UA 는 일반 크롬이어야');
  console.log('ok STUDIO_UA');
} catch (e) { fail++; console.log('FAIL', e.message); }
process.exit(fail ? 1 : 0);
