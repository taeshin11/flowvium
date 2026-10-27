#!/usr/bin/env node
/**
 * yt-reply-comments.mjs — 시청자 댓글에 짧은 답글을 단다. (2026-10-27 신설, 규칙은 lib/comment-reply.mjs 머리말)
 *
 * 10/27 사장님 상시 규칙(Mac mini2 경유): 진짜 시청자 댓글에만, 매시 보니 1시간 안. 스팸·욕설·정치는 건너뛰고 지우지 않는다.
 * 흐름: Data API 로 최근 24시간 댓글 → 우리 것·이미 답한 것 빼고 고른다(영상당 5·하루 20) → agy 가 분류·초안 →
 *   lib checkReply 를 못 넘으면 버린다 → 전용 브라우저 프로필(고정 댓글과 같은 것·같은 잠금)로 답글 →
 *   올린 답글의 작성자가 우리 채널인지 화면에서 보고, Data API(공개 읽기)로 한 번 더 확인한다.
 * 정치 주제(국내정치) 영상의 댓글은 내용을 보기 전에 건너뛴다 — 거기 달린 댓글은 거의 전부 정치다(10/27 실측 18건 중 18건).
 *
 * 사용: node scripts/yt-reply-comments.mjs [--dry]   (--dry: 초안까지 만들고 화면 입력까지 한 뒤 올리지 않는다)
 * 원장: logs/comment-replies.json { commentId: { at, videoId, status: replied|skipped|failed, why?, reply? } }
 */
import { google } from 'googleapis';
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { authorizedClient, currentChannel } from './lib/youtube.mjs';
import { checkReply, pickTargets } from './lib/comment-reply.mjs';

const DRY = process.argv.includes('--dry');
const LEDGER = resolve(ROOT, 'logs/comment-replies.json');
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[reply]', ...a);
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
const mark = (t, status, extra = {}) => {
  ledger[t.id] = { at: new Date().toISOString(), videoId: t.videoId, status, ...extra };
  if (status === 'skipped') log(`건너뜀(${extra.why}) ${t.id}: ${String(t.text).replace(/\s+/g, ' ').slice(0, 40)}`);
  if (!DRY) save();
};

const auth = await authorizedClient();
const yt = google.youtube({ version: 'v3', auth });
const ch = await currentChannel();

// ── 1. 최근 24시간 댓글 ──
const threads = [];
let pageToken;
for (let i = 0; i < 5; i++) {
  const r = await yt.commentThreads.list({ part: ['snippet', 'replies'], allThreadsRelatedToChannelId: ch.id, maxResults: 100, order: 'time', pageToken });
  let old = false;
  for (const it of r.data.items ?? []) {
    const s = it.snippet.topLevelComment.snippet;
    if (Date.now() - Date.parse(s.publishedAt) > 26 * 3600e3) { old = true; break; }
    threads.push({ id: it.id, videoId: s.videoId, publishedAt: s.publishedAt, authorId: s.authorChannelId?.value, author: s.authorDisplayName,
      text: s.textOriginal, repliedByUs: (it.replies?.comments ?? []).some((c) => c.snippet.authorChannelId?.value === ch.id) });
  }
  pageToken = r.data.nextPageToken;
  if (old || !pageToken) break;
}
// --dry --id <댓글> --say "<답글>": 고르기·분류를 건너뛰고 화면 입력 길만 시험한다(답할 댓글이 없을 때 선택자 점검용).
const FORCE = process.argv.includes('--id') ? process.argv[process.argv.indexOf('--id') + 1] : null;
if (FORCE && !DRY) { console.error('--id 는 --dry 와만 쓴다'); process.exit(2); }
const targets = FORCE ? threads.filter((t) => t.id === FORCE) : pickTargets(threads, { channelId: ch.id, ledger });
if (!targets.length) process.exit(0);   // 매시 돈다 — 할 일 없으면 조용히
log(`새 시청자 댓글 ${targets.length}개`);

// ── 2. 영상 정보(제목·언어·주제) ──
const vids = [...new Set(targets.map((t) => t.videoId))];
const vinfo = new Map();
for (let i = 0; i < vids.length; i += 50) {
  const r = await yt.videos.list({ part: ['snippet'], id: vids.slice(i, i + 50) });
  for (const v of r.data.items ?? []) vinfo.set(v.id, { title: v.snippet.title, lang: v.snippet.defaultAudioLanguage ?? v.snippet.defaultLanguage ?? 'ko' });
}
let topicOf = () => null;
try {
  const { openDb } = await import('./lib/db.mjs');
  const st = openDb().prepare('SELECT topic FROM shorts_published WHERE video_id = ?');
  topicOf = (id) => st.get(id)?.topic ?? null;
} catch { /* 주제를 모르면 내용 분류에 맡긴다 */ }

// ── 3. 분류·초안 ──
const { agyReport } = await import('./lib/agy-report.mjs');
const drafts = FORCE ? targets.map((t) => ({ t, reply: process.argv[process.argv.indexOf('--say') + 1] })) : [];
for (const t of FORCE ? [] : targets) {
  const v = vinfo.get(t.videoId) ?? { title: '', lang: 'ko' };
  const lang = /^en/i.test(v.lang) ? 'en' : 'ko';
  if (topicOf(t.videoId) === '국내정치') { mark(t, 'skipped', { why: '정치 영상' }); continue; }
  const prompt = [
    `유튜브 채널 Flowvium(시장·뉴스 요약) 운영자로서 시청자 댓글 하나를 분류하고, 답할 만하면 답글 초안을 써라.`,
    `영상 제목: ${v.title}`, `댓글: ${t.text}`, '',
    'category: question(질문) | feedback(의견·제안) | thanks(칭찬·인사) | spam | abuse(욕설·비하) | politics(정치 의견·진영) | other',
    'stock: 특정 종목·투자 판단을 묻는가(true/false). product_link: 상품 링크·구매처를 묻는가(true/false).',
    `reply: spam·abuse·politics·other 면 null. 아니면 ${lang === 'en' ? '영어' : '한국어'}로 1~2줄 — 질문엔 아는 사실로만 답하고, 모르면 지어내지 말고 null.`,
    '  의견·칭찬엔 고맙다는 말과 영상 내용 사실 하나. 링크·사이트 주소·쿠팡·구독 부탁 금지. 의료 조언 금지.',
    '  stock 이면 사라·팔라·추천 없이 사실만, 마지막 줄에 정확히 "투자 권유가 아닙니다." (영어면 "Not investment advice.").',
    '  product_link 면 "링크는 고정 댓글에 있습니다." 한 줄.',
    '출력: {"category":"...","stock":false,"product_link":false,"reply":"..."|null}',
  ].join('\n');
  let r;
  try { r = await agyReport(prompt, { model: 'gemini-4-argon-medium' }); } catch (e) { log(`분류 실패 ${t.id}: ${String(e?.message ?? e).slice(0, 80)}`); continue; }   // 원장에 안 남긴다 — 다음 시간에 다시
  if (!r?.category) { log(`분류를 못 받았다 ${t.id} — 다음 시간에 다시`); continue; }   // agy 실패를 '건너뜀'으로 굳히지 않는다
  if (['spam', 'abuse', 'politics', 'other'].includes(r.category) || !r.reply) { mark(t, 'skipped', { why: r.category }); continue; }
  const c = checkReply(r.reply, { stock: !!r.stock, lang });
  if (!c.ok) { mark(t, 'skipped', { why: `규칙: ${c.why}`, reply: r.reply }); log(`초안 버림(${c.why}): ${r.reply}`); continue; }
  drafts.push({ t, reply: String(r.reply).trim() });
}
if (!drafts.length) process.exit(0);

// ── 4. 답글 달기(전용 프로필) ──
const { YT_PROFILE_LOCK } = await import('./lib/site-tour-video.mjs');
const plock = await (await import('./lib/run-lock.mjs')).acquireRunLock(resolve(ROOT, YT_PROFILE_LOCK), { waitMs: 60_000, pollMs: 10_000, label: 'yt-reply-comments' });
if (!plock.ok) { log('유튜브 프로필을 다른 작업이 쓰고 있다 — 다음 시간에'); process.exit(0); }
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/youtube-profile'), {
  channel: 'chrome', headless: true, viewport: { width: 1280, height: 1400 }, args: ['--disable-blink-features=AutomationControlled'] });
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  for (const { t, reply } of drafts) {
    try {
      // lc= 로 열면 그 댓글이 맨 위('강조 표시된 댓글')에 온다
      await page.goto(`https://www.youtube.com/watch?v=${t.videoId}&lc=${t.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
      let thread = page.locator('ytd-comment-thread-renderer').first();
      for (let k = 0; k < 6 && !(await thread.count()); k++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(1500); thread = page.locator('ytd-comment-thread-renderer').first(); }
      const shown = (await thread.locator('#content-text').first().innerText()).replace(/\s+/g, ' ').trim();
      if (shown.slice(0, 20) !== t.text.replace(/\s+/g, ' ').trim().slice(0, 20)) throw new Error(`맨 위 댓글이 다르다: "${shown.slice(0, 30)}"`);
      await thread.locator('#reply-button-end button, ytd-button-renderer#reply-button-end').first().click();
      await page.waitForTimeout(1500);
      const box = thread.locator('#contenteditable-root').filter({ visible: true }).first();
      await box.click();
      await page.keyboard.insertText(reply.replace(/\n/g, ' '));   // 줄바꿈 키는 바로 올려 버릴 수 있다 — 한 줄로
      await page.waitForTimeout(800);
      if (DRY) { log(`[dry] ${t.id} 입력까지: ${reply}`); await page.screenshot({ path: resolve(ROOT, `logs/reply-dry-${t.id}.png`) }); continue; }
      await thread.locator('#submit-button:not([disabled])').filter({ visible: true }).first().click();
      await page.waitForTimeout(5000);
      // 화면: 방금 단 답글의 작성자가 우리 채널인가
      const authors = await thread.locator('ytd-comment-view-model #author-text, ytd-comment-renderer #author-text').allInnerTexts();
      const handle = (ch.customUrl ?? '').replace(/^@?/, '@').toLowerCase();
      if (!authors.some((a) => a.trim().toLowerCase() === handle || a.trim() === ch.title)) throw new Error(`답글 작성자가 채널(${handle})이 아니다: ${authors.slice(0, 4).join(', ')}`);
      // 공개 읽기(로그아웃과 같은 값)로 한 번 더
      await page.waitForTimeout(10000);
      const rr = await yt.comments.list({ part: ['snippet'], parentId: t.id, maxResults: 50 });
      const mine = (rr.data.items ?? []).find((c) => c.snippet.authorChannelId?.value === ch.id);
      if (!mine) throw new Error('올렸는데 공개 목록에 우리 답글이 없다');
      mark(t, 'replied', { reply, replyId: mine.id });
      log(`✅ ${t.videoId} · "${t.text.slice(0, 30)}" → ${reply}`);
    } catch (e) {
      mark(t, 'failed', { why: String(e?.message ?? e).slice(0, 120), reply });
      log(`❌ ${t.id}: ${String(e?.message ?? e).slice(0, 120)}`);
      await page.screenshot({ path: resolve(ROOT, `logs/reply-fail-${t.id}.png`) }).catch(() => {});
    }
  }
} finally {
  await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 30000))]);
  plock.release();
}
process.exit(0);
