#!/usr/bin/env node
/**
 * shorts-verify-published.mjs — 올라간 영상이 만든 영상과 같은지 대조한다.
 *
 * 왜 (2026-09-10 사용자 "보고서랑 쇼츠 다 잘봐라"):
 *   렌더 로그는 "고정 홍보 클립을 끝에 붙인다" 를 찍지만 **붙었는지는 아무도 확인하지 않았다.**
 *   concat 이 조용히 실패하거나 업로드가 잘려도 로그는 똑같이 성공으로 보인다.
 *   하루 10편이 나가고 사람이 다 볼 수 없다 — 길이만이라도 기계가 본다.
 *   광고 클립이 5.1초라 누락되면 길이로 드러난다(허용오차 2초).
 *
 * 함께 보는 것: 공개 상태(비공개로 뒤집힌 편), 같은 제목 중복.
 *   내리거나 지우지 않는다 — 알리기만 한다. 판단은 사람이 한다.
 *
 * 사용: node scripts/shorts-verify-published.mjs [--hours 24]
 * 종료코드: 0 정상 · 1 이상 발견
 */
import { google } from 'googleapis';
import { authorizedClient } from './lib/youtube.mjs';
import { openDb } from './lib/db.mjs';
import { durationVerdict } from './lib/published-duration.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const HOURS = Number(arg('--hours', 24));

const db = openDb();
const rows = db.prepare(`
  SELECT video_id, headline, published_at, duration_sec, retracted_at
    FROM shorts_published
   WHERE video_id IS NOT NULL
     AND datetime(published_at) >= datetime('now', ?)
   ORDER BY published_at`).all(`-${HOURS} hours`);

if (!rows.length) { console.log(`최근 ${HOURS}시간 발행분 없음`); process.exit(0); }

const yt = google.youtube({ version: 'v3', auth: await authorizedClient() });
const live = new Map();
for (let i = 0; i < rows.length; i += 50) {
  const r = await yt.videos.list({ part: ['contentDetails', 'status', 'snippet'], id: rows.slice(i, i + 50).map((x) => x.video_id) });
  for (const v of r.data.items ?? []) live.set(v.id, v);
}

let bad = 0, skipped = 0, okN = 0;
const seenTitle = new Map();
for (const row of rows) {
  const t = new Date(Date.parse(row.published_at) + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
  const v = live.get(row.video_id);
  if (!v) { console.log(`  ⚠ ${t} ${row.video_id} 유튜브에서 사라졌다`); bad += 1; continue; }

  // 내가 내린 편은 비공개가 정상이다 — 원장에 내림 표시가 없는데 비공개면 남이 내린 것이다.
  if (!row.retracted_at && v.status.privacyStatus !== 'public') {
    console.log(`  ⚠ ${t} ${row.video_id} 공개 상태가 '${v.status.privacyStatus}' — 내린 기록이 없다`);
    bad += 1;
  }

  const d = durationVerdict(row.duration_sec, v.contentDetails?.duration);
  if (d.ok === null) skipped += 1;
  else if (!d.ok) { console.log(`  ⚠ ${t} ${row.video_id} ${d.reason} (만든 것 ${d.localSec.toFixed(1)}s → 올라간 것 ${d.ytSec}s)`); bad += 1; }
  else okN += 1;

  // 이미 내린 편은 중복으로 세지 않는다 — 살아 있는 중복만 문제다(내린 것을 또 알리면 잡음이다).
  if (!row.retracted_at && v.status.privacyStatus === 'public') {
    const prev = seenTitle.get(v.snippet.title);
    if (prev) { console.log(`  ⚠ 같은 제목 2편: ${prev} · ${row.video_id} — ${v.snippet.title.slice(0, 34)}`); bad += 1; }
    else seenTitle.set(v.snippet.title, row.video_id);
  }
}

console.log(`\n최근 ${HOURS}시간 ${rows.length}편 · 길이 일치 ${okN} · 기준없음 ${skipped} · 이상 ${bad}`);
if (skipped) console.log('  (기준없음 = 길이를 기록하기 전에 올린 편. 다음 발행부터 대조된다)');
process.exit(bad ? 1 : 0);
