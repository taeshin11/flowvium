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
import { buildTitle, buildDescription, buildTags, orderForTitle } from './lib/video-meta.mjs';
import { existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ROOT } from './lib/project-root.mjs';
import { resolveMediaRoot } from './lib/media-root.mjs';
import { envValue } from './lib/footage.mjs';
import { readLog } from './lib/edition-log.mjs';
import { isReportPipelineRunning } from './lib/report-running.mjs';
import { loadavg, cpus } from 'node:os';

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

// ── 0. 기계가 감당할 수 있는가 ──────────────────────────────────────────────
// 왜 필요한가(2026-08-29): 이 기계는 GPU 가 하나고 보고서·임베딩·웹서버가 같이 산다.
//   내가 립싱크를 돌렸을 때 부하가 56 까지 올라 **운영 사이트가 502** 를 냈다.
//   스케줄이 하루 5번 도는데 그때마다 이런 일이 나면 안 된다.
//
// 두 가지를 본다:
//   ① 보고서 파이프라인이 도는가 — 단일 GPU 라 끼어들면 서로 굶는다(report-running.mjs 의 판단을 그대로 쓴다).
//   ② 부하가 이미 높은가 — 코어 수 대비 기준을 넘으면 이번 회차는 건너뛴다.
// 건너뛰는 게 손해처럼 보이지만, 사이트를 내리는 것보다는 한 편 빠지는 게 낫다.
{
  const skipGuard = argv.includes('--force');
  const busy = await isReportPipelineRunning().catch(() => false);
  const cores = cpus().length || 8;
  const load1 = loadavg()[0];
  const limit = Number(arg('--max-load', String(cores * 0.9)));
  if (!skipGuard && busy) {
    log(`건너뜀 — 보고서 파이프라인이 도는 중이다(단일 GPU 경합). --force 로 무시할 수 있다.`);
    process.exit(0);
  }
  if (!skipGuard && load1 > limit) {
    log(`건너뜀 — 부하 ${load1.toFixed(1)} > 한계 ${limit.toFixed(1)} (코어 ${cores}). --force 로 무시할 수 있다.`);
    process.exit(0);
  }
  log(`시작 가능 — 부하 ${load1.toFixed(1)} / 한계 ${limit.toFixed(1)} · 보고서 ${busy ? '실행중' : '유휴'}`);
}

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
// 제목·설명·태그는 video-meta.mjs 가 만든다. 종전엔 여기서 영어로 하드코딩돼 있었고
//   ("In this update:" · "Daily US politics" · "#USNews"), 태그는 [A-Za-z0-9'] 로 잘라
//   **한글이 통째로 사라졌다.** 로케일 분기를 호출부에 흩으면 다음에 또 어긋난다.
// 국뽕(사용자 "제목에 국뽕 섞을수있으면 섞어")은 **고르는 문제**로 다룬다 —
//   헤드라인 중 한국 성과를 말하는 것이 있으면 앞세우고, 없으면 순서를 흔들지 않는다.
//   제목 문자열은 언제나 헤드라인 원문에서만 나온다(지어내지 않는다).
const isKoUpload = LOCALE === 'ko';
const { proud } = orderForTitle(top, isKoUpload);
const title = buildTitle(top, isKoUpload);
if (proud) log('제목: 한국 성과 헤드라인을 앞세웠다(국뽕)');

const SITE = envValue('SITE_URL') || 'flowvium.net';   // 링크는 youtube-upload 가 /go/en 으로 붙인다
const tagWords = buildTags(top, last.keywords, isKoUpload);

const desc = buildDescription(top, isKoUpload);

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
