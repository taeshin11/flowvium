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
// 로케일을 **강제**하는 주소를 쓴다. 그냥 flowvium.net 을 걸면 시청자의 브라우저 언어를
//   보고 엉뚱한 언어의 사이트로 떨어진다(2026-08-29 실측).
// 2026-09-03: 종전엔 `/go/en` 과 영어 문구가 **고정**이었다. --locale 을 받으면서 링크에는
//   안 썼다. 한국어 채널로 전환하니 한국어 영상 설명란에 영어 안내와 영어 사이트 링크가
//   붙는다 — 클릭한 사람이 영어 사이트로 간다. 링크와 문구를 로케일에서 뽑는다.
const siteLink = (locale) => process.env.SITE_LINK || `https://${SITE}/go/${locale}`;
const SITE_CTA = {
  ko: (link) => `▶ 전체 기사 · 실시간 시장 데이터 · 심층 분석: ${link}`,
  en: (link) => `▶ Full coverage, live market data and deeper analysis: ${link}`,
};
// 2026-09-03 (사용자 "유입 모으자"): 종전엔 설명란 **맨 끝**에 붙였다. 실측한 영상은 링크가
//   15줄 아래에 있었다 — 유튜브는 '더보기' 전에 두어 줄만 보여주고, 쇼츠는 설명란을 여는
//   사람 자체가 드물다. 맨 끝 링크는 없는 링크다. 그래서 **첫 줄 바로 아래**에 끼운다.
//   첫 줄(대표 헤드라인)은 검색과 가독성을 위해 남기고, 그 다음 줄을 링크가 차지한다.
const withSite = (d, locale) => {
  const t = String(d ?? '');
  const line = (SITE_CTA[locale] ?? SITE_CTA.en)(siteLink(locale));
  if (t.includes(SITE)) return t;
  if (!t.trim()) return line;
  const lines = t.trimEnd().split('\n');
  return [lines[0], line, ...lines.slice(1)].join('\n');
};

try {
  const r = await upload({
    file: arg('--file'), title: arg('--title'),
    description: withSite(arg('--desc', ''), arg('--locale', 'ko')), privacy: arg('--privacy', 'public'),
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
