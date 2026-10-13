#!/usr/bin/env node
/**
 * channel-performance.mjs — 편마다 성적을 같은 잣대로 모아 표로 남긴다. (2026-10-13 신설)
 *
 * 왜 (사장님 10/13 "분석 없이 올리지 말 것"): 상위·하위 편을 나란히 놓고 원인을 찾고,
 *   바꾼 뒤 48시간 지나 **같은 지표**로 효과를 본다. 그러려면 지표를 매번 같은 방식으로 재야 한다.
 *
 * 무엇을 재나 (YouTube Analytics API, yt-analytics.readonly):
 *   - 첫 3일(태평양 날짜로 게시일~+2일) 조회수·참여 조회수·평균 시청 시간·평균 시청 비율·구독 증가.
 *     나이를 맞춘다 — 28일 된 편과 3일 된 편의 누적 조회수는 영상이 아니라 나이 차이다.
 *   - 본 비율 = engagedViews / views. 쇼츠의 views 는 재생 시작, engagedViews 는 처음 몇 초를 넘긴 시청이라
 *     스튜디오의 '본 비율(스와이프 안 함)'에 가장 가까운 API 값이다. **같은 값은 아니다** — 표에 그렇게 적는다.
 *   - 유입 경로(창 전체), 시청 지속 곡선(100칸)에서 3초 시점 잔존·가장 크게 빠지는 지점.
 *   - 노출 클릭률은 API 가 주지 않는다("query is not supported", 10/13 실측). 스튜디오에서만 보인다 → 빈칸(모름).
 *   분석 데이터는 하루 이틀 늦게 찬다 — 게시 후 72시간 안 된 편은 뺀다.
 *
 *   node scripts/channel-performance.mjs [--days 28] [--min-age-h 72] [--out logs/channel-performance]
 */
import { google } from 'googleapis';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { authorizedClient } from './lib/youtube.mjs';
import { envValue } from './lib/footage.mjs';
import { openDb } from './lib/db.mjs';
import { ROOT } from './lib/project-root.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('--days', 28));
const MIN_AGE_H = Number(arg('--min-age-h', 72));
const OUT = resolve(ROOT, arg('--out', 'logs/channel-performance'));

const auth = await authorizedClient();
const yt = google.youtube({ version: 'v3', auth });
const ya = google.youtubeAnalytics({ version: 'v2', auth });

const now = Date.now();
const since = new Date(now - DAYS * 864e5).toISOString();
const ptDate = (iso, plusDays = 0) => new Date(Date.parse(iso) - 7 * 3600e3 + plusDays * 864e5).toISOString().slice(0, 10);
const today = new Date(now - 7 * 3600e3).toISOString().slice(0, 10);

// ── 대상: 채널 업로드 목록(공개만) + 쇼츠 대장의 속성 ──
const ch = await yt.channels.list({ part: ['contentDetails'], id: [envValue('YOUTUBE_CHANNEL_ID')] });
const uploads = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
const ids = [];
for (let pageToken; ;) {
  const pl = await yt.playlistItems.list({ part: ['contentDetails'], playlistId: uploads, maxResults: 50, pageToken });
  const items = pl.data.items ?? [];
  for (const it of items) if (it.contentDetails.videoPublishedAt >= since) ids.push(it.contentDetails.videoId);
  pageToken = pl.data.nextPageToken;
  if (!pageToken || items.some((it) => it.contentDetails.videoPublishedAt < since)) break;
}
const isoSec = (d) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d ?? '') ?? []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };
const videos = [];
for (let i = 0; i < ids.length; i += 50) {
  const r = await yt.videos.list({ part: ['snippet', 'status', 'contentDetails'], id: ids.slice(i, i + 50) });
  for (const v of r.data.items ?? []) {
    if (v.status.privacyStatus !== 'public') continue;
    const ageH = (now - Date.parse(v.snippet.publishedAt)) / 3600e3;
    if (ageH < MIN_AGE_H) continue;
    videos.push({ id: v.id, publishedAt: v.snippet.publishedAt, title: v.snippet.title, durationSec: isoSec(v.contentDetails.duration), ageH: Math.round(ageH) });
  }
}
const db = openDb();
const attr = db.prepare(`SELECT topic, title_style, opener, layout, sub_cta, promo, explore, trend, duration_sec, hooks_json, headline
  FROM shorts_published WHERE video_id = ?`);

// ── 편마다 지표 ──
async function q(params) {
  for (let t = 0; ; t++) {
    try { return (await ya.reports.query({ ids: 'channel==MINE', ...params })).data.rows ?? []; }
    catch (e) { if (t >= 2 || !/rate|quota|backend|50\d/i.test(String(e.message))) throw e; await new Promise((r) => setTimeout(r, 2000 * (t + 1))); }
  }
}
async function measure(v) {
  const end3 = ptDate(v.publishedAt, 2) < today ? ptDate(v.publishedAt, 2) : today;
  const [m] = await q({ startDate: ptDate(v.publishedAt), endDate: end3, filters: `video==${v.id}`, dimensions: 'video',
    metrics: 'views,engagedViews,averageViewDuration,averageViewPercentage,subscribersGained,likes,shares' });
  const traffic = await q({ startDate: ptDate(v.publishedAt), endDate: today, filters: `video==${v.id}`, dimensions: 'insightTrafficSourceType', metrics: 'views' });
  const curve = await q({ startDate: ptDate(v.publishedAt), endDate: today, filters: `video==${v.id}`, dimensions: 'elapsedVideoTimeRatio', metrics: 'audienceWatchRatio' });
  const [, views = 0, engaged = 0, avgSec = null, avgPct = null, subs = 0, likes = 0, shares = 0] = m ?? [];
  const tv = traffic.reduce((s, r) => s + r[1], 0) || 1;
  const trafficShare = Object.fromEntries(traffic.filter((r) => r[1] > 0).map((r) => [r[0], +(r[1] / tv).toFixed(3)]));
  // 3초 시점 잔존 — 곡선은 영상 길이 비율 100칸이다.
  const at = (sec) => { if (!curve.length || !v.durationSec) return null; const x = Math.min(1, sec / v.durationSec); let best = curve[0]; for (const c of curve) if (Math.abs(c[0] - x) < Math.abs(best[0] - x)) best = c; return +best[1].toFixed(3); };
  let drop = null;   // 가장 크게 빠지는 칸(초) — 맨 앞 1칸(재생 시작 직후)은 빼고, 끝 5% 도 뺀다(끝은 다 빠진다)
  for (let i = 2; i < curve.length && curve[i][0] <= 0.95; i++) {
    const d = curve[i - 1][1] - curve[i][1];
    if (!drop || d > drop.d) drop = { d, sec: +(curve[i][0] * v.durationSec).toFixed(1) };
  }
  const a = attr.get(v.id);
  return {
    ...v, kind: v.durationSec <= 180 && a ? 'short' : v.durationSec <= 180 ? 'short-other' : 'long',
    views3d: views, engaged3d: engaged, viewedRate: views ? +(engaged / views).toFixed(3) : null,
    avgViewSec: avgSec, avgViewPct: avgPct, subs3d: subs, subsPer1k: views ? +(subs / views * 1000).toFixed(2) : null,
    likes3d: likes, shares3d: shares, retain3s: at(3), dropAtSec: drop?.sec ?? null, traffic: trafficShare,
    ctr: null,   // API 미제공 — 스튜디오에서만
    ...(a ? { topic: a.topic, titleStyle: a.title_style, opener: a.opener, layout: a.layout, subCta: a.sub_cta, promo: a.promo,
      explore: a.explore, trend: a.trend, hook1: (() => { try { return JSON.parse(a.hooks_json ?? '[]')[0] ?? null; } catch { return null; } })(), headline: a.headline } : {}),
  };
}
const rows = [];
for (let i = 0; i < videos.length; i += 4) rows.push(...await Promise.all(videos.slice(i, i + 4).map(measure)));
rows.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));

// 같은 날(한국 날짜) 또래 대비 백분위 — 날짜(배분) 효과를 뺀다. analyze-shorts-views.mjs 와 같은 생각.
const kst = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const shorts = rows.filter((r) => r.kind === 'short');
const byDay = Map.groupBy ? Map.groupBy(shorts, (r) => kst(r.publishedAt)) : new Map();
for (const [, g] of byDay) {
  const s = [...g].sort((a, b) => a.views3d - b.views3d);
  s.forEach((r, i) => { r.dayPct = g.length > 1 ? +(i / (g.length - 1)).toFixed(2) : null; });
}

mkdirSync(OUT, { recursive: true });
const stamp = new Date(now + 9 * 3600e3).toISOString().slice(0, 16).replace(':', '');
const file = resolve(OUT, `${stamp}.json`);
writeFileSync(file, JSON.stringify({ at: new Date(now).toISOString(), days: DAYS, minAgeH: MIN_AGE_H, rows }, null, 1));
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
console.log(`편 ${rows.length} (쇼츠 ${shorts.length} · 롱폼 ${rows.filter((r) => r.kind === 'long').length}) → ${file}`);
console.log(`쇼츠 중앙값: 3일 조회 ${med(shorts.map((r) => r.views3d))} · 본 비율 ${med(shorts.map((r) => r.viewedRate))} · 평균 시청 ${med(shorts.map((r) => r.avgViewPct))}% · 1천회당 구독 ${med(shorts.map((r) => r.subsPer1k))} · 3초 잔존 ${med(shorts.map((r) => r.retain3s))}`);
