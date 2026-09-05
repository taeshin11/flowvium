#!/usr/bin/env node
/**
 * youtube-link-ledger.mjs — 옛 발행분에 video_id 를 채운다.
 *
 * 왜 (2026-09-06): 편성 원장의 video_id 는 어제 낮에야 기록하기 시작했다. 그 전 편들은
 *   비어 있어 **성적과 이어지지 않는다** — 반응률로 주제를 고르려는데 정작 옛 편들이 빠진다.
 *   유튜브 제목과 원장 헤드라인을 맞춰 채운다. 제목은 헤드라인을 잘라 만든 것이라 앞부분이 겹친다.
 */
import { google } from 'googleapis';
import { authorizedClient } from './lib/youtube.mjs';
import { envValue } from './lib/footage.mjs';

const auth = await authorizedClient();
const yt = google.youtube({ version: 'v3', auth });
const ch = await yt.channels.list({ part: ['contentDetails'], id: [envValue('YOUTUBE_CHANNEL_ID')] });
const uploads = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
const pl = await yt.playlistItems.list({ part: ['contentDetails', 'snippet'], playlistId: uploads, maxResults: 50 });
const vids = (pl.data.items ?? []).map((x) => ({
  id: x.contentDetails.videoId,
  title: String(x.snippet.title ?? '').replace(/\s*#Shorts\s*$/i, '').trim(),
}));

const { openDb } = await import('./lib/db.mjs');
const db = openDb();
const rows = db.prepare('SELECT id, issue_key, headline, video_id FROM shorts_published').all();

/** 제목은 헤드라인을 자른 것이다 — 앞부분 낱말이 얼마나 겹치는지로 맞춘다. */
const toks = (t) => String(t ?? '').split(/[^가-힣A-Za-z0-9]+/).filter((w) => w.length >= 2).slice(0, 8);
const score = (a, b) => {
  const A = new Set(toks(a)); const B = new Set(toks(b));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit += 1;
  return hit / Math.min(A.size, B.size);
};

const taken = new Set(rows.map((r) => r.video_id).filter(Boolean));
let filled = 0;
for (const r of rows) {
  if (r.video_id) continue;
  let best = null; let bs = 0;
  for (const v of vids) {
    if (taken.has(v.id)) continue;
    const s = score(r.headline, v.title);
    if (s > bs) { bs = s; best = v; }
  }
  if (best && bs >= 0.6) {
    // 2026-09-06: 처음에 `WHERE rowid = ?` 를 썼는데 `SELECT rowid` 가 그 필드를 안 돌려줘
    //   (id 가 rowid 의 별칭이라 합쳐진다) 조용히 0건이 바뀌었다. 그런데 나는 **내 루프 카운터**로
    //   "4건 채움" 이라고 보고했다 — DB 가 실제로 바꾼 수를 봐야 한다.
    const changed = db.prepare('UPDATE shorts_published SET video_id = ? WHERE id = ?').run(best.id, r.id).changes;
    if (!changed) { console.log(`  ${r.issue_key.padEnd(10)} → UPDATE 가 0건 (id=${r.id})`); continue; }
    taken.add(best.id);
    filled += changed;
    console.log(`  ${r.issue_key.padEnd(10)} → ${best.id}  (일치도 ${(bs * 100).toFixed(0)}%) ${best.title.slice(0, 34)}`);
  } else {
    console.log(`  ${r.issue_key.padEnd(10)} → 못 찾음 (최고 일치도 ${(bs * 100).toFixed(0)}%)`);
  }
}
console.log(`\n${filled}건 채움`);
// 같은 프로세스에서 되읽어 확인한다 — 썼다고 말하기 전에 남았는지 본다.
const after = db.prepare('SELECT COUNT(*) n FROM shorts_published WHERE video_id IS NOT NULL').get().n;
console.log(`확인: 원장에 video_id 있는 행 ${after}건`);
