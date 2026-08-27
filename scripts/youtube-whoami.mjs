#!/usr/bin/env node
/**
 * youtube-whoami.mjs — 이 토큰이 **어느 채널**에 붙어 있고, 올린 영상이 거기 있는가.
 *
 * 왜 필요한가(2026-08-27): 비공개 업로드가 성공(videoId 반환)했는데 사용자가 스튜디오에서
 *   찾지 못했다. 구글 계정에 브랜드 채널이 여러 개면 OAuth 동의 때 고른 채널로 올라가고,
 *   스튜디오는 기본으로 다른 채널을 열어준다. "업로드 성공" 만으로는 이 상황을 못 잡는다.
 *
 * 사용: node scripts/youtube-whoami.mjs [videoId ...]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const oa = JSON.parse(readFileSync(resolve(ROOT, 'secrets/youtube-oauth.json'), 'utf8'));
const tk = JSON.parse(readFileSync(resolve(ROOT, 'secrets/youtube-token.json'), 'utf8'));
const c = oa.installed ?? oa.web;

const tr = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: c.client_id, client_secret: c.client_secret,
    refresh_token: tk.refresh_token, grant_type: 'refresh_token',
  }),
});
const t = await tr.json();
if (!t.access_token) { console.error(`❌ 토큰 갱신 실패: ${JSON.stringify(t).slice(0, 300)}`); process.exit(1); }
const H = { Authorization: `Bearer ${t.access_token}` };

// 실제로 부여된 스코프. 요청과 부여가 다를 수 있다(사용자가 체크를 뺄 수 있다).
const info = await (await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${t.access_token}`)).json();
console.log(`  [스코프] ${String(info.scope ?? '?').replace(/https:\/\/www.googleapis.com\/auth\//g, '')}`);
if (!String(info.scope ?? '').includes('youtube.readonly')) {
  console.error('❌ readonly 스코프 없음 — 채널 확인 불가. `node scripts/youtube-auth.mjs` 로 재인증하라');
  process.exit(1);
}

const ch = await (await fetch(
  'https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true', { headers: H })).json();
if (!ch.items?.length) { console.error(`❌ 채널 없음: ${JSON.stringify(ch).slice(0, 300)}`); process.exit(1); }
for (const x of ch.items) {
  console.log(`  [채널] ${x.snippet.title}  (${x.id})`);
  console.log(`         영상 ${x.statistics?.videoCount ?? '?'}개 · 구독 ${x.statistics?.subscriberCount ?? '?'}`);
  console.log(`         https://studio.youtube.com/channel/${x.id}/videos/upload`);
}

const ids = process.argv.slice(2);
if (ids.length) {
  const v = await (await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${ids.join(',')}`, { headers: H })).json();
  const found = new Set((v.items ?? []).map((x) => x.id));
  for (const x of v.items ?? []) {
    console.log(`  [영상] ${x.id} · ${x.status.privacyStatus} · ${x.status.uploadStatus} · "${x.snippet.title}"`);
    console.log(`         채널 ${x.snippet.channelTitle} (${x.snippet.channelId})`);
    console.log(`         https://studio.youtube.com/video/${x.id}/edit`);
  }
  for (const id of ids) if (!found.has(id)) console.log(`  [영상] ${id} → ❌ 이 채널에서 조회 안 됨(다른 계정에 있을 수 있다)`);
}
