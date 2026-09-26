#!/usr/bin/env node
/**
 * youtube-stats.mjs — 올린 영상의 실제 성적을 가져온다.
 *
 * 왜 (2026-09-06 사용자 "조회수 안나오는 주제들은 하지마"):
 *   무엇이 통했는지 말하려면 숫자가 있어야 한다. 지금까지는 발행만 기록하고
 *   성적은 한 번도 되읽지 않았다 — 그러면 "어떤 주제가 낫다" 는 말은 전부 짐작이다.
 */
import { google } from 'googleapis';
import { authorizedClient } from './lib/youtube.mjs';
import { envValue } from './lib/footage.mjs';

const auth = await authorizedClient();
const yt = google.youtube({ version: 'v3', auth });
const channelId = envValue('YOUTUBE_CHANNEL_ID');

// 채널의 업로드 재생목록에서 최근 영상을 모은다.
const ch = await yt.channels.list({ part: ['contentDetails', 'statistics'], id: [channelId] });
const uploads = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
const st = ch.data.items?.[0]?.statistics ?? {};
console.log(`채널: 구독 ${st.subscriberCount ?? '?'} · 총 조회 ${st.viewCount ?? '?'} · 영상 ${st.videoCount ?? '?'}`);
if (!uploads) { console.error('업로드 재생목록을 못 찾음'); process.exit(1); }

const pl = await yt.playlistItems.list({ part: ['contentDetails'], playlistId: uploads, maxResults: 50 });
const ids = (pl.data.items ?? []).map((x) => x.contentDetails.videoId);
if (!ids.length) { console.log('영상 없음'); process.exit(0); }

const vs = await yt.videos.list({ part: ['snippet', 'statistics', 'status'], id: ids });
const rows = (vs.data.items ?? []).map((v) => ({
  id: v.id,
  title: v.snippet.title,
  at: v.snippet.publishedAt,
  views: Number(v.statistics?.viewCount ?? 0),
  likes: Number(v.statistics?.likeCount ?? 0),
  privacy: v.status?.privacyStatus,
})).sort((a, b) => b.at.localeCompare(a.at));

const hours = (iso) => (Date.now() - Date.parse(iso)) / 3600000;
console.log('\n공개  조회  좋아요  경과   제목');
for (const r of rows) {
  console.log(`${(r.privacy === 'public' ? '공개' : '비공개').padEnd(4)} ${String(r.views).padStart(5)} ${String(r.likes).padStart(6)}  ${hours(r.at).toFixed(1).padStart(5)}h  ${r.title.slice(0, 46)}`);
}

// 영상별 구독 유입. videos.list 로는 안 나오고 분석 API 로만 나온다.
//   2026-09-18 실측: 소재별로 조회수는 거의 안 갈리는데 구독은 크게 갈린다(정치갈등 5.4/1000 vs 다수 0).
//   편성이 그걸 보려면 DB 에 있어야 한다. 실패해도 나머지 기록은 그대로 남긴다.
const subsById = new Map();
// 2026-09-26: 같은 요청에 engagedViews·views·averageViewPercentage 를 더한다 — 쇼츠 조회수 천장의 손잡이는
//   '첫 순간 안 넘기고 본 비율'(engaged)이다(9/1~9/26 156편: 조회수와 상관 0.56, 시청% 0.05, 길이 -0.10).
const engById = new Map();
try {
  const ya = google.youtubeAnalytics({ version: 'v2', auth: authorizedClient() });
  const endD = new Date().toISOString().slice(0, 10);
  const startD = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const a = await ya.reports.query({
    ids: 'channel==MINE', startDate: startD, endDate: endD,
    metrics: 'subscribersGained,views,engagedViews,averageViewPercentage', dimensions: 'video', sort: '-subscribersGained', maxResults: 200,
  });
  const { parseAnalyticsRows } = await import('./lib/yt-analytics-parse.mjs');
  for (const [id, v] of parseAnalyticsRows(a.data.columnHeaders, a.data.rows)) {
    if (v.subs != null) subsById.set(id, v.subs);
    engById.set(id, v);
  }
  console.log(`\n구독 유입: ${subsById.size}편분 수집`);
} catch (e) { console.log(`\n구독 유입 수집 실패(기록은 계속): ${String(e.message).slice(0, 80)}`); }

// 볼 때마다 저장한다. 조회수는 시간이 지나며 오르므로 한 시점만 봐서는 판단할 수 없다.
{
  const { recordShortsStats } = await import('./lib/db.mjs');
  const n = recordShortsStats(rows.map((r) => ({ id: r.id, views: r.views, likes: r.likes, ageHours: hours(r.at), title: r.title, privacy: r.privacy, subs: subsById.get(r.id),
    engagedRatio: engById.get(r.id)?.engagedRatio ?? null, avgViewPct: engById.get(r.id)?.avgViewPct ?? null })));
  console.log(`\n성적 ${n}건 기록`);
}

// 편성 원장과 맞춰 주제별로 묶는다.
const { openDb } = await import('./lib/db.mjs');
const db = openDb();
const led = db.prepare('SELECT issue_key, video_id FROM shorts_published WHERE video_id IS NOT NULL').all();
const byId = new Map(led.map((x) => [x.video_id, x.issue_key]));
const live = rows.filter((r) => r.privacy === 'public' && byId.has(r.id));
if (live.length) {
  console.log('\n주제별(공개분):');
  for (const r of live) console.log(`  ${String(byId.get(r.id)).padEnd(10)} ${String(r.views).padStart(4)}회 · ${hours(r.at).toFixed(1)}h`);
}
