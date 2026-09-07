#!/usr/bin/env node
/**
 * youtube-republish.mjs — 잘못 내린 편을 **다시 공개**한다.
 *
 * 왜 (2026-09-07 사용자 "이미 공개를 해서 조회수 잘 나오고 있는 걸 왜 비공개를 걸었냐고?"):
 *   같은 문장을 반복한다는 이유로 07:30 편을 내렸는데, 그 편은 1시간에 364회로
 *   그날 가장 잘 나가고 있었다. **품질이 아쉬운 것과 내려야 하는 것은 다르다.**
 *   이미 배포가 시작된 영상을 내리면 그 도달은 돌아오지 않는다.
 *
 * 내리는 기준은 이제 이렇게 좁힌다:
 *   내린다  — 사실이 틀렸다 · 저작권/정책 위험 · 남의 얼굴에 낙인이 얹혔다 · 회색 카드뿐이다
 *   안 내린다 — 문장이 반복된다 · 밋밋하다 · 사진이 아쉽다 (다음 편에서 고친다)
 */
import { google } from 'googleapis';
import { authorizedClient } from './lib/youtube.mjs';
import { openDb } from './lib/db.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const id = arg('--id');
if (!id) { console.error('사용: --id VIDEO_ID'); process.exit(1); }

const yt = google.youtube({ version: 'v3', auth: await authorizedClient() });
const r = await yt.videos.list({ part: ['status', 'snippet', 'statistics'], id: [id] });
const v = r.data.items?.[0];
if (!v) { console.error(`영상을 못 찾았다: ${id} — 삭제됐을 수 있다`); process.exit(1); }
console.log(`현재: ${v.status.privacyStatus} · 조회 ${v.statistics?.viewCount ?? '-'}회`);
if (v.status.privacyStatus === 'public') { console.log('이미 공개다 — 할 일 없음'); process.exit(0); }

await yt.videos.update({
  part: ['status'],
  requestBody: { id, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } },
});
const after = await yt.videos.list({ part: ['status'], id: [id] });
const now = after.data.items?.[0]?.status?.privacyStatus;
console.log(now === 'public' ? `✅ 다시 공개: https://youtu.be/${id}` : `⚠ 아직 ${now}`);

// 원장의 '내림' 표시를 지운다 — 안 지우면 성적 집계에서 계속 빠진다.
try {
  const db = openDb();
  const res = db.prepare('UPDATE shorts_published SET retracted_at = NULL WHERE video_id = ?').run(id);
  console.log(`   편성 원장 내림 표시 해제 (${res.changes}행)`);
  db.close();
} catch (e) { console.log(`   원장 갱신 실패: ${String(e?.message).slice(0, 60)}`); }
