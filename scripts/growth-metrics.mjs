#!/usr/bin/env node
/**
 * growth-metrics.mjs — 채널 성장 지표 11개를 최근 7일 · 직전 7일 · 28일로 나란히. (2026-10-17 신설)
 *
 * 왜 (사장님 10/17 20:5x, Mac mini2 전달): 노출 클릭률·평균 시청 시간·평균 시청률·초반 잔존·재방문·고유 시청자·
 *   연쇄 시청·최종 화면 클릭률·구독 전환·인당 반복 시청·참여도가 자라는지 보고, 안 되면 원인을 검증해 고친다.
 *   고친 뒤 22:00 보고마다 **같은 잣대로** 전후를 보여야 한다 — 그래서 손으로 재지 않고 스크립트로 남긴다.
 *
 * API 로 되는 것만 잰다. 안 되는 것은 **n/a(스튜디오 전용)** 로 적고 숫자를 지어내지 않는다 (10/17 실측):
 *   uniques · viewerType(재방문) · endScreenElement* · videoThumbnailImpressions(노출 클릭률) → "Unknown identifier"/"not supported".
 *   쇼츠의 '본 비율(스와이프 안 함)' 은 engagedViews/views 로 근사한다 — 같은 값은 아니다(channel-performance.mjs 와 같은 근사).
 *   '저장' 은 API 에 없다. videosAddedToPlaylists(재생목록 추가)를 따로 적는다 — 저장과 같지 않다.
 * 분석 데이터는 하루 이틀 늦다 — 창의 끝은 태평양 날짜로 오늘 −2일.
 *
 *   node scripts/growth-metrics.mjs [--end YYYY-MM-DD] [--out logs/growth-metrics]
 */
import { google } from 'googleapis';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { authorizedClient } from './lib/youtube.mjs';
import { envValue } from './lib/footage.mjs';
import { ROOT } from './lib/project-root.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = resolve(ROOT, arg('--out', 'logs/growth-metrics'));
const auth = await authorizedClient();
const yt = google.youtube({ version: 'v3', auth });
const ya = google.youtubeAnalytics({ version: 'v2', auth });

const DAY = 864e5;
const ptToday = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const END = arg('--end', shift(ptToday, -2));
const WINDOWS = {
  last7: [shift(END, -6), END],
  prev7: [shift(END, -13), shift(END, -7)],
  last28: [shift(END, -27), END],
};

async function q(params) {
  for (let t = 0; ; t++) {
    try { return (await ya.reports.query({ ids: 'channel==MINE', ...params })).data.rows ?? []; }
    catch (e) { if (t >= 2 || !/rate|quota|backend|50\d/i.test(String(e.message))) throw e; await new Promise((r) => setTimeout(r, 2000 * (t + 1))); }
  }
}

// 채널 업로드 — 연쇄 시청(우리 영상에서 온 조회) 판정과 창별 게시 편 잔존 곡선에 쓴다.
const ch = await yt.channels.list({ part: ['contentDetails'], id: [envValue('YOUTUBE_CHANNEL_ID')] });
const uploadsPl = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
const firstStart = WINDOWS.last28[0] < WINDOWS.prev7[0] ? WINDOWS.last28[0] : WINDOWS.prev7[0];
const ownIds = new Set();
const published = [];   // 창 안에 게시된 편
for (let pageToken; ;) {
  const pl = await yt.playlistItems.list({ part: ['contentDetails'], playlistId: uploadsPl, maxResults: 50, pageToken });
  for (const it of pl.data.items ?? []) {
    ownIds.add(it.contentDetails.videoId);
    const d = new Date(Date.parse(it.contentDetails.videoPublishedAt) - 7 * 3600e3).toISOString().slice(0, 10);
    if (d >= firstStart && d <= END) published.push({ id: it.contentDetails.videoId, ptDate: d });
  }
  pageToken = pl.data.nextPageToken;
  if (!pageToken) break;
}
const isoSec = (s) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s ?? '') ?? []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };
for (let i = 0; i < published.length; i += 50) {
  const r = await yt.videos.list({ part: ['contentDetails', 'status'], id: published.slice(i, i + 50).map((v) => v.id) });
  const m = new Map((r.data.items ?? []).map((v) => [v.id, v]));
  for (const v of published.slice(i, i + 50)) {
    const x = m.get(v.id);
    v.durationSec = isoSec(x?.contentDetails?.duration);
    v.public = x?.status?.privacyStatus === 'public';
  }
}

const TYPES = { shorts: 'shorts', long: 'videoOnDemand' };
const BASE = 'views,engagedViews,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares';
// videosAddedToPlaylists 는 creatorContentType 과 같이 못 묻는다("not supported", 10/17 실측) — 채널 전체로 따로 잰다.
const ratio = (a, b, k = 1) => (b ? +(a / b * k).toFixed(3) : null);
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function windowMetrics([start, end]) {
  const rows = await q({ startDate: start, endDate: end, dimensions: 'creatorContentType', metrics: BASE });
  const traffic = await q({ startDate: start, endDate: end, dimensions: 'insightTrafficSourceType,creatorContentType', metrics: 'views' });
  const out = {};
  for (const [name, ct] of Object.entries(TYPES)) {
    const r = rows.find((x) => x[0] === ct);
    const [, views = 0, engaged = 0, avd = null, apv = null, subsG = 0, subsL = 0, likes = 0, comments = 0, shares = 0] = r ?? [];
    // 연쇄 시청 — 추천 영상 유입 중 **우리 영상**에서 온 것 + 채널 페이지 + 최종 화면 + 재생목록.
    let related = 0;
    try {
      const det = await q({ startDate: start, endDate: end, dimensions: 'insightTrafficSourceDetail',
        filters: `insightTrafficSourceType==RELATED_VIDEO;creatorContentType==${ct}`, metrics: 'views', sort: '-views', maxResults: 25 });
      related = det.filter((d) => ownIds.has(d[0])).reduce((s, d) => s + d[1], 0);
    } catch { related = null; }
    const tv = (t) => traffic.filter((x) => x[0] === t && x[1] === ct).reduce((s, x) => s + x[2], 0);
    const chainViews = related == null ? null : related + tv('YT_CHANNEL') + tv('END_SCREEN') + tv('PLAYLIST');
    // 초반 잔존 — 이 창에 게시된 공개 편의 곡선 중앙값(쇼츠 3·10초, 롱폼 30초).
    const vids = published.filter((v) => v.public && v.ptDate >= start && v.ptDate <= end && (name === 'shorts' ? v.durationSec <= 180 : v.durationSec > 180));
    const marks = name === 'shorts' ? [3, 10] : [30];
    const per = {};
    for (const s of marks) per[s] = [];
    for (let i = 0; i < vids.length; i += 5) {
      await Promise.all(vids.slice(i, i + 5).map(async (v) => {
        const curve = await q({ startDate: v.ptDate, endDate: END, filters: `video==${v.id}`, dimensions: 'elapsedVideoTimeRatio', metrics: 'audienceWatchRatio' }).catch(() => []);
        if (!curve.length || !v.durationSec) return;
        for (const s of marks) {
          const x = Math.min(1, s / v.durationSec);
          let best = curve[0];
          for (const c of curve) if (Math.abs(c[0] - x) < Math.abs(best[0] - x)) best = c;
          per[s].push(best[1]);
        }
      }));
    }
    out[name] = {
      views, videosPublished: vids.length,
      '1_ctr_or_viewedRate': name === 'shorts' ? ratio(engaged, views) : 'n/a (Studio)',
      '2_avd_sec': avd, '3_apv_pct': apv,
      '4_retention': Object.fromEntries(marks.map((s) => [`${s}s`, per[s].length ? +median(per[s]).toFixed(3) : null])),
      '5_returning': 'n/a (Studio)', '6_unique': 'n/a (Studio)',
      '7_chain_share': chainViews == null ? null : ratio(chainViews, views),
      '8_endscreen_ctr': name === 'shorts' ? 'n/a (Shorts 에 없음)' : 'n/a (Studio)',
      '9_subs_per_1k': { gained: ratio(subsG, views, 1000), net: ratio(subsG - subsL, views, 1000) },
      '10_views_per_unique': 'n/a (Studio)',
      '11_engagement_per_1k': { likes: ratio(likes, views, 1000), comments: ratio(comments, views, 1000), shares: ratio(shares, views, 1000), saves: 'n/a' },
    };
  }
  const [[plAdds = 0, allViews = 0] = []] = await q({ startDate: start, endDate: end, metrics: 'videosAddedToPlaylists,views' });
  out.channel = { views: allViews, playlistAddsPer1k: ratio(plAdds, allViews, 1000) };
  return out;
}

const result = { at: new Date().toISOString(), end: END, windows: WINDOWS, data: {} };
for (const [k, w] of Object.entries(WINDOWS)) result.data[k] = await windowMetrics(w);
mkdirSync(OUT, { recursive: true });
const file = resolve(OUT, `${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(':', '')}.json`);
writeFileSync(file, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
console.error(`→ ${file}`);
