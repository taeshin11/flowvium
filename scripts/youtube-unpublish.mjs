#!/usr/bin/env node
/**
 * youtube-unpublish.mjs — 잘못 나간 영상을 **비공개**로 돌린다.
 *
 * 왜 삭제가 아닌가 (2026-09-05): 지금까지 잘못 나간 편을 내릴 때마다 손으로 스튜디오를 열었다.
 *   삭제는 되돌릴 수 없고, 무엇이 왜 나갔는지 확인할 길도 없어진다. 비공개면 남는다.
 *   지우는 판단은 사람이 나중에 해도 된다 — 급한 것은 **시청자에게서 치우는 것**이다.
 *
 * 사용: node scripts/youtube-unpublish.mjs --id VIDEO_ID [--reason "왜"]
 */
import { google } from 'googleapis';
import { authorizedClient } from './lib/youtube.mjs';
import { envValue } from './lib/footage.mjs';

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const id = arg('--id');
if (!id) { console.error('사용: --id VIDEO_ID [--reason "..."]'); process.exit(2); }

const auth = await authorizedClient();
const yt = google.youtube({ version: 'v3', auth });

const { data } = await yt.videos.list({ part: ['snippet', 'status'], id: [id] });
const v = data.items?.[0];
if (!v) { console.error(`❌ 영상을 못 찾았다: ${id}`); process.exit(1); }

// 의도한 채널인지 확인한다 — 계정에 채널이 여럿이면 엉뚱한 영상을 건드릴 수 있다.
const want = envValue('YOUTUBE_CHANNEL_ID');
if (want && v.snippet.channelId !== want) {
  console.error(`❌ 다른 채널의 영상이다 (${v.snippet.channelId} ≠ ${want})`);
  process.exit(1);
}
console.log(`대상: ${v.snippet.title}`);
console.log(`현재: ${v.status.privacyStatus} · 업로드 ${v.snippet.publishedAt}`);
if (v.status.privacyStatus === 'private') { console.log('이미 비공개다 — 할 일 없음'); process.exit(0); }

await yt.videos.update({
  part: ['status'],
  requestBody: { id, status: { privacyStatus: 'private' } },
});
console.log(`✅ 비공개로 전환: https://youtu.be/${id}`);
const why = arg('--reason');
if (why) console.log(`   사유: ${why}`);
