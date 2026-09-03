#!/usr/bin/env node
/**
 * youtube-refresh-desc.mjs — 이미 올라간 영상의 설명란을 현행 규칙으로 다시 쓴다.
 *
 * 왜 필요한가 (2026-09-03, 사용자 "유입 모으자"):
 *   설명란 조립 규칙을 고쳐도 **이미 공개된 영상은 옛 설명란 그대로**다. 링크가 맨 끝에
 *   박힌 영상이 채널에 남아 있으면 그 영상에서 오는 유입은 계속 0이다.
 *   제목·태그는 건드리지 않는다 — 노출이 쌓인 제목을 바꾸면 추천이 초기화될 수 있다.
 *
 * 안전장치: 기본은 미리보기다. 실제로 쓰려면 --confirm 이 필요하다.
 *
 * 사용:
 *   node scripts/youtube-refresh-desc.mjs            # 전체 미리보기
 *   node scripts/youtube-refresh-desc.mjs --confirm  # 실제 반영
 *   node scripts/youtube-refresh-desc.mjs --id VIDEO_ID --confirm
 */
import { google } from 'googleapis';
import { authorizedClient } from './lib/youtube.mjs';

const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const CONFIRM = a.includes('--confirm');
const ONLY = arg('--id');

const SITE = process.env.SITE_URL || 'flowvium.net';
const CTA = {
  ko: (l) => `▶ 전체 기사 · 실시간 시장 데이터 · 심층 분석: ${l}`,
  en: (l) => `▶ Full coverage, live market data and deeper analysis: ${l}`,
};

/** 설명란에서 기존 CTA 줄을 걷어내고 첫 줄 바로 아래에 다시 넣는다. */
export function relinkDescription(desc, locale) {
  const link = `https://${SITE}/go/${locale}`;
  const cta = (CTA[locale] ?? CTA.en)(link);
  // 사이트가 언급된 줄은 어디에 있든 전부 뺀다 — 옛 위치(맨 끝)와 새 위치가 겹치면 안 된다.
  const kept = String(desc ?? '').split('\n').filter((l) => !l.includes(SITE));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  if (!kept.length) return cta;
  return [kept[0], cta, ...kept.slice(1)].join('\n');
}

const yt = google.youtube({ version: 'v3', auth: authorizedClient() });

const me = await yt.channels.list({ part: ['contentDetails'], mine: true });
const uploads = me.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
if (!uploads) { console.error('❌ 업로드 재생목록을 못 찾았다'); process.exit(1); }

const ids = [];
let page;
do {
  const r = await yt.playlistItems.list({ part: ['contentDetails'], playlistId: uploads, maxResults: 50, pageToken: page });
  for (const it of r.data.items ?? []) ids.push(it.contentDetails.videoId);
  page = r.data.nextPageToken;
} while (page);

const targets = ONLY ? ids.filter((i) => i === ONLY) : ids;
if (!targets.length) { console.error(`❌ 대상 없음${ONLY ? ` (${ONLY})` : ''}`); process.exit(1); }
console.log(`대상 ${targets.length}개${CONFIRM ? '' : ' — 미리보기(실제 반영하려면 --confirm)'}\n`);

let changed = 0;
for (let i = 0; i < targets.length; i += 50) {
  const r = await yt.videos.list({ part: ['snippet'], id: targets.slice(i, i + 50) });
  for (const v of r.data.items ?? []) {
    const s = v.snippet;
    const locale = (s.defaultLanguage || s.defaultAudioLanguage || 'ko').startsWith('ko') ? 'ko' : 'en';
    const next = relinkDescription(s.description, locale);
    if (next === s.description) { console.log(`  = ${v.id} 이미 최신`); continue; }
    changed++;
    console.log(`  ${CONFIRM ? '✎' : '·'} ${v.id} ${s.title.slice(0, 44)}`);
    console.log(`      링크 → ${next.split('\n').findIndex((l) => l.includes(SITE)) + 1}번째 줄`);
    if (!CONFIRM) continue;
    // categoryId 와 title 은 update 시 필수다. 빼면 API 가 지운다.
    await yt.videos.update({
      part: ['snippet'],
      requestBody: { id: v.id, snippet: { title: s.title, categoryId: s.categoryId, description: next, tags: s.tags, defaultLanguage: s.defaultLanguage } },
    });
  }
}
console.log(`\n${CONFIRM ? '✅ 반영' : 'ℹ 바뀔 것'} ${changed}개`);
