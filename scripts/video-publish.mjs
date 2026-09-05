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
// 2026-09-03: .env.local 을 읽지 않고 있었다. 후원 계좌(DONATION_ACCOUNT)가 거기 있는데
//   안 읽으면 설명란에서 그 줄이 **조용히 빠진 채** 발행된다. 조용한 누락이 제일 나쁘다.
import { loadEnvLocal } from './lib/llm-config.mjs';
loadEnvLocal();
import { existsSync, statSync, readFileSync } from 'node:fs';
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
// 2026-09-03: toISOString 은 **UTC** 다. 이 저장소의 다른 로그(cron·report)는 전부 KST 라
//   video.log 만 9시간 어긋나 있었다 — 실제로 내가 "다음 21:00" 이라고 잘못 말한 적이 있다.
//   보는 사람의 시계와 같은 시각을 쓴다.
const log = (...a) => console.log(
  new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[publish]', ...a);

// 출력을 **그대로 흘려보낸다**(inherit). 모아 뒀다가 끝에 뱉으면 6분짜리 렌더 중에
//   아무것도 안 보여서 멈춘 건지 도는 건지 알 수 없다(2026-08-28).
//   메타데이터는 stdout 이 아니라 편성 기록에서 읽으므로 캡처할 이유도 없다.
// exit 3 = "이번엔 낼 것이 없다". 실패가 아니다 —
//   중복 이슈, 소재 없음, 한국어 이슈 없음일 때 렌더가 스스로 회차를 거른다.
//   2026-09-05: 이 구분을 여기서 안 해서, 09:00 정기 실행이 정상적으로 회차를 걸렀는데도
//   **스택 트레이스를 뱉고 exit 1 로 죽었다**(launchd 가 실패로 기록). 감시기도 헛울린다.
//   거른 것과 고장난 것은 로그에서 한눈에 갈려야 한다.
const NOTHING_TO_PUBLISH = 3;
const run = (args, label) => {
  const r = spawnSync(node, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.error) throw new Error(`${label} 실행 실패: ${r.error.message}`);
  if (r.status === NOTHING_TO_PUBLISH) {
    log(`${label} — 이번 회차는 낼 것이 없어 건너뛴다(고장 아님). 다음 슬롯에 다시 시도한다.`);
    process.exit(NOTHING_TO_PUBLISH);
  }
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
  // 2026-09-03: 종전엔 여기서 그냥 나갔다. 실측 결과 **건너뛴 11회가 전부 이 사유**였고,
  //   그래서 하루 5편 예약이 실제로는 절반만 나갔다(사용자 "하루에 5번 올라가는 거 맞지?").
  //   렌더는 1.5분인데 다음 슬롯은 몇 시간 뒤다 — 포기할 게 아니라 **기다리는 게 맞다**.
  //   보고서는 30~60분이면 끝난다. 그 안에 비면 그 회차를 살린다.
  const WAIT_MAX_MS = Number(process.env.VIDEO_GPU_WAIT_MIN || 75) * 60_000;
  if (!skipGuard && busy) {
    log(`보고서 파이프라인이 도는 중 — 최대 ${Math.round(WAIT_MAX_MS / 60000)}분 기다린다(단일 GPU 경합).`);
    const until = Date.now() + WAIT_MAX_MS;
    let free = false;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 120_000));
      if (!(await isReportPipelineRunning().catch(() => false))) { free = true; break; }
    }
    if (!free) {
      log(`건너뜀 — ${Math.round(WAIT_MAX_MS / 60000)}분을 기다렸는데도 보고서가 안 끝났다. 다음 슬롯에 맡긴다.`);
      process.exit(0);
    }
    log(`보고서 종료 확인 — ${Math.round((WAIT_MAX_MS - (until - Date.now())) / 60000)}분 대기 후 진행한다.`);
  }
  if (!skipGuard && load1 > limit) {
    log(`건너뜀 — 부하 ${load1.toFixed(1)} > 한계 ${limit.toFixed(1)} (코어 ${cores}). --force 로 무시할 수 있다.`);
    process.exit(0);
  }
  log(`시작 가능 — 부하 ${load1.toFixed(1)} / 한계 ${limit.toFixed(1)} · 보고서 ${busy ? '실행중' : '유휴'}`);
}

// ── 1. 렌더 ────────────────────────────────────────────────────────────────
// 2026-09-03 (사용자 "그냥 쇼츠만 하자"): 기본 포맷이 세로 쇼츠다.
//   가로 6분짜리는 --format=long 으로 남겨 둔다 — 지운 게 아니라 부르지 않을 뿐이다.
const FORMAT = arg('--format', 'shorts');
const isShorts = FORMAT === 'shorts';
// 2026-09-04 (--use-existing): **이미 만들어 둔 파일을 그대로 올린다.**
//   종전엔 발행할 때마다 렌더를 다시 돌렸다. 그래서 사람이 눈으로 확인한 영상과
//   실제로 올라간 영상이 **다른 것**이었다 — 오늘 아침 확인본의 훅은 "7월 흑자 420억, 이유?" 였는데
//   올라간 것은 "반도체 표적관세" 였다. 확인의 의미가 없다.
//   4B 모델은 같은 프롬프트에도 회차마다 다르게 낸다. 보고 올리려면 그 파일을 올려야 한다.
//   정기 발행은 확인할 사람이 없으므로 종전대로 새로 만든다(기본값).
const USE_EXISTING = argv.includes('--use-existing');
if (USE_EXISTING) {
  log('--use-existing — 이미 만들어 둔 파일을 그대로 올린다(렌더 생략)');
} else {
  log(`렌더 시작 (locale=${LOCALE} · 포맷 ${FORMAT})`);
  run(isShorts
    ? [resolve(ROOT, 'scripts/video/make-shorts.mjs'), '--seconds', arg('--seconds', '40')]
    : [resolve(ROOT, 'scripts/video/make-issue-video.mjs'), '--locale', LOCALE], '렌더');
}
const MEDIA = resolveMediaRoot({
  configured: envValue('MEDIA_ROOT'),
  localFallback: resolve(ROOT, 'reports/video'),
  allowLocal: argv.includes('--local-media'),
});
const VIDEO = join(MEDIA.root, isShorts ? `shorts-${LOCALE}.mp4` : `issue-${LOCALE}.mp4`);
// 쇼츠는 썸네일을 붙이지 않는다. 유튜브가 세로 영상에서 자동으로 뽑고,
//   여기서 가로(16:9) 썸네일을 붙이면 쇼츠 선반에서 잘려 보인다.
//   옛 가로 회차의 issue-ko-thumb.jpg 가 남아 있으면 그게 붙는다 — 경로 자체를 비운다.
const THUMB = isShorts ? null : join(MEDIA.root, `issue-${LOCALE}-thumb.jpg`);
if (!existsSync(VIDEO)) throw new Error(`영상이 없다: ${VIDEO}`);
log(`렌더 완료 · ${(statSync(VIDEO).size / 1048576).toFixed(1)}MB`);

// ── 2. 이번 편이 다룬 이슈 → 제목·설명 ──────────────────────────────────────
// 편성 기록의 **마지막 항목**이 방금 만든 편이다. 렌더가 성공했을 때만 기록되므로 믿을 수 있다.
// 쇼츠는 자체 meta.json 을 남긴다(가로 편의 편성 기록과 형식이 다르다).
const last = isShorts
  ? JSON.parse(readFileSync(join(MEDIA.root, `shorts-${LOCALE}-meta.json`), 'utf8'))
  : (readLog(resolve(ROOT, `data/video-editions-${LOCALE}.json`)).slice(-1)[0] ?? { headlines: [], keywords: [] });
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
// 쇼츠 제목 상한. 유튜브 제목은 100자까지 받지만 **쇼츠 피드는 한두 줄만 보여준다** —
//   2026-09-03 실측: 올라간 제목이 95자였고 시청자에겐 앞 토막만 보였다.
//   " #Shorts"(8자) 자리를 미리 빼고 계산한다.
const SHORTS_TITLE_MAX = Number(process.env.SHORTS_TITLE_MAX || 46);
// 국뽕 앞머리 회전 씨앗. 종전엔 0 고정이라 5편 내내 같은 앞머리가 붙었다 — 그게 더 싸구려로 보인다.
//   편성 대장의 누적 편수를 쓴다(무작위가 아니라 결정론 — 같은 회차는 같은 제목이 나온다).
let seed = 0;
if (isShorts) {
  try { seed = (await import('./lib/db.mjs')).shortsPublishedCount(); }
  catch { /* 대장을 못 읽어도 제목은 나와야 한다 — 앞머리가 안 돌 뿐이다 */ }
}
let title = isShorts
  ? buildTitle(top, isKoUpload, seed, { maxLen: SHORTS_TITLE_MAX - 8 })
  : buildTitle(top, isKoUpload);
// 쇼츠는 제목·설명에 #Shorts 가 있어야 유튜브가 쇼츠 선반에 올린다(세로+3분이하 만으로는 놓칠 때가 있다).
if (isShorts && !/#Shorts/i.test(title)) title = `${title} #Shorts`;
if (proud) log('제목: 한국 성과 헤드라인을 앞세웠다(국뽕)');

const SITE = envValue('SITE_URL') || 'flowvium.net';   // 링크는 youtube-upload 가 /go/en 으로 붙인다
const tagWords = buildTags(top, last.keywords, isKoUpload);

const desc = buildDescription(top, isKoUpload);
// 넣기로 한 것이 빠졌으면 말한다. 설명란은 올린 뒤에 확인하기 번거롭다.
if (!String(process.env.DONATION_ACCOUNT ?? '').trim()) {
  log('⚠ DONATION_ACCOUNT 가 비어 있다 — 후원 안내가 빠진 채로 올라간다 (.env.local 확인)');
} else if (!desc.includes(process.env.DONATION_ACCOUNT.trim())) {
  log('⚠ 후원 계좌가 설명란에 들어가지 않았다 — video-meta 확인');
}

// 2026-09-04 마지막 관문: **한국어 채널에 영어 제목을 올리지 않는다.**
//   이슈 단계에서 막았지만 거기서 새면 그대로 나간다 — 실제로 22:09 에
//   "Should Investors Ride the Silver… #Shorts" 가 올라갔다.
//   제목에 한글이 하나도 없으면 발행을 멈춘다. 렌더는 버려도 되지만 채널에 남는 건 못 지운다.
if (isKoUpload && !/[가-힣]/.test(title)) {
  log(`❌ 제목에 한글이 없다 — 발행 중단: ${title.slice(0, 60)}`);
  log('   한국어 채널에 영어 제목이 나가면 시청자에게 안 걸리고 되돌리기도 어렵다.');
  process.exit(3);
}
log(`제목: ${title}`);
if (DRY) { log('--dry-run — 업로드하지 않는다'); process.exit(0); }

// ── 3. 업로드 ──────────────────────────────────────────────────────────────
const upArgs = [resolve(ROOT, 'scripts/youtube-upload.mjs'),
  '--file', VIDEO, '--title', title, '--desc', desc,
  '--tags', tagWords.join(','), '--locale', LOCALE,
  '--privacy', arg('--privacy', 'public')];
if (THUMB && existsSync(THUMB)) upArgs.push('--thumb', THUMB);
run(upArgs, '업로드');

// 편성 대장에 남긴다 — 다음 편이 같은 뉴스를 다시 고르지 않게 한다(2026-09-03 중복 3편 사건).
//   업로드가 성공한 뒤에만 남긴다. 실패한 편을 "다뤘다"고 적으면 그 뉴스를 영영 놓친다.
if (isShorts && last.keyword) {
  try {
    const { markShortsPublished } = await import('./lib/db.mjs');
    // 방금 올린 영상의 id 를 같이 남긴다. 업로더가 logs/last-upload.json 에 적어 둔다 —
    //   여기서는 출력을 흘려보내(inherit) 직접 읽을 수 없기 때문이다.
    //   id 가 없으면 어느 영상이 어느 회차인지 알 수 없어, 잘못 나간 편을 손으로 찾아야 한다.
    let videoId = null;
    try {
      const up = JSON.parse(readFileSync(resolve(ROOT, 'logs/last-upload.json'), 'utf8'));
      // 방금 것인지 확인한다 — 지난 회차의 id 를 이번 회차에 붙이면 추적이 더 나빠진다.
      if (up?.id && Date.now() - Date.parse(up.at) < 30 * 60_000) videoId = up.id;
    } catch { /* 없으면 id 없이 남긴다 */ }
    markShortsPublished({ issueKey: last.keyword, headline: heads[0], videoId });
    log(`편성 기록: "${last.keyword}"${videoId ? ` · ${videoId}` : ' (id 못 읽음)'} — 24시간 안에는 다시 안 고른다`);
  } catch (e) {
    // 대장 기록 실패가 발행을 되돌릴 이유는 없다. 다만 조용히 넘기면 중복이 다시 난다.
    log(`⚠ 편성 대장 기록 실패 — 다음 편이 같은 뉴스를 고를 수 있다: ${e.message}`);
  }
}
log(`끝 · ${((Date.now() - t0) / 60000).toFixed(1)}분`);
