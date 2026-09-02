#!/usr/bin/env node
/**
 * youtube-cleanup.mjs — 채널의 옛 영상을 목록으로 보고, 지정한 것만 지운다.
 *
 * 왜 만들었나 (2026-09-03, 사용자 "같은 채널에 한국어로 전환. 영어 영상들 다 내리고"):
 *   채널을 한국어로 돌리면서 기존 영어 영상을 정리한다. 사용자가 비공개가 아니라
 *   **완전 삭제**를 선택했다 — 되돌릴 수 없으므로 두 단계로 나눈다.
 *
 * 안전장치:
 *   · 기본은 **목록만** 보여준다. --confirm 없이는 아무것도 지우지 않는다.
 *   · .env.local 의 YOUTUBE_CHANNEL_ID 와 일치하는 채널만 건드린다 —
 *     계정에 채널이 여럿이면 엉뚱한 채널을 지울 수 있다.
 *   · 지우기 전에 제목·업로드일·영상ID 를 로그에 남긴다. 지운 뒤에는 확인할 방법이 없다.
 *
 * 사용:
 *   node scripts/youtube-cleanup.mjs                 # 목록만
 *   node scripts/youtube-cleanup.mjs --confirm       # 전부 삭제
 *   node scripts/youtube-cleanup.mjs --confirm --keep=ID1,ID2
 *   node scripts/youtube-cleanup.mjs --confirm --before=2026-09-03   # 그 이전 업로드만
 */
import { google } from 'googleapis';
import { authorizedClient } from './lib/youtube.mjs';
import { loadEnvLocal } from './lib/llm-config.mjs';

loadEnvLocal();

const argv = process.argv.slice(2);
const BOOL = ['--confirm'];
const VALUE = ['--keep', '--before', '--channel'];
const arg = (f, d) => {
  const eq = argv.find((a) => a.startsWith(`${f}=`));
  if (eq) return eq.slice(f.length + 1);
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const name = a.split('=')[0];
  if (BOOL.includes(name) || VALUE.includes(name)) { if (VALUE.includes(name) && !a.includes('=')) i++; continue; }
  console.error(`알 수 없는 인자: ${a}\n  쓸 수 있는 것: ${[...BOOL, ...VALUE.map((f) => `${f}=…`)].join(' ')}`);
  process.exit(2);
}

const CONFIRM = argv.includes('--confirm');
const KEEP = new Set((arg('--keep', '') || '').split(',').filter(Boolean));
const BEFORE = arg('--before', '');
const WANT_CHANNEL = arg('--channel', process.env.YOUTUBE_CHANNEL_ID || '');
const log = (m) => console.log(`[yt-cleanup] ${m}`);

const auth = authorizedClient();
const yt = google.youtube({ version: 'v3', auth });

// ── 채널 확인. 계정에 채널이 여럿일 수 있으므로 의도한 채널인지 먼저 맞춘다.
const ch = await yt.channels.list({ part: ['snippet', 'contentDetails', 'statistics'], mine: true });
const me = ch.data.items?.[0];
if (!me) { log('❌ 채널을 못 찾았다'); process.exit(1); }
log(`채널: ${me.snippet?.title} (${me.id}) · 영상 ${me.statistics?.videoCount}개 · 구독자 ${me.statistics?.subscriberCount}명`);
if (WANT_CHANNEL && me.id !== WANT_CHANNEL) {
  log(`❌ 의도한 채널이 아니다 — 기대 ${WANT_CHANNEL}, 실제 ${me.id}. 아무것도 하지 않는다.`);
  process.exit(1);
}

// ── 업로드 목록 (uploads 재생목록을 훑는다)
const uploads = me.contentDetails?.relatedPlaylists?.uploads;
if (!uploads) { log('❌ uploads 재생목록이 없다'); process.exit(1); }
const items = [];
let pageToken;
do {
  const r = await yt.playlistItems.list({ part: ['snippet', 'contentDetails'], playlistId: uploads, maxResults: 50, pageToken });
  for (const it of r.data.items ?? []) {
    items.push({
      id: it.contentDetails?.videoId,
      title: it.snippet?.title ?? '(제목 없음)',
      at: it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt ?? '',
    });
  }
  pageToken = r.data.nextPageToken ?? undefined;
} while (pageToken);

const targets = items.filter((v) => !KEEP.has(v.id) && (!BEFORE || String(v.at).slice(0, 10) < BEFORE));
log(`업로드 ${items.length}개 · 대상 ${targets.length}개${KEEP.size ? ` (보존 ${KEEP.size})` : ''}${BEFORE ? ` (${BEFORE} 이전)` : ''}\n`);
for (const v of items) {
  const mark = targets.includes(v) ? '🗑' : '  ';
  console.log(`  ${mark} ${v.id}  ${String(v.at).slice(0, 10)}  ${v.title.slice(0, 62)}`);
}

if (!CONFIRM) {
  log('\n목록만 보여줬다. 실제로 지우려면 --confirm 을 붙여라. **삭제는 되돌릴 수 없다.**');
  process.exit(0);
}
if (!targets.length) { log('\n지울 것이 없다.'); process.exit(0); }

log(`\n삭제 시작 — ${targets.length}개. 이 목록은 지운 뒤에는 확인할 수 없으므로 위 로그를 남겨 둔다.`);
let done = 0, failed = 0;
for (const v of targets) {
  try {
    await yt.videos.delete({ id: v.id });
    done++;
    log(`  ✅ 삭제 ${v.id}  ${v.title.slice(0, 50)}`);
  } catch (e) {
    failed++;
    log(`  ❌ 실패 ${v.id} — ${String(e?.message ?? e).slice(0, 100)}`);
  }
}
log(`\n삭제 ${done} · 실패 ${failed}`);
process.exit(failed ? 1 : 0);
