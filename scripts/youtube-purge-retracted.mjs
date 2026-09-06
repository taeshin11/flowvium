#!/usr/bin/env node
/**
 * youtube-purge-retracted.mjs — **내린(비공개) 회차를 완전히 지운다.**
 *
 * 왜 (2026-09-07 사용자 승인): 2026-09-06 하루에 29편을 올리고 14편을 내렸다.
 *   비공개라도 채널에는 남아 "올렸다 내린 이력" 으로 보인다.
 *   같은 날 유튜브가 한 편(TxKl9GsCreQ)을 직접 삭제했다 — 이미 눈에 띈 상태다.
 *
 * 안전장치:
 *   · 편성 원장에서 **retracted_at 이 있는 것만** 고른다. 게시 중인 편은 절대 건드리지 않는다.
 *   · 지우기 전에 유튜브에서 **실제 공개 상태를 다시 읽어** private 인지 확인한다.
 *     원장이 틀렸을 수 있다 — 지우는 일은 되돌릴 수 없으므로 두 번 본다.
 *   · --dry-run 이 기본. 실제로 지우려면 --yes 를 준다.
 */
import { google } from 'googleapis';
import { authorizedClient } from './lib/youtube.mjs';
import { openDb } from './lib/db.mjs';

const YES = process.argv.includes('--yes');
const HOURS = Number((process.argv.find((a) => a.startsWith('--hours=')) ?? '--hours=48').split('=')[1]);

const db = openDb();
const rows = db.prepare(
  `SELECT video_id, headline FROM shorts_published
    WHERE retracted_at IS NOT NULL AND video_id IS NOT NULL
      AND published_at >= datetime('now', ?)`,
).all(`-${HOURS} hours`);
db.close();
if (!rows.length) { console.log('내린 회차가 없다'); process.exit(0); }

const yt = google.youtube({ version: 'v3', auth: await authorizedClient() });
// 실제 상태를 다시 읽는다 — 원장만 믿고 지우지 않는다.
const live = new Map();
for (let i = 0; i < rows.length; i += 50) {
  const r = await yt.videos.list({ part: ['status', 'snippet'], id: rows.slice(i, i + 50).map((x) => x.video_id) });
  for (const v of r.data.items ?? []) live.set(v.id, v);
}

let gone = 0; let skipped = 0; let removed = 0;
for (const row of rows) {
  const v = live.get(row.video_id);
  if (!v) { console.log(`  · ${row.video_id} 이미 없다(삭제됨)`); gone += 1; continue; }
  if (v.status.privacyStatus !== 'private') {
    console.log(`  ⚠ ${row.video_id} 공개 상태가 '${v.status.privacyStatus}' — 건너뛴다(원장과 다르다)`);
    skipped += 1; continue;
  }
  if (!YES) { console.log(`  (예정) ${row.video_id}  ${String(row.headline ?? '').slice(0, 34)}`); continue; }
  try {
    await yt.videos.delete({ id: row.video_id });
    console.log(`  🗑 ${row.video_id}  ${String(row.headline ?? '').slice(0, 34)}`);
    removed += 1;
  } catch (e) { console.log(`  ❌ ${row.video_id} 삭제 실패: ${String(e?.message).slice(0, 60)}`); }
}
console.log(YES
  ? `삭제 ${removed}건 · 이미 없던 것 ${gone}건 · 건너뜀 ${skipped}건`
  : `대상 ${rows.length - gone - skipped}건 — 실제로 지우려면 --yes`);
