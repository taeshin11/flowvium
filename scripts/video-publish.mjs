#!/usr/bin/env node
/**
 * video-publish.mjs — 영상 1편을 **만들고 올린다**. 스케줄러가 부르는 한 줄짜리 진입점.
 *
 * 왜 따로 두는가(2026-08-28): 지금까지 렌더와 업로드를 사람이 각각 손으로 돌렸다.
 *   "왜 자동으로 안 올라왔지" — 자동화가 아예 없었기 때문이다.
 *   렌더만 도는 크론을 만들면 "만들었는데 안 올라간" 상태가 생긴다. 한 단위로 묶는다.
 *
 * 제목·설명은 **이번 편이 실제로 다룬 이슈**에서 만든다. 사람이 매번 쓸 수 없고,
 *   지어내면 미끼가 된다 — 헤드라인에 있는 말만 쓴다.
 *
 * 사용: node scripts/video-publish.mjs [--locale en] [--dry-run] [--privacy public]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ROOT } from './lib/project-root.mjs';
import { resolveMediaRoot } from './lib/media-root.mjs';
import { envValue } from './lib/footage.mjs';
import { readLog } from './lib/edition-log.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const LOCALE = arg('--locale', 'en');
const DRY = argv.includes('--dry-run');
const node = process.execPath;
const t0 = Date.now();
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), '[publish]', ...a);

// 출력을 **그대로 흘려보낸다**(inherit). 모아 뒀다가 끝에 뱉으면 6분짜리 렌더 중에
//   아무것도 안 보여서 멈춘 건지 도는 건지 알 수 없다(2026-08-28).
//   메타데이터는 stdout 이 아니라 편성 기록에서 읽으므로 캡처할 이유도 없다.
const run = (args, label) => {
  const r = spawnSync(node, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.error) throw new Error(`${label} 실행 실패: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${label} 실패 (exit ${r.status}) — 위 출력을 볼 것`);
};

// ── 1. 렌더 ────────────────────────────────────────────────────────────────
log(`렌더 시작 (locale=${LOCALE})`);
run([resolve(ROOT, 'scripts/video/make-issue-video.mjs'), '--locale', LOCALE], '렌더');
const MEDIA = resolveMediaRoot({
  configured: envValue('MEDIA_ROOT'),
  localFallback: resolve(ROOT, 'reports/video'),
  allowLocal: argv.includes('--local-media'),
});
const VIDEO = join(MEDIA.root, `issue-${LOCALE}.mp4`);
const THUMB = join(MEDIA.root, `issue-${LOCALE}-thumb.jpg`);
if (!existsSync(VIDEO)) throw new Error(`영상이 없다: ${VIDEO}`);
log(`렌더 완료 · ${(statSync(VIDEO).size / 1048576).toFixed(1)}MB`);

// ── 2. 이번 편이 다룬 이슈 → 제목·설명 ──────────────────────────────────────
// 편성 기록의 **마지막 항목**이 방금 만든 편이다. 렌더가 성공했을 때만 기록되므로 믿을 수 있다.
const editions = readLog(resolve(ROOT, `data/video-editions-${LOCALE}.json`));
const last = editions[editions.length - 1] ?? { headlines: [], keywords: [] };
const heads = (last.headlines ?? []).filter(Boolean);
if (!heads.length) throw new Error('편성 기록이 비었다 — 어떤 뉴스를 다뤘는지 모른 채 올릴 수 없다');

/** 헤드라인에서 매체 꼬리표·중복을 걷어내고 대표 몇 개를 고른다. */
function pickHeadlines(list, n) {
  const seen = new Set();
  const out = [];
  for (const h of list) {
    const t = String(h).replace(/\s*[-–—|]\s*(Reuters|AP|CBS News|NBC News|NPR|Politico)\s*$/i, '').trim();
    const key = t.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 40);
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

const top = pickHeadlines(heads, 6);
// 제목: 상위 두 건을 잇는다. 100자 제한 안에서 **헤드라인 그대로** — 지어내지 않는다.
let title = top[0];
if (top[1] && (title.length + top[1].length + 3) <= 96) title = `${title} — ${top[1]}`;
title = title.slice(0, 100);

const SITE = envValue('SITE_URL') || 'flowvium.net';
const tagWords = [...new Set((last.keywords ?? []).concat(
  top.join(' ').split(/[^A-Za-z0-9']+/).filter((w) => /^[A-Z]/.test(w) && w.length > 2),
))].slice(0, 14);

const desc = [
  top.slice(0, 3).join(' '),
  '',
  'In this update:',
  ...top.map((h) => `• ${h}`),
  '',
  'Daily US politics and economy, told straight — no filler, no hype.',
  'Subscribe for a new briefing every day.',
  '',
  'Footage: public domain / CC0 / Pexels License.',
  '',
  `#USNews #Politics #Economy #Markets #BreakingNews #DailyNews #Flowvium`,
].join('\n');

log(`제목: ${title}`);
if (DRY) { log('--dry-run — 업로드하지 않는다'); process.exit(0); }

// ── 3. 업로드 ──────────────────────────────────────────────────────────────
const upArgs = [resolve(ROOT, 'scripts/youtube-upload.mjs'),
  '--file', VIDEO, '--title', title, '--desc', desc,
  '--tags', tagWords.join(','), '--locale', LOCALE,
  '--privacy', arg('--privacy', 'public')];
if (existsSync(THUMB)) upArgs.push('--thumb', THUMB);
run(upArgs, '업로드');
log(`끝 · ${((Date.now() - t0) / 60000).toFixed(1)}분`);
