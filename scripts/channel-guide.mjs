#!/usr/bin/env node
// channel-guide.mjs — 매주 월 09:00 KST: 지난 주 쇼츠 성적으로 채널 지침 1장을 다시 쓴다(2026-11-13, 사장님 11/12 지시).
//   → data/channel-guide/flowvium-shorts.json(제작이 읽는다) + .md(사람이 읽는다). 규칙은 lib/channel-guide 머리말.
//   지난 주 = 2~9일 전에 공개한 편(48시간 관측이 있는 것). 내린 편은 뺀다.
// 사용: node scripts/channel-guide.mjs [--dry]
import { writeFileSync, mkdirSync, renameSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { openDb } from './lib/db.mjs';
import { buildGuide, guideMarkdown, validGuide } from './lib/channel-guide.mjs';

const rows = openDb().prepare(`
  SELECT s.video_id, s.views, s.age_hours, p.published_at, p.layout, p.opener, p.motion
  FROM shorts_stats s JOIN shorts_published p ON p.video_id = s.video_id
  WHERE p.retracted_at IS NULL
    AND datetime(p.published_at) >= datetime('now', '-9 days')
    AND datetime(p.published_at) <  datetime('now', '-2 days')`).all();
const guide = buildGuide(rows);
guide.window = { videos: new Set(rows.map((r) => r.video_id)).size, from: '-9d', to: '-2d' };
if (!validGuide(guide)) { console.error('[channel-guide] 만든 지침이 검사를 못 넘었다 — 쓰지 않는다'); process.exit(1); }
const md = guideMarkdown(guide);
if (process.argv.includes('--dry')) { console.log(md); process.exit(0); }
const dir = resolve(ROOT, 'data/channel-guide');
mkdirSync(dir, { recursive: true });
for (const [name, body] of [['flowvium-shorts.json', JSON.stringify(guide, null, 2)], ['flowvium-shorts.md', md]]) {
  const f = resolve(dir, name);
  writeFileSync(`${f}.tmp`, body); renameSync(`${f}.tmp`, f);
}
console.log(`[channel-guide] 영상 ${guide.window.videos}편으로 지침을 다시 썼다 → data/channel-guide/flowvium-shorts.{json,md}`);
