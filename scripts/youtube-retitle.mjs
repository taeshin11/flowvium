#!/usr/bin/env node
/**
 * youtube-retitle.mjs — 이미 올린 영상의 제목을 바꾼다.
 *
 * 왜 (2026-09-06 사용자 "15시올린거 제목 바꿔 조회수 높은거로"):
 *   브리핑 편은 여러 뉴스를 묶는데, 그중 **어느 것을 제목으로 쓰느냐**가 조회수를 가른다.
 *   순서를 성적으로 정하는 수정을 넣기 전에 나간 편이 있어 약한 뉴스가 제목이 됐다.
 *   이미 조회가 붙은 영상은 내리지 않고 제목만 고친다.
 *
 * ⚠ 브리핑 편은 **첫 화면이 그 첫 뉴스**다. 제목만 바꾸면 제목과 첫 장면이 어긋난다 —
 *   그래서 제목에 그 뉴스가 몇 번째인지 드러나게 쓰는 편이 낫다("…외 3건" 같은 꼬리).
 *
 * 사용: node scripts/youtube-retitle.mjs --id VIDEO_ID --title "새 제목"
 */
import { google } from 'googleapis';
import { authorizedClient } from './lib/youtube.mjs';
import { envValue } from './lib/footage.mjs';

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const id = arg('--id');
const title = arg('--title');
if (!id || !title) { console.error('사용: --id VIDEO_ID --title "새 제목"'); process.exit(2); }
if (title.length > 100) { console.error(`제목이 100자를 넘는다(${title.length}자)`); process.exit(2); }

const yt = google.youtube({ version: 'v3', auth: await authorizedClient() });
const { data } = await yt.videos.list({ part: ['snippet'], id: [id] });
const v = data.items?.[0];
if (!v) { console.error(`영상을 못 찾았다: ${id}`); process.exit(1); }

const want = envValue('YOUTUBE_CHANNEL_ID');
if (want && v.snippet.channelId !== want) {
  console.error(`❌ 다른 채널의 영상이다 (${v.snippet.channelId} ≠ ${want})`);
  process.exit(1);
}
console.log(`이전: ${v.snippet.title}`);
// snippet 을 통째로 보내야 한다 — 일부만 보내면 나머지 필드가 지워진다.
await yt.videos.update({
  part: ['snippet'],
  requestBody: { id, snippet: { ...v.snippet, title } },
});
console.log(`이후: ${title}`);
console.log(`✅ https://youtu.be/${id}`);
