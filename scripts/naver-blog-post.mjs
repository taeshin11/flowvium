#!/usr/bin/env node
/**
 * naver-blog-post.mjs — 블로그 글(마크다운)을 **네이버 블로그 'AI주식분석' 카테고리**에 올린다. 2026-10-26 신설.
 *
 * 왜: 사장님 10/26 "taeshin11@naver.com … AI주식분석 메뉴 하나 만들어서 거기다가 flowvium 보고서랑 분석 결과
 *   이런거 계속 하루 한번 올려라" + "이런 전향적 분석은 제목 따로 해서 다른글로 또 올리고".
 *   네이버는 글쓰기 API 가 없다 → 전용 프로필(secrets/naver-profile, naver-login.mjs 로 1회 로그인)로 스마트에디터를 직접 쓴다.
 *   약관상 자동 게재는 제재 위험 — 사장님이 '완전 자동(제재 위험 감수)' 을 골랐다(10/26).
 *
 * 무엇을 올리나
 *   --daily     오늘(KST) 아침 브리핑 reports/blog/<오늘>-morning.md 한 편. 없으면 아무것도 안 올린다(지난 글을 끌어오지 않는다).
 *   --analysis  reports/blog/analysis/*.md 중 아직 안 올린 글(제목이 따로 있는 분석 글).
 *   --file <md> 그 파일 한 편.
 * 같은 글을 두 번 올리지 않는다: reports/blog/.naver-published.json 에 남긴다.
 * --dry-run 은 발행 창에서 카테고리까지 고른 뒤 **발행을 누르지 않고** 화면을 찍고 닫는다.
 * --update 는 이미 올린 글(--file)을 **같은 주소에서** 본문만 바꿔 다시 발행한다(지우고 새로 올리지 않는다 — 주소·공감·댓글 유지).
 *
 * 사용: node scripts/naver-blog-post.mjs (--daily | --analysis | --file <md> [--update]) [--dry-run]
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, basename, resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { mdToHtml, extractTitle, stripFrontComment } from './lib/blog-html.mjs';
import { checkQuality } from './lib/blog-quality.mjs';
import { kstDate } from './lib/scorecard.mjs';
import { NAVER_CATEGORY as CATEGORY, naverHtml, tagsFor, pickFiles, postedLogNo } from './lib/naver-blog.mjs';

const PROFILE = join(ROOT, 'secrets/naver-profile');
const BLOG_JSON = join(ROOT, 'secrets/naver-blog.json');
const DIR = join(ROOT, 'reports/blog');
const LEDGER = join(DIR, '.naver-published.json');
const SHOTS = join(ROOT, 'logs/naver-blog');
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const has = (n) => process.argv.includes(`--${n}`);
const DRY = has('dry-run');
const UPDATE = has('update');
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[naver-blog]', ...a);

const blogId = existsSync(BLOG_JSON) ? JSON.parse(readFileSync(BLOG_JSON, 'utf8')).blogId : null;
if (!blogId) { console.error('❌ 블로그 아이디 없음 — node scripts/naver-login.mjs 로 먼저 로그인'); process.exit(2); }
let ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
if (UPDATE && !arg('file')) { console.error('❌ --update 는 --file 과 같이 쓴다'); process.exit(2); }
const todo = arg('file')
  ? [{ file: resolve(arg('file')), key: arg('file').includes('/analysis/') ? `analysis/${basename(arg('file'))}` : basename(arg('file')) }]
  : pickFiles({
    dir: DIR, today: kstDate(Date.now()), exists: existsSync, ledger, force: DRY,
    daily: has('daily'), wantAnalysis: has('analysis'),
    analysis: existsSync(join(DIR, 'analysis')) ? readdirSync(join(DIR, 'analysis')).filter((n) => n.endsWith('.md')) : [],
  });
if (!todo.length) { log('올릴 새 글이 없다'); process.exit(0); }

mkdirSync(SHOTS, { recursive: true });
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, channel: 'chrome', viewport: { width: 1300, height: 1000 }, locale: 'ko-KR' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://blog.naver.com' });
let failed = 0;
try {
  if (!(await ctx.cookies('https://naver.com')).some((c) => c.name === 'NID_AUT')) {
    throw new Error('로그인이 풀렸다 — node scripts/naver-login.mjs 로 다시 로그인 필요');
  }
  for (const { file, key } of todo) {
    const md = readFileSync(file, 'utf8');
    const title = extractTitle(md);
    if (!title) { log(`⚠ 제목이 없어 건너뛴다: ${key}`); continue; }
    if (!key.startsWith('analysis/')) {
      // 하루 브리핑은 Blogger 와 같은 저품질 관문을 거친다. 비교 대상은 네이버에 이미 올린 글.
      const prev = Object.keys(ledger).filter((k) => k !== key && ledger[k]?.url)
        .map((k) => { try { return readFileSync(join(DIR, k), 'utf8'); } catch { return ''; } }).filter(Boolean);
      const q = checkQuality(md, prev);
      if (!q.ok) { log(`⚠ 저품질로 판단해 올리지 않는다: ${key} — ${q.issues.join(' / ')}`); continue; }
    }
    try {
      const logNo = UPDATE ? (/\/(\d{9,})$/.exec(ledger[key]?.url ?? '') ?? [])[1] : null;
      if (UPDATE && !logNo) throw new Error('고칠 글의 주소가 기록에 없다');
      if (!UPDATE && ledger[key]?.url && !DRY) { log(`이미 올린 글이다(${ledger[key].url}) — 고치려면 --update`); continue; }
      const r = await postOne(ctx, { key, title, html: naverHtml(mdToHtml(stripFrontComment(md))), md, tags: tagsFor(key, md), logNo });
      if (r.url) {
        ledger[key] = { ...ledger[key], url: r.url, title, ...(logNo ? { updatedAt: new Date().toISOString() } : { at: new Date().toISOString() }) };
        writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
      }
    } catch (e) {
      failed += 1;
      log(`❌ ${key}: ${e.message}`);
    }
  }
} finally {
  await ctx.close();
}
process.exit(failed ? 1 : 0);

/** 글 하나를 스마트에디터에 채우고 발행한다. 발행 뒤에는 글 주소를 열어 제목이 보이는지 확인한다. */
async function postOne(ctx, { key, title, html, md, tags, logNo: editNo = null }) {
  const page = await ctx.newPage();
  // '작성 중인 글이 있습니다' 같은 브라우저 대화상자는 이어 쓰지 않는다(취소).
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const shot = (n) => page.screenshot({ path: join(SHOTS, `${key.replace(/\W+/g, '_')}-${n}.png`) });
  try {
    await page.goto(editNo ? `https://blog.naver.com/${blogId}/postupdate?logNo=${editNo}` : `https://blog.naver.com/${blogId}/postwrite`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.se-documentTitle', { timeout: 30000 });
    // 임시저장 글 이어쓰기 안내 → 새로 쓴다. 도움말 패널은 닫는다.
    const cancel = page.locator('.se-popup-button-cancel');
    if (await cancel.count()) await cancel.first().click();
    const help = page.locator('.se-help-panel-close-button');
    if (await help.count() && await help.first().isVisible()) await help.first().click();

    if (editNo) {
      // 고치기: 제목은 그대로 두고 본문 전체를 골라 새 본문으로 덮는다.
      const cur = (await page.locator('.se-documentTitle').innerText()).trim();
      if (cur !== title) { await page.locator('.se-documentTitle .se-text-paragraph').first().click(); await page.keyboard.press('Meta+A'); await page.keyboard.insertText(title); }
    } else {
      await page.locator('.se-documentTitle .se-text-paragraph').first().click();
      await page.keyboard.insertText(title);
    }

    // 본문은 실제 붙여넣기로 넣는다. 합성 paste 이벤트는 편집기가 무시한다(10/26 실측: 본문 빈 채로 남음).
    //   헤드리스 크롬의 클립보드는 브라우저 안에만 있다 — 맥의 클립보드는 안 건드린다(pbpaste 전후 같음 확인).
    await page.locator('.se-component:not(.se-documentTitle) .se-text-paragraph').first().click();
    if (editNo) { await page.keyboard.press('Meta+A'); await page.keyboard.press('Meta+A'); await page.keyboard.press('Backspace'); await page.waitForTimeout(500); }
    await page.evaluate(async (h) => {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([h], { type: 'text/html' }),
        'text/plain': new Blob([h.replace(/<[^>]+>/g, ' ')], { type: 'text/plain' }),
      })]);
    }, html);
    await page.keyboard.press('Meta+V');
    await page.waitForTimeout(3000);

    // 붙여 넣은 본문이 실제로 들어갔는지 — 본문 문장 몇 개가 편집기에 보여야 한다.
    const probes = stripFrontComment(md).split('\n').filter((l) => /^[가-힣A-Za-z]/.test(l) && l.length > 25).slice(0, 3).map((l) => l.slice(0, 18));
    const body = await page.locator('.se-content').innerText();
    const missing = probes.filter((p) => !body.includes(p));
    if (!body.includes(title) || missing.length) { await shot('fill-fail'); throw new Error(`본문이 덜 들어갔다: ${missing.join(' | ') || '제목'}`); }
    // 고치기에서 옛 본문이 남으면 같은 문장이 두 번 나온다.
    const twice = probes.filter((p) => body.split(p).length > 2);
    if (twice.length) { await shot('fill-dup'); throw new Error(`옛 본문이 남았다: ${twice.join(' | ')}`); }
    log(`${key}: 제목·본문 채움 (${body.length}자)`);
    // 편집기는 안쪽 상자가 스크롤된다(전체 화면 찍기로는 첫 화면만 나온다) — 그 상자를 내려가며 찍는다.
    const scroller = () => [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    await page.evaluate(`(${scroller})()?.scrollTo(0, 0)`);
    for (let i = 0, more = true; more && i < 12; i += 1) {
      await shot(`body${i}`);
      more = await page.evaluate((src) => {
        const el = eval(src)();
        if (!el) return false;
        const before = el.scrollTop; el.scrollTop += el.clientHeight - 120; return el.scrollTop > before;
      }, `(${scroller})`);
      await page.waitForTimeout(300);
    }

    await page.locator('button[class*=publish_btn]').first().click();
    const panel = page.locator('[class*=layer_publish]');
    await panel.waitFor({ timeout: 15000 });
    await panel.locator('button[class*=selectbox_button]').first().click();
    await panel.getByText(CATEGORY, { exact: true }).first().click();
    await page.waitForTimeout(500);
    const chosen = (await panel.locator('button[class*=selectbox_button]').first().innerText()).trim();
    if (!chosen.includes(CATEGORY)) { await shot('category-fail'); throw new Error(`카테고리 선택 실패: ${chosen}`); }
    const tagBox = panel.locator('input[placeholder*="태그"]').first();
    for (const t of editNo ? [] : tags) { await tagBox.click(); await page.keyboard.insertText(t); await page.keyboard.press('Enter'); }
    const tagText = await panel.innerText();
    const lostTags = tags.filter((t) => !tagText.includes(t));
    if (lostTags.length) log(`⚠ 태그가 안 붙었다: ${lostTags.join(', ')}`);
    await shot('panel');
    if (DRY) { log(`${key}: 발행 직전까지 확인(--dry-run) — 카테고리 ${chosen}`); return {}; }

    await panel.locator('button[class*=confirm_btn]').first().click();
    await page.waitForURL((u) => postedLogNo(u.href) != null, { timeout: 60000 });
    const logNo = postedLogNo(page.url());
    const url = `https://blog.naver.com/${blogId}/${logNo}`;
    // 되읽기: 글 화면(PostView)에 제목이 실제로 보여야 올라간 것으로 친다.
    await page.goto(`https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const seen = await page.locator('body').innerText();
    if (!seen.includes(title.slice(0, 20))) { await shot('verify-fail'); throw new Error(`발행 뒤 글에서 제목을 못 찾았다: ${url}`); }
    await shot('posted');
    log(`✅ ${key} → ${url}`);
    return { url };
  } finally {
    await page.close();
  }
}
