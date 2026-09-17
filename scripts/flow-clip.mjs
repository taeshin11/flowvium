#!/usr/bin/env node
/**
 * flow-clip.mjs — Flow 로 b-roll 클립을 만든다.
 *
 * **text-to-video 로 간다.** 처음엔 이미지를 올려 image-to-video 를 노렸는데, 실측 결과
 *   업로드는 미디어 보관함에만 들어가고 요청에는 첨부되지 않았다(시장 풍경이 나왔다).
 *   그런데 프롬프트만으로 잘 나오고, 그러면 오히려 이점이 크다:
 *     · 권리 확인 모달이 없다
 *     · CC BY-SA 이미지의 파생물 문제가 사라진다(동일조건변경허락 전파)
 *     · 키워드 스톡 검색보다 소재 적합성이 낫다 — 검색은 있는 것 중에 고르고, 생성은 필요한 걸 만든다
 *
 * 모델은 `Veo 3.1 - Lite [Lower Priority]` 고정. 25,000 크레딧/월 중 **0 크레딧**이다.
 *   실측 생성 시간 약 60초/클립(2026-08-27).
 *
 * 사용: node scripts/flow-clip.mjs --prompt "..." --out <mp4> [--wait 600]
 */
import {
  openFlow, sessionCookiesPresent, setVideoModel, openProject, inProject,
  mediaCardTitles, videoUrlForCard,
  composerVisible, defaultsPanelOpen, typePrompt, dismissDialogs,
  videoUrls, downloadMedia, freshMedia, FREE_VIDEO_MODEL, PROFILE_DIR,
  isFreeModel, MODEL_RESULT,
} from './lib/flow.mjs';
import { mkdirSync, unlinkSync } from 'fs';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { dirname, resolve } from 'path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
// ⚠ **동영상임을 명시해야 한다.** 에이전트가 매체를 스스로 고른다 — 실측(2026-08-27):
//   "US Capitol dome at dusk, slow cinematic push-in, documentary news b-roll" 을 주니
//   Nano Banana Pro 로 **사진**을 만들었다(훌륭한 사진이었지만 영상이 아니다).
//   그리고 이미지 모델은 0 크레딧이 아닐 수 있다 — 우리가 고정한 건 동영상 모델뿐이다.
//   즉 이 한 줄이 품질 문제가 아니라 **과금 문제**다.
const VIDEO_DIRECTIVE = 'Create an 8 second VIDEO clip (not an image). ';
const PROMPT = VIDEO_DIRECTIVE + arg('--prompt',
  'documentary news b-roll, slow cinematic push-in, natural daylight, no on-screen text');
const OUT = resolve(arg('--out', 'assets/broll/flow-clip.mp4'));
// 2026-09-16: 기본 대기를 늘린다. 0 크레딧 모델이 `Veo 3.1 - Lite [Lower Priority]` 로,
//   이름 그대로 뒤로 밀린다 — 실측으로 420초 안에 안 끝난 경우가 세 번 연속 있었다
//   (셋 다 나중에 보면 멀쩡히 만들어져 있었다). 공짜인 대신 느린 것이므로 기다리는 쪽이 맞다.
//   2026-09-16 실측으로 확정: 900초 동안 루프가 [8] 을 **정확히 16번** 읽었고(읽는 쪽은 정상),
//   그 뒤에 9번째 카드가 생겼다. 즉 감지가 아니라 **대기 부족**이었다. 15분을 넘긴다.
const WAIT_S = Number(arg('--wait', 1800));
const SHOTS = arg('--shots', null);
const MODEL = arg('--model', process.env.FLOW_VIDEO_MODEL ?? FREE_VIDEO_MODEL);
// 유료 등급은 **명시적으로 허용해야** 쓴다. 기본 가드는 0 크레딧 모델이 아니면 생성을 막는다 —
//   매일 도는 자동화가 실수로 크레딧을 태우지 않게 하려는 것이고, 그 기본값을 유지한다.
const ALLOW_PAID = argv.includes('--allow-paid');

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });
if (!sessionCookiesPresent()) {
  // 관측값을 같이 낸다. Claude Code 의 에러가 전부 "(got ...)" 를 붙이는 이유가 이것이다 —
  //   "없다" 만으로는 프로필이 비었는지, 만료됐는지, 경로가 틀렸는지 구분이 안 된다.
  const { existsSync } = await import('fs');
  const db = `${PROFILE_DIR}/Default/Cookies`;
  console.error(`❌ 로그인 세션 없음 (프로필 ${existsSync(PROFILE_DIR) ? '있음' : '없음'}, `
    + `쿠키DB ${existsSync(db) ? '있음' : '없음'}) — node scripts/flow-login.mjs 로 로그인하라`);
  process.exit(1);
}

const { ctx, page } = await openFlow({ headless: false });
let step = 0;
const shot = async (l) => { if (!SHOTS) return; step++; await page.screenshot({ path: `${SHOTS}/${step}-${l}.png` }).catch(() => {}); };
const die = async (msg, label) => { console.error(`❌ ${msg}`); await shot(label); await ctx.close().catch(() => {}); process.exit(1); };

const t0 = Date.now();
if (!(await openProject(page))) await die('프로젝트 화면 진입 실패', 'no-project');
console.log(`  프로젝트: ${page.url()}`);

// ── 모델 고정. 0 크레딧이 아니면 생성하지 않는다 ────────────────────────────
// 재시도 가능한 실패는 여기서 흡수한다 — 안내 모달 하나에 작업 전체가 죽지 않게.
//   치명적 실패(모델 목록에 항목 없음)는 반복해도 소용없으므로 바로 나간다.
let r = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  r = await setVideoModel(page, MODEL);
  console.log(`  [모델] 시도 ${attempt}: "${r.shown}" · ${r.status}`);
  if (r.ok || !r.retryable) break;
  console.log(`         ↳ ${r.hint} — 재시도`);
  await dismissDialogs(page);
  await page.waitForTimeout(1500);
}
const shown = r.shown;
if (!r.ok) console.log(`         ↳ ${r.hint}`);
await shot('model');
if (!inProject(page)) await die(`프로젝트 화면을 벗어났다: ${page.url()}`, 'left-project');
// 실패 사유를 그대로 전달한다. 종전엔 전부 "0 크레딧 모델이 반영되지 않았다" 로 뭉개서
//   실제 원인(안내 모달이 화면을 덮음)과 무관한 곳을 보게 만들었다.
// 2026-09-15: 판정 기준을 **모델 이름 → 팝오버의 크레딧 표시**로 바꿨다.
//   Flow 가 UI 를 바꾸면서 모델 이름이 칩에서 사라졌고, 이름 기반 판정이 통째로 막혔다.
//   우리가 알고 싶은 건 이름이 아니라 크레딧이다 — setVideoModel 이 "0 크레딧" 을 읽고 ok 를 준다.
//   못 읽으면 ok 가 아니다. 모르면 막는다 — 크레딧은 잘못 쓰면 되돌릴 수 없다.
if (!r.ok && !ALLOW_PAID) {
  await die(`0 크레딧을 확인하지 못했다 (${r.status}, 표시="${shown}") — ${r.hint}. 유료로 생성하지 않는다(--allow-paid 로 해제)`, 'model-fail');
}
if (!r.ok) console.log(`  ⚠ 0 크레딧 확인 없이 생성한다 — 크레딧이 소모될 수 있다 (표시="${shown}")`);

// 생성 전에 이미 있는 결과를 기억해 둔다. "영상이 보인다" 만으로는 방금 시킨 것인지 알 수 없다.
const before = new Set(await videoUrls(page));
console.log(`  [기존] 결과 영상 ${before.size}개`);
// 2026-09-16: `<video>` 만으로는 생성을 못 본다 — 새 갤러리는 카드에 썸네일만 두고
//   눌러야 `<video>` 를 붙인다. **카드 제목**을 같이 기억해 둔다. 늘어난 제목이 방금 만든 것이다.
//   제목은 고유하지 않다 — Set 으로 지우면 같은 제목의 새 클립이 안 보인다(실측으로 당했다).
//   개수로 센다. DOM 순서가 최신순이라 새로 생긴 것은 맨 앞이다.
const beforeCards = await mediaCardTitles(page);
const beforeTop = beforeCards[0] ?? null;
console.log(`  [기존] 카드 ${beforeCards.length}개 · 맨앞 "${String(beforeTop ?? '(없음)').slice(0, 34)}"`);

// ── 프롬프트 → 제출 ────────────────────────────────────────────────────────
await dismissDialogs(page);
if (!(await composerVisible(page))) await die(`작성기를 쓸 수 없다 (설정 패널 열림=${await defaultsPanelOpen(page)})`, 'no-composer');
if (!(await typePrompt(page, PROMPT))) await die('프롬프트가 입력되지 않았다 — 빈 상태로 제출하지 않는다', 'no-prompt');
await shot('prompt');
console.log(`  [프롬프트] ${PROMPT.slice(0, 80)}`);
await page.keyboard.press('Enter').catch(() => {});
await page.waitForTimeout(4000);
await shot('submitted');
console.log('  [생성] 제출');

// ── 결과 대기. **새로 생긴** 영상만 인정한다 ────────────────────────────────
const deadline = Date.now() + WAIT_S * 1000;
let fresh = null;
let pollN = 0;
while (Date.now() < deadline) {
  const now = await videoUrls(page);
  // 개수가 늘어야 생성이다. 화면 전환으로 붙은 <video> 를 결과로 오인하면
  //   **기존 클립을 내려받는다**(실측 2026-08-28).
  fresh = freshMedia([...before], now);
  if (fresh) break;
  // `<video>` 가 안 붙는 배치에서는 **새로 생긴 카드 제목**으로 찾는다.
  //   제목을 눌러야 그때 `<video>` 가 생기므로, 눌러서 주소를 받아 온다.
  // 2026-09-16: 갤러리가 **스스로 갱신되지 않는다.** 제출 뒤 20분을 기다려도 DOM 은 그대로였는데,
  //   같은 순간 새로고침해서 보면 카드가 늘어 있었다(6→7, "Woman speaking into smartphone").
  //   생성도 됐고 세는 것도 맞았는데 **보고 있는 화면이 낡아서** 못 봤다.
  //   주기적으로 다시 읽는다. 새로고침은 싸고, 못 보는 것보다 낫다.
  if (++pollN % 6 === 0) {                     // 8초 × 6 ≈ 48초마다
    // 2026-09-17: reload 는 **지금 화면**을 다시 부를 뿐이다. 제출 뒤엔 프로젝트 안의 다른 화면
    //   (생성 진행·편집 뷰)에 머물러 카드가 1개만 보였다 — 실측 [1] 16번, 그동안 새 영상은 만들어져 있었다.
    //   따로 확인할 때 쓰는 경로(openProject = 프로젝트 주소로 goto)를 그대로 쓴다.
    await openProject(page).catch(() => {});
    await page.waitForTimeout(4000);
    await dismissDialogs(page);
    // 2026-09-16: 새로고침만 하면 **프로젝트 밖으로 나간다**. 그 화면엔 카드가 없어
    //   개수가 늘어난 적이 없는 것처럼 보였다(실측: 카드가 7→8 이 됐는데 900초를 못 봤다).
    //   되돌아가야 갤러리를 다시 본다.
    // 2026-09-17: 3초로는 갤러리가 덜 그려져 맨앞 카드를 못 읽었다(루프는 1500초 동안 못 봤는데,
    //   따로 8초 기다려 읽으니 새 카드가 맨앞에 있었다). 따로 읽을 때와 같게 기다린다.
    await page.waitForTimeout(8000);
  }
  const nowCards = await mediaCardTitles(page);
  // 무엇을 보고 있는지 남긴다 — 못 보고 끝났을 때 원인을 가르려면 이 숫자가 필요하다.
  if (pollN % 6 === 0) process.stdout.write(`[${nowCards.length}]`);
  // 2026-09-16: **개수로는 못 잡는다.** 갤러리가 보이는 타일만 렌더해서, 새 카드가 위에 끼면
  //   아래 하나가 빠진다 — 실제로 9개인데 30분 내내 8 을 읽었고 숫자가 한 번도 안 변했다.
  //   맨 앞 카드가 바뀌는 것으로 본다. Flow 는 프롬프트에서 제목을 뽑아 붙이고, 실측 네 회차가
  //   전부 다른 제목이었다(Man / Woman / Person / Office worker speaking into smartphone).
  //   개수도 같이 본다 — 둘 중 하나만 걸려도 생성이다(느슨해지는 쪽 실수가 낫다, 규격 검사가 뒤에 있다).
  const topChanged = nowCards.length > 0 && beforeTop && nowCards[0] !== beforeTop;
  if (topChanged || nowCards.length > beforeCards.length) {
    const url = await videoUrlForCard(page, nowCards[0], { nth: 0 });   // 맨 앞이 가장 새것
    if (url) {
      fresh = url;
      console.log(`\n  [생성] 새 카드 "${nowCards[0].slice(0, 40)}"`
        + (topChanged ? ` (맨앞 바뀜: "${beforeTop.slice(0, 26)}" →)` : ` (${beforeCards.length}→${nowCards.length})`));
      break;
    }
  }
  await dismissDialogs(page);                 // 생성 전 확인 모달이 뜰 수 있다
  await page.waitForTimeout(8000);
  process.stdout.write('.');
}
console.log('');
await shot('result');
if (!fresh) {
  // 사진이 생겼을 수도 있다 — 그건 크레딧을 썼을 가능성이 있으므로 구분해서 알린다.
  const imgs = await page.locator('img[src*="media"], img[src*="blob"]').count().catch(() => 0);
  await die(`${WAIT_S}초 안에 새 **동영상**이 없다 (화면의 이미지 ${imgs}개). `
    + '에이전트가 사진을 만들었을 수 있다 — 프롬프트에 VIDEO 를 명시했는지 확인하라', 'no-result');
}

const secs = ((Date.now() - t0) / 1000).toFixed(0);
let bytes = 0;
try { bytes = await downloadMedia(page, fresh, OUT); }
catch (e) { await die(`내려받기 실패: ${e.message}`, 'download-fail'); }

// [규격 검사] 개수가 늘었다고 **내가 시킨 영상**인 건 아니다.
//   실측(2026-08-29): 새 프로젝트가 열려 "기존 0개" 상태에서 720x1280 세로 판화 영상을
//   받아왔다. 앵커를 시켰는데 제철소 그림이었다. 개수만 보는 판정으로는 못 거른다.
//   내용까지 판정할 수는 없지만 **규격은 확실히 볼 수 있다** — 안 맞으면 지우고 실패로 끝낸다.
{
  const probe = spawnSync(ffmpegPath, ['-hide_banner', '-i', OUT], { encoding: 'utf8' }).stderr ?? '';
  const m = probe.match(/,\s(\d{2,5})x(\d{2,5})[,\s]/);
  const w = m ? Number(m[1]) : 0;
  const h = m ? Number(m[2]) : 0;
  const wantLandscape = !argv.includes('--portrait');
  const bad = !w || !h
    || (wantLandscape && h > w)
    || (!wantLandscape && w > h)
    || w < Number(arg('--min-width', wantLandscape ? '960' : '540'));
  if (bad) {
    try { unlinkSync(OUT); } catch { /* noop */ }
    await die(`규격이 안 맞는다 — ${w}x${h} (기대 ${wantLandscape ? '가로' : '세로'}, 최소 폭 ${arg('--min-width', wantLandscape ? '960' : '540')}). `
      + '내가 시킨 영상이 아닐 가능성이 크다. 파일은 지웠다.', 'wrong-spec');
  }
  console.log(`   [규격] ${w}x${h} 확인`);
}

console.log(`✅ ${OUT}`);
console.log(`   ${(bytes / 1048576).toFixed(1)}MB · 전체 ${secs}초 · 모델 ${shown}`);
await ctx.close().catch(() => {});
