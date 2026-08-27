#!/usr/bin/env node
/**
 * youtube-upload.mjs — 영상 1건 업로드. 기본 공개범위는 private.
 *
 * 사용: node scripts/youtube-upload.mjs --file reports/video/pilot.mp4 --title "제목" [--privacy unlisted]
 */
import { upload, credentialsPresent, tokenPresent } from './lib/youtube.mjs';

const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
if (!credentialsPresent()) { console.error('❌ secrets/youtube-oauth.json 없음'); process.exit(1); }
if (!tokenPresent()) { console.error('❌ 토큰 없음 — node scripts/youtube-auth.mjs 먼저'); process.exit(1); }

try {
  const r = await upload({
    file: arg('--file'), title: arg('--title'),
    description: arg('--desc', ''), privacy: arg('--privacy', 'private'),
    tags: (arg('--tags', '') || '').split(',').filter(Boolean),
    locale: arg('--locale', 'ko'),
  });
  console.log(`✅ ${r.url}  (${(r.bytes / 1048576).toFixed(1)}MB, ${arg('--privacy', 'private')})`);
} catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
