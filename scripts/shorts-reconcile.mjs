#!/usr/bin/env node
/**
 * shorts-reconcile.mjs — 유튜브에 올라간 쇼츠와 편성 원장을 맞춘다.
 *
 * 왜 (2026-09-10): 원장 기록이 실패해도 발행은 계속된다. markShortsPublished 는 try/catch 안에
 *   있고 "⚠ 편성 대장 기록 실패" 를 로그에 찍고 넘어간다 — 업로드를 되돌릴 이유는 없으니 옳다.
 *   그런데 **아무도 그 로그를 안 봤다.** 오늘 3편이 올라갔는데 원장은 0편이었고,
 *   원장이 비어 중복 방지가 꺼지면서 09:22 와 10:18 에 **같은 영상이 두 번** 나갔다.
 *   (직접 원인은 openDb() 싱글턴을 close() 한 것. 그건 따로 고쳤다.)
 *
 * 기록은 실패할 수 있다. 실패가 **누적되지 않게** 하는 것이 이 스크립트다.
 *   유튜브를 사실의 기준으로 삼아 원장에 없는 편을 채운다. 발행은 하지 않는다.
 *
 * issue_key 는 복원할 수 없다(발행 당시 keyword 를 유튜브가 모른다). 제목으로 채운다 —
 *   중복 방지의 주 경로는 headline 대조라 이것으로 충분하다. 정확한 keyword 가 필요한
 *   topDistinctIssues 제외는 다음 회차부터 정상 기록되며 복구된다.
 *
 * 사용: node scripts/shorts-reconcile.mjs [--hours 48] [--yes]
 */
import { google } from 'googleapis';
import { authorizedClient } from './lib/youtube.mjs';
import { openDb } from './lib/db.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const HOURS = Number(arg('--hours', 48));
const YES = process.argv.includes('--yes');

const yt = google.youtube({ version: 'v3', auth: await authorizedClient() });
const ch = await yt.channels.list({ part: ['contentDetails'], mine: true });
const uploads = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
if (!uploads) { console.error('❌ 업로드 재생목록을 못 찾았다'); process.exit(1); }

const since = Date.now() - HOURS * 3600000;
const items = [];
let pageToken;
do {
  const r = await yt.playlistItems.list({ part: ['snippet'], playlistId: uploads, maxResults: 50, pageToken });
  for (const i of r.data.items ?? []) {
    if (Date.parse(i.snippet.publishedAt) < since) { pageToken = null; break; }
    items.push({ id: i.snippet.resourceId.videoId, at: i.snippet.publishedAt, title: i.snippet.title });
  }
  pageToken = pageToken === null ? null : r.data.nextPageToken;
} while (pageToken);

const db = openDb();
const known = new Set(db.prepare('SELECT video_id FROM shorts_published WHERE video_id IS NOT NULL').all().map((r) => r.video_id));
const missing = items.filter((x) => !known.has(x.id));

// 같은 제목이 여러 번 올라갔는지도 알린다 — 원장이 비면 중복 발행이 난다.
const byTitle = new Map();
for (const x of items) byTitle.set(x.title, [...(byTitle.get(x.title) ?? []), x.id]);
const dups = [...byTitle.entries()].filter(([, ids]) => ids.length > 1);

console.log(`유튜브 ${HOURS}시간 ${items.length}편 · 원장에 없는 편 ${missing.length}편`);
for (const x of missing) {
  const t = new Date(Date.parse(x.at) + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
  console.log(`  · ${t}  ${x.id}  ${x.title.slice(0, 34)}`);
}
for (const [title, ids] of dups) console.log(`  ⚠ 같은 제목 ${ids.length}편: ${ids.join(' ')} — ${title.slice(0, 34)}`);

if (!missing.length) { console.log('맞춰져 있다'); process.exit(dups.length ? 1 : 0); }
if (!YES) { console.log('\n실제로 채우려면 --yes'); process.exit(1); }

// 제목에서 발행기가 붙인 장식을 걷어낸다 — 원장의 headline 은 기사 제목이어야 대조가 된다.
const clean = (t) => String(t).replace(/#\S+/g, '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
const ins = db.prepare(
  `INSERT INTO shorts_published (issue_key, headline, video_id, published_at) VALUES (?, ?, ?, ?)`,
);
let n = 0;
for (const x of missing) { ins.run(clean(x.title).slice(0, 300), clean(x.title).slice(0, 300), x.id, x.at); n += 1; }
console.log(`✅ ${n}편을 원장에 채웠다`);
process.exit(dups.length ? 1 : 0);
