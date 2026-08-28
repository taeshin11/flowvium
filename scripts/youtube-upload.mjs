#!/usr/bin/env node
/**
 * youtube-upload.mjs — 영상 1건 업로드. 기본 공개범위는 private.
 *
 * 사용: node scripts/youtube-upload.mjs --file reports/video/pilot.mp4 --title "제목" [--desc ...] [--tags a,b,c] [--thumb x.jpg] [--privacy unlisted]
 */
import { upload, setThumbnail, credentialsPresent, tokenPresent } from './lib/youtube.mjs';
import { envValue } from './lib/footage.mjs';

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
    // 의도한 채널이 아니면 올리지 않는다. .env.local 의 YOUTUBE_CHANNEL_ID 가 기준이다.
    expectChannel: arg('--channel', envValue('YOUTUBE_CHANNEL_ID')),
  });
  console.log(`✅ ${r.url}  (${(r.bytes / 1048576).toFixed(1)}MB, ${arg('--privacy', 'private')})`);
  const thumb = arg('--thumb');
  if (thumb) {
    const t = await setThumbnail(r.id, thumb);
    console.log(t.ok ? `   썸네일 적용 (${(t.bytes / 1024).toFixed(0)}KB)` : `   ⚠ 썸네일 실패: ${t.reason}`);
  }
} catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
