#!/usr/bin/env node
/**
 * youtube-upload.mjs — 영상 1건 업로드. 기본 공개범위는 **public**.
 *
 * 기본 공개범위는 **public** 이다(2026-08-28 지시). 비공개로 올리려면 --privacy private.
 * 사용: node scripts/youtube-upload.mjs --file reports/video/pilot.mp4 --title "제목" [--desc ...] [--tags a,b,c] [--thumb x.jpg] [--privacy unlisted]
 */
import { upload, setThumbnail, credentialsPresent, tokenPresent } from './lib/youtube.mjs';
import { envValue } from './lib/footage.mjs';

const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
if (!credentialsPresent()) { console.error('❌ secrets/youtube-oauth.json 없음'); process.exit(1); }
if (!tokenPresent()) { console.error('❌ 토큰 없음 — node scripts/youtube-auth.mjs 먼저'); process.exit(1); }

/**
 * 설명란에 사이트 주소를 보장한다. 채널로 사이트를 홍보하는 게 목적인데,
 * 편마다 사람이 손으로 붙이면 언젠가 빠진 편이 나온다 — 빠질 수 없게 코드가 넣는다.
 * 이미 들어 있으면 두 번 넣지 않는다.
 */
const SITE = process.env.SITE_URL || 'flowvium.net';
// 영어 채널이므로 **영어로 강제**하는 주소를 쓴다. 그냥 flowvium.net 을 걸면
//   한국 시청자의 브라우저 언어를 보고 한국어 사이트로 떨어진다(2026-08-29 실측).
const SITE_LINK = process.env.SITE_LINK || `https://${SITE}/go/en`;
const withSite = (d) => {
  const t = String(d ?? '');
  if (t.includes(SITE)) return t;
  const line = `▶ Full coverage, live market data and deeper analysis: ${SITE_LINK}`;
  return t.trim() ? `${t.trimEnd()}\n\n${line}` : line;
};

try {
  const r = await upload({
    file: arg('--file'), title: arg('--title'),
    description: withSite(arg('--desc', '')), privacy: arg('--privacy', 'public'),
    tags: (arg('--tags', '') || '').split(',').filter(Boolean),
    locale: arg('--locale', 'ko'),
    // 의도한 채널이 아니면 올리지 않는다. .env.local 의 YOUTUBE_CHANNEL_ID 가 기준이다.
    expectChannel: arg('--channel', envValue('YOUTUBE_CHANNEL_ID')),
  });
  console.log(`✅ ${r.url}  (${(r.bytes / 1048576).toFixed(1)}MB, ${arg('--privacy', 'public')})`);
  const thumb = arg('--thumb');
  if (thumb) {
    const t = await setThumbnail(r.id, thumb);
    console.log(t.ok ? `   썸네일 적용 (${(t.bytes / 1024).toFixed(0)}KB)` : `   ⚠ 썸네일 실패: ${t.reason}`);
  }
} catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
