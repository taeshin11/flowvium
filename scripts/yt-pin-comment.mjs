#!/usr/bin/env node
/**
 * yt-pin-comment.mjs — 우리 영상에 aisviagent.com 홍보 댓글을 달고 고정한다. (2026-10-08 신설)
 *
 * 사장님 "aisviagent.com 광고를 쿠팡파트너스 링크 달듯이 이 채널에서는 댓글에 링크 광고를 달자".
 * 사실 확인: 쇼츠 댓글·설명의 링크는 2023-08-31 부터 눌리지 않는다(유튜브 스팸 대책) — 쇼츠에서는 주소를 읽고
 *   복사하게 하는 글이다. 롱폼(사이트 소개·뉴스 총정리)에서는 링크가 눌리므로 utm 을 붙인다.
 * Data API 토큰에 댓글 권한이 없어(ACCESS_TOKEN_SCOPE_INSUFFICIENT, 10/05 실측) 로그인된 전용 브라우저 프로필
 *   (secrets/youtube-profile — 게시물·관련 동영상과 같은 것, 같은 잠금)로 한다. 이미 우리 고정 댓글이 있으면 건너뛴다.
 *
 * 사용: node scripts/yt-pin-comment.mjs --ids a,b [--dry]      |  --recent 24 (최근 N시간 발행분 + 그날 총정리)
 *       --due [--days 2] [--all]   pin-watch(10분마다): 채널 업로드 목록의 **공개** 편 중 안 단 편을 달고 고정,
 *                                  +10분·+24시간 된 편은 로그아웃 화면 재확인(lib/pin-state judgeViewer 다섯 가지). --all 은 창 안의 공개 편 전부 재확인.
 *   2026-10-23 사장님 "댓글다는게 좀 미흡할때가 많네"(Mac mini2 경유): 예약 공개 롱폼(h_nRYqiJDEg)이 공개 전에 달려다 실패하고
 *   다시 고르는 길이 없어 고정 댓글 없이 공개됐다(쓸기는 쇼츠 원장·총정리만 봤다). +24시간 재확인도 없었다.
 *   --due 는 실패하면 logs/pin-alert.jsonl 에 남기고 멈춘다(다음 편으로 넘어가지 않는다 — 프로필 로그아웃 같은 공통 고장이면 전부 같은 실패다).
 */
import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync, readFileSync } from 'fs';
import { ROOT } from './lib/project-root.mjs';
import { AD_LINE } from './lib/ad-line.mjs';
import { needsPin, writeEntry, alreadyEntry, verifiedEntry, judgeViewer, dueChecks } from './lib/pin-state.mjs';
import { appendFileSync } from 'fs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const DRY = argv.includes('--dry');
const VERIFY_ONLY = argv.includes('--verify-only');
const DUE = argv.includes('--due');
const ALL = argv.includes('--all');
const FIX = argv.includes('--fix-long-url');   // 달지 않고 시청자 화면 재확인만(--then-verify 초 뒤, 기본 0)
// --due 는 cron-runner 가 띄워 출력이 남지 않는다 — logs/pin-comment.log 에도 적는다(발행 직후 달기와 같은 파일).
const log = (...a) => {
  const line = [new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[pin]', ...a].join(' ');
  console.log(line);
  if (argv.includes('--due')) try { appendFileSync(resolve(ROOT, 'logs/pin-comment.log'), line + '\n'); } catch { /* 기록 실패는 일을 막지 않는다 */ }
};
const STATE = resolve(ROOT, 'logs/yt-pinned.json');
const state = (() => { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; } })();
// 실패 사진 폴더 — 달기와 재확인 둘 다 쓴다(10/16: 달기 블록 안에만 있어 재확인 단독 실행이 ReferenceError 로 죽었다).
const shots = join(ROOT, 'logs/pin-shots'); mkdirSync(shots, { recursive: true });
const ALERT = resolve(ROOT, 'logs/pin-alert.jsonl');
const alert = (id, step, error) => appendFileSync(ALERT, JSON.stringify({ at: new Date().toISOString(), id, step, error: String(error).slice(0, 160) }) + '\n');
// 새로 다는 댓글의 하루 상한(KST 날짜) — 사장님 10/23 "하루 20개 상한". 원장의 at(달기 성공 시각) 중 '이미 있음' 이 아닌 것을 센다.
const DAY_MAX = Number(arg('max', 20));
const kstDay = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const postedToday = () => Object.values(state).filter((e) => e?.at && !e.skipped && kstDay(e.at) === kstDay(new Date().toISOString())).length;

// 2026-10-08 사장님 "권장대로": 긴 주소(utm 붙은)는 링크 댓글 스팸 필터에 걸리기 쉽다 — 롱폼도 도메인만 짧게.
//   (유입은 aisviagent.com 쪽 리퍼러/직접 방문으로 본다. 쇼츠 댓글 링크는 원래 안 눌린다.)
// 2026-10-13 사장님 "광고 시간 최소화": 쇼츠·롱폼 모두 광고 한 줄(lib/ad-line)만. 새 편부터 — 이미 단 댓글은 그대로.
export const commentFor = () => AD_LINE;

let targets = [];
let verifyTargets = null;   // --due: [{id, check}] — null 이면 옛 동작(달기 대상 전부를 재확인)
const ids = (arg('ids', '') ?? '').split(',').filter(Boolean);
if (ids.length) targets = ids.map((id) => ({ id, kind: arg('kind', 'short') }));
else if (DUE) {
  // 10분마다 돈다 — 앞 실행이 아직 돌면(첫 회 +24시간 재확인 몰림 등) 물러난다(같은 편을 두 실행이 나란히 보지 않게).
  const wl = await (await import('./lib/run-lock.mjs')).acquireRunLock(resolve(ROOT, 'logs/pin-watch.lock'), { label: 'pin-watch' });
  if (!wl.ok) process.exit(0);   // 풀기는 run-lock 이 exit 때 한다
  // 채널 업로드 목록이 '공개됐다' 의 원본이다 — 쇼츠·장 요약·총정리·주간 해설·손 업로드 모두, 예약 편은 공개된 뒤에만 잡힌다.
  const { google } = await import('googleapis');
  const { authorizedClient } = await import('./lib/youtube.mjs');
  const { envValue } = await import('./lib/footage.mjs');
  const yt = google.youtube({ version: 'v3', auth: await authorizedClient() });
  const since = new Date(Date.now() - Number(arg('days', 2)) * 864e5).toISOString();
  const ch = await yt.channels.list({ part: ['contentDetails'], id: [envValue('YOUTUBE_CHANNEL_ID')] });
  const pl = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!pl) { alert('-', 'list', '채널 업로드 목록이 없다'); log('채널 업로드 목록이 없다 — 멈춘다'); process.exit(1); }
  const recent = [];
  for (let pageToken; ;) {
    const r = await yt.playlistItems.list({ part: ['contentDetails'], playlistId: pl, maxResults: 50, pageToken });
    const it = r.data.items ?? [];
    for (const x of it) if ((x.contentDetails.videoPublishedAt ?? '') >= since) recent.push(x.contentDetails.videoId);
    pageToken = r.data.nextPageToken;
    if (!pageToken || it.some((x) => (x.contentDetails.videoPublishedAt ?? '') < since)) break;
  }
  const pub = [];
  for (let i = 0; i < recent.length; i += 50) {
    const v = await yt.videos.list({ part: ['status', 'contentDetails'], id: recent.slice(i, i + 50) });
    for (const x of v.data.items ?? []) if (x.status?.privacyStatus === 'public') pub.push({ id: x.id, kind: /^PT(\d+S|[12]M(\d+S)?|3M)$/.test(x.contentDetails?.duration ?? '') ? 'short' : 'long' });
  }
  targets = pub;
  const now = Date.now();
  // --all(일괄 점검)은 'audit' 로 적는다 — +10분·+24시간 칸을 채우면 제때 할 재확인이 빠진다.
  verifyTargets = pub.flatMap((t) => (ALL ? ['audit'] : dueChecks(state[t.id], now)).map((check) => ({ ...t, check })));
}
else {
  const H = Number(arg('recent', 24));
  const { openDb } = await import('./lib/db.mjs');
  targets = openDb().prepare(`SELECT video_id id FROM shorts_published WHERE video_id IS NOT NULL AND retracted_at IS NULL
      AND datetime(published_at) >= datetime('now', ?) ORDER BY published_at`).all(`-${H} hours`).map((r) => ({ id: r.id, kind: 'short' }));
  // 그날 총정리 롱폼(링크가 눌린다)
  for (const d of [0, 1]) {
    const day = new Date(Date.now() + 9 * 3600e3 - d * 864e5).toISOString().slice(0, 10);
    try { const r = JSON.parse(readFileSync(resolve(ROOT, `logs/roundup-${day}.json`), 'utf8')); if (r.privacy === 'public' && r.id) targets.push({ id: r.id, kind: 'long' }); } catch { /* 그날 총정리 없음 */ }
  }
}
targets = targets.filter((t) => DRY || VERIFY_ONLY || FIX || needsPin(state[t.id]));   // lib/pin-state — 재확인 기록만 있는 편도 다시
if (DUE) {
  if (targets.length || verifyTargets.length) log(`달 편 ${targets.length} · 재확인 ${verifyTargets.length}편`);
  if (!targets.length && !verifyTargets.length) process.exit(0);   // 10분마다 돈다 — 할 일 없으면 조용히
} else {
  log(`대상 ${targets.length}편${DRY ? ' (dry — 글만 채우고 안 올림)' : ''}`);
  if (!targets.length) process.exit(0);
}
const failedNow = new Set();   // 이번에 달기·고정이 실패한 편 — 그 편의 재확인은 하지 않는다(앞 단계 실패에서 멈춘다)

let done = 0, failed = 0;
if (!VERIFY_ONLY && targets.length) {
const { YT_PROFILE_LOCK } = await import('./lib/site-tour-video.mjs');
// --due 는 10분마다 다시 돈다 — 오래 기다리지 않는다(기다리는 실행이 겹겹이 쌓이지 않게).
const plock = await (await import('./lib/run-lock.mjs')).acquireRunLock(resolve(ROOT, YT_PROFILE_LOCK), { waitMs: DUE ? 60_000 : 20 * 60_000, pollMs: 10_000, label: 'yt-pin-comment' });
if (!plock.ok) { log('유튜브 프로필을 다른 작업이 쓰고 있다 — 다음에 한다'); if (!DUE) process.exit(0); }
else {
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/youtube-profile'), {
  channel: 'chrome', headless: true, viewport: { width: 1280, height: 1400 }, args: ['--disable-blink-features=AutomationControlled'] });
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  for (const t of targets) {
    try {
      await page.goto(`https://www.youtube.com/watch?v=${t.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
      for (let k = 0; k < 6 && !(await page.locator('#simplebox-placeholder').count()); k++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(1500); }
      const ph = page.locator('#simplebox-placeholder').first();
      if (!(await ph.count())) throw new Error('댓글 입력 칸이 없다(댓글 꺼짐?)');
      // 우리 홍보 댓글이 이미 있나(@flowvium + aisviagent). 있으면 다시 달지 않는다 — 고정만 확인/보정한다.
      //   #pinned-comment-badge 는 모든 댓글에 숨겨진 채로 있다(10/08 DOM 실측) — '보이는가' 로 판정한다.
      const mineSel = 'ytd-comment-view-model:has-text("@flowvium"):has-text("aisviagent")';
      const pinnedVisible = async () => page.evaluate((sel) => [...document.querySelectorAll('ytd-comment-thread-renderer')]
        .some((th) => /@flowvium/.test(th.innerText) && /aisviagent/.test(th.innerText) && [...th.querySelectorAll('#pinned-comment-badge')].some((b) => b.offsetWidth || b.offsetHeight)), mineSel);
      let mine = page.locator(mineSel).first();
      // --fix-long-url: 예전 긴 주소(utm_) 댓글을 짧은 판으로 고친다(⋮ → 수정 → 저장). 지우지 않는다.
      if (FIX && await mine.count() && /utm_/.test(await mine.innerText())) {
        await mine.hover(); await mine.locator('button[aria-label="작업 메뉴"]').first().click(); await page.waitForTimeout(1500);
        const ed = page.getByRole('menuitem', { name: '수정' }).filter({ visible: true }).first();
        if (!(await ed.count())) throw new Error('메뉴에 "수정" 이 없다');
        await ed.click(); await page.waitForTimeout(1500);
        const box = page.locator('ytd-comment-view-model #contenteditable-root, #contenteditable-root').filter({ visible: true }).first();
        await box.click(); await page.keyboard.press('Meta+A'); await page.keyboard.press('Backspace');
        await page.keyboard.insertText(commentFor(t.kind)); await page.waitForTimeout(800);
        await page.locator('#submit-button:not([disabled])').filter({ visible: true }).first().click(); await page.waitForTimeout(4000);
        await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000);
        for (let k = 0; k < 6 && !(await page.locator(mineSel).count()); k++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(1500); }
        mine = page.locator(mineSel).first();
        const txt = (await mine.count()) ? await mine.innerText() : '';
        if (/utm_/.test(txt) || !/aisviagent\.com/.test(txt)) throw new Error(`고친 뒤 글이 "${txt.replace(/\s+/g, ' ').slice(0, 60)}"`);
        log(`${t.id} ✏️ 짧은 주소로 고침`);
      }
      if (await mine.count() && await pinnedVisible()) { log(`${t.id} 이미 우리 댓글이 고정돼 있다 — 건너뜀`); state[t.id] = writeEntry(STATE, t.id, (prev) => alreadyEntry(prev, new Date().toISOString(), t.kind)); continue; }
      if (!(await mine.count())) {
        if (!DRY && postedToday() >= DAY_MAX) { log(`오늘 새 댓글 ${DAY_MAX}개 상한 — 나머지는 내일`); break; }
        await ph.scrollIntoViewIfNeeded(); await ph.click(); await page.waitForTimeout(1200);
        const box = page.locator('#contenteditable-root').first();
        await box.click(); await page.keyboard.insertText(commentFor(t.kind)); await page.waitForTimeout(800);
        if (DRY) { await page.screenshot({ path: join(shots, `dry-${t.id}.png`) }); log(`${t.id} dry — 글 채움(안 올림) → logs/pin-shots/dry-${t.id}.png`); continue; }
        await page.locator('#submit-button:not([disabled])').first().click(); await page.waitForTimeout(5000);
        mine = page.locator(mineSel).first();
        if (!(await mine.count())) throw new Error('올렸는데 우리 댓글이 화면에 없다');
      } else if (DRY) { log(`${t.id} dry — 우리 댓글은 있고 고정만 안 됨`); continue; }
      // ⋮(작업 메뉴) → 고정 → 확인
      await mine.hover(); await mine.locator('button[aria-label="작업 메뉴"]').first().click(); await page.waitForTimeout(1500);
      const pinItem = page.getByRole('menuitem', { name: '고정' }).filter({ visible: true }).first();
      const pinAlt = page.locator('tp-yt-paper-listbox :text-is("고정"), yt-list-item-view-model:has-text("고정")').filter({ visible: true }).first();
      const item = (await pinItem.count()) ? pinItem : pinAlt;
      if (!(await item.count())) throw new Error('메뉴에 "고정" 이 없다');
      await item.click(); await page.waitForTimeout(1500);
      const ok = page.locator('tp-yt-paper-dialog button:has-text("고정"), yt-confirm-dialog-renderer button:has-text("고정"), #confirm-button button').filter({ visible: true }).last();
      if (await ok.count()) { await ok.click(); await page.waitForTimeout(3000); }
      // 되읽기 — 다시 열어서 우리 댓글에 고정 표시가 **보이는지**
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000);
      for (let k = 0; k < 6 && !(await pinnedVisible()); k++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(1500); }
      if (!(await pinnedVisible())) throw new Error('다시 읽었더니 우리 댓글에 고정 표시가 없다');
      done++; state[t.id] = writeEntry(STATE, t.id, () => ({ at: new Date().toISOString(), kind: t.kind })); log(`${t.id} ✅ 댓글·고정`);
    } catch (e) {
      failed++; failedNow.add(t.id); log(`${t.id} 실패: ${String(e?.message ?? e).slice(0, 100)}`);
      if (!DRY) state[t.id] = writeEntry(STATE, t.id, (prev = {}) => ({ ...prev, failedTries: (prev.failedTries ?? 0) + 1, lastError: String(e?.message ?? e).slice(0, 100), lastErrorAt: new Date().toISOString() })); await page.screenshot({ path: join(shots, `fail-${t.id}.png`) }).catch(() => {});
      if (DUE && !DRY) { alert(t.id, 'comment-pin', e?.message ?? e); log('달기·고정 실패 — 여기서 멈춘다(logs/pin-alert.jsonl)'); break; }
    }
    await page.waitForTimeout(6000);
  }
} finally { await ctx.close(); plock.release(); }
log(`끝 — 고정 ${done} · 실패 ${failed}`);
}
}
if (DUE && failed) process.exit(1);   // 앞 단계가 실패하면 재확인으로 넘어가지 않는다

// 재확인(사장님 원칙): 링크 댓글은 스팸 필터로 사라질 수 있다 — N초 뒤 **로그아웃 브라우저(시청자 화면)** 로
//   ①우리 댓글이 보이는가 ②작성자가 @flowvium 인가 ③고정 표시가 보이는가. 주인 화면엔 걸러진 댓글도 보일 수 있다.
const AFTER = Number(arg('then-verify', 0));
// 로그아웃 화면의 댓글 스레드 — 작성자 칸(#author-text)·본문·고정 표시·'자세히 보기' 가 보이는가(lib/pin-state judgeViewer 가 판정).
//   10/23 실측(NkgjOjUpHLE 로그아웃): #author-text "@flowvium", #content-text 가 광고 한 줄, #pinned-comment-badge 가 보임.
const viewerThreads = (pg) => pg.evaluate(() => {
  const vis = (el) => !!el && !!(el.offsetWidth || el.offsetHeight);
  return [...document.querySelectorAll('ytd-comment-thread-renderer')].map((th) => ({
    author: th.querySelector('#author-text')?.innerText.trim() ?? '',
    text: th.querySelector('#content-text')?.innerText ?? '',
    pinned: [...th.querySelectorAll('#pinned-comment-badge')].some(vis),
    // 접힘 단추는 글자가 아니라 자리로 본다 — 10/23 실측 글자는 '자세히 알아보기'(예전 '자세히 보기'), 글자로 찾던 첫 판은 391자 댓글에서도 못 울렸다.
    //   #expander 안 tp-yt-paper-button#more 가 보이면 접혀 있다(펼치면 #more 가 숨고 #less 가 보인다).
    moreShown: [...th.querySelectorAll('#expander #more')].some((e) => vis(e) && !e.hidden) }));
});
const vlist = verifyTargets ?? (VERIFY_ONLY || AFTER > 0 ? targets.map((t) => ({ ...t, check: 'v10' })) : []);
if ((AFTER > 0 || VERIFY_ONLY || DUE) && !DRY && vlist.length) {
  if (AFTER > 0) log(`${AFTER}초 뒤 시청자 화면에서 다시 확인한다`);
  await new Promise((r) => setTimeout(r, AFTER * 1000));
  const vb = await chromium.launch({ headless: true });
  const vp = await vb.newPage({ viewport: { width: 1280, height: 1400 }, locale: 'ko-KR' });
  let bad = 0;
  for (const t of vlist) {
    if (failedNow.has(t.id)) { log(`[verify] ${t.id} — 달기·고정이 실패해 재확인하지 않는다`); bad++; continue; }
    try {
      await vp.goto(`https://www.youtube.com/watch?v=${t.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await vp.waitForTimeout(5000);
      let r = null;
      for (let k = 0; k < 8 && !r?.ok; k++) { await vp.mouse.wheel(0, 900); await vp.waitForTimeout(1500); r = judgeViewer(await viewerThreads(vp)); }
      state[t.id] = writeEntry(STATE, t.id, (prev) => verifiedEntry(prev, r, new Date().toISOString(), t.check));
      if (!r.ok) { bad++; await vp.screenshot({ path: join(shots, `verify-fail-${t.id}.png`) }).catch(() => {}); }
      log(`[verify ${t.check}] ${t.id} ${r.ok ? '✅ 시청자 화면에 우리 고정 댓글(작성자·고정·한 줄 다 보임)' : `❌ 빠짐: ${r.missing.join(',')}${r.missing.includes('present') ? '(안 달렸거나 스팸 필터)' : ''}`}`);
      if (!r.ok && DUE) { alert(t.id, `verify-${t.check}`, r.missing.join(',')); log('[verify] 실패 — 여기서 멈춘다(logs/pin-alert.jsonl)'); break; }
    } catch (e) { bad++; log(`[verify] ${t.id} ❌ 확인 실패: ${String(e?.message ?? e).slice(0, 80)}`); if (DUE) { alert(t.id, `verify-${t.check}`, e?.message ?? e); break; } }
  }
  await vb.close();
  log(`[verify] 끝 — 문제 ${bad}편`);
  process.exit(bad ? 1 : 0);
}
process.exit(failed && !done ? 1 : 0);
