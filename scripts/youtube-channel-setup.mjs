#!/usr/bin/env node
/**
 * youtube-channel-setup.mjs — 채널 페이지 정리(구독 유도). (2026-09-27 신설)
 *
 * 사장님 "구독자 올릴수있는건 다 해봐 웹검색, 레퍼런스 검색 다 해봐".
 *   ① 비구독자 트레일러: 최근 30일 중 **구독 전환이 가장 높은** 쇼츠로(조회 500+). 비어 있었다.
 *      구독 전환 실측: 전체 0.88/1k, 국내정치 1.58/1k — 최상위는 정치 갈등 편(7/1,108).
 *   ② 주제 재생목록: 최근 30편을 주제별로 넣는다(이미 들어 있으면 건너뛴다). 재생목록이 0개였다.
 * channels.update(brandingSettings) 는 **통째로 바꾼다** — 기존 설명·키워드를 다시 실어 보내야 지워지지 않는다.
 *
 * 사용: node scripts/youtube-channel-setup.mjs [--dry] [--limit 30]
 */
import { google } from 'googleapis';
import { authorizedClient } from './lib/youtube.mjs';
import { playlistTitleFor, ensureTopicPlaylist, youtubePlaylistApi } from './lib/yt-playlists.mjs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const LIMIT = Number(argv[argv.indexOf('--limit') + 1]) || 30;
const auth = authorizedClient();
const yt = google.youtube({ version: 'v3', auth });
const ya = google.youtubeAnalytics({ version: 'v2', auth });

// ① 트레일러
{
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const a = await ya.reports.query({ ids: 'channel==MINE', startDate: start, endDate: end,
    metrics: 'views,subscribersGained', dimensions: 'video', sort: '-subscribersGained', maxResults: 50 });
  const best = (a.data.rows ?? []).map(([id, v, s]) => ({ id, v: Number(v), s: Number(s) }))
    .filter((x) => x.v >= 500).sort((p, q) => q.s / q.v - p.s / p.v)[0];
  if (!best) console.log('트레일러: 조건에 맞는 영상 없음');
  else {
    const ch = (await yt.channels.list({ part: ['brandingSettings'], mine: true })).data.items[0];
    const bs = ch.brandingSettings;
    console.log(`트레일러 후보 ${best.id} — 구독 ${best.s} / 조회 ${best.v} (${(best.s / best.v * 1000).toFixed(1)}/1k) · 지금 ${bs.channel.unsubscribedTrailer ?? '(없음)'}`);
    if (!DRY && bs.channel.unsubscribedTrailer !== best.id) {
      bs.channel.unsubscribedTrailer = best.id;
      await yt.channels.update({ part: ['brandingSettings'], requestBody: { id: ch.id, brandingSettings: bs } });
      const after = (await yt.channels.list({ part: ['brandingSettings'], mine: true })).data.items[0].brandingSettings.channel;
      console.log(`  → 트레일러 ${after.unsubscribedTrailer} · 설명 ${after.description ? `${after.description.length}자 그대로` : '⚠ 비었다'} · 키워드 ${after.keywords ? '그대로' : '⚠ 비었다'}`);
    }
  }
}

// ② 주제 재생목록 채우기
{
  const { openDb } = await import('./lib/db.mjs');
  const rows = openDb().prepare(`SELECT video_id, topic FROM shorts_published
    WHERE video_id IS NOT NULL AND topic IS NOT NULL AND retracted_at IS NULL ORDER BY published_at DESC LIMIT ?`).all(LIMIT);
  const api = youtubePlaylistApi();
  const present = new Map();   // playlistId → Set(videoId)
  let added = 0, skipped = 0;
  for (const r of rows) {
    const title = playlistTitleFor(r.topic);
    if (DRY) { console.log(`  [dry] ${r.video_id} → ${title}`); continue; }
    const pid = await ensureTopicPlaylist(api, title);
    if (!present.has(pid)) {
      const items = [];
      let pageToken;
      try {
        do {
          const p = await yt.playlistItems.list({ part: ['snippet'], playlistId: pid, maxResults: 50, pageToken });
          items.push(...(p.data.items ?? []).map((i) => i.snippet.resourceId.videoId));
          pageToken = p.data.nextPageToken;
        } while (pageToken);
      } catch (e) {
        // 방금 만든 재생목록은 잠깐 동안 목록 조회에서 playlistNotFound 가 난다(2026-09-27 실측). 새 목록은 비어 있다.
        if (!/playlistNotFound|cannot be found/i.test(String(e?.message))) throw e;
      }
      present.set(pid, new Set(items));
    }
    if (present.get(pid).has(r.video_id)) { skipped++; continue; }
    await api.add(pid, r.video_id);
    present.get(pid).add(r.video_id);
    added++;
  }
  console.log(`재생목록: ${rows.length}편 중 추가 ${added} · 이미 있음 ${skipped}${DRY ? ' (dry)' : ''}`);
  const lists = await api.list();
  for (const l of lists) console.log(`  · ${l.title} (${l.id})`);
}
