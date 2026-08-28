#!/usr/bin/env node
/**
 * youtube-studio.mjs — YouTube Studio 브라우저 자동화.
 *
 * API 로 못 바꾸는 것(채널 이름·핸들·프로필 사진·배너)만 여기서 한다.
 * 브라우저 프로필은 **Flow 와 따로** 둔다 — Flow 는 spinaiceo 계정이고,
 *   채널 소유 계정은 다르다. 한 프로필에 섞으면 어느 계정으로 무엇을 했는지 알 수 없다.
 *
 * 사용:
 *   node scripts/youtube-studio.mjs --login          로그인용으로 열어 두기(사람이 로그인)
 *   node scripts/youtube-studio.mjs --check          어느 계정·어떤 채널이 잡히는지 확인
 *   node scripts/youtube-studio.mjs --apply          이름·핸들·이미지 적용
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { resolveMediaRoot } from './lib/media-root.mjs';
import { envValue } from './lib/footage.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const PROFILE = resolve(ROOT, 'secrets/youtube-profile');
const CHANNEL = arg('--channel', envValue('YOUTUBE_CHANNEL_ID'));
if (!CHANNEL) { console.error('❌ 채널 ID 없음 — .env.local 의 YOUTUBE_CHANNEL_ID 또는 --channel'); process.exit(1); }

mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: null,
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/**
 * 지금 이 프로필이 대상 채널을 편집할 수 있는가.
 *
 * ⚠ **사람이 쓰고 있는 탭을 건드리면 안 된다.** 처음엔 같은 탭을 15초마다 studio 로
 *   이동시켜 확인했는데, 그 바람에 로그인 도중 화면이 계속 초기화됐다(2026-08-28).
 *   확인은 별도 탭에서 조용히 한다.
 */
async function canEdit(target = null) {
  const p = target ?? page;
  await p.goto(`https://studio.youtube.com/channel/${CHANNEL}/editing/images`,
    { waitUntil: 'commit', timeout: 60_000 }).catch(() => {});
  await p.waitForTimeout(8000);
  const txt = await p.evaluate(() => document.body.innerText || '').catch(() => '');
  const url = p.url();
  // **긍정 증거를 요구한다.** 처음엔 "명백히 나쁘지 않으면 ok" 로 짰는데,
  //   로딩 중 빈 화면을 성공으로 읽어 로그인 도중에 브라우저를 닫아버렸다(2026-08-28).
  //   "나쁘지 않다" 와 "좋다" 는 다르다.
  if (!/studio\.youtube\.com/.test(url)) return { ok: false, why: `Studio 가 아니다 (${url.slice(0, 60)})` };
  if (/권한이 없습니다|don't have permission|Access denied/i.test(txt)) return { ok: false, why: '이 계정은 이 채널의 권한이 없다' };
  if (/이메일 또는 휴대전화|Email or phone|비밀번호 입력|Enter your password/i.test(txt)) return { ok: false, why: '로그인 화면이다' };
  // 브랜딩 화면이 실제로 그려졌는가 — 문구와 파일 입력 둘 다 본다.
  const hasUi = /배너 이미지|Banner image|프로필 사진|Picture|워터마크|Video watermark/i.test(txt);
  const hasFile = await p.evaluate(() => document.querySelectorAll('input[type=file]').length > 0).catch(() => false);
  if (!hasUi && !hasFile) return { ok: false, why: `브랜딩 화면이 안 보인다 (본문 ${txt.trim().length}자)` };
  return { ok: true, why: null };
}

async function whoami() {
  await page.goto('https://myaccount.google.com/', { waitUntil: 'commit', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(7000);
  const txt = await page.evaluate(() => document.body.innerText || '').catch(() => '');
  return [...new Set(txt.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [])].join(', ') || '(못 읽음)';
}

if (argv.includes('--login')) {
  // **로그인 중에는 브라우저를 일절 건드리지 않는다.**
  //   처음엔 같은 탭을 15초마다 studio 로 옮겨 확인했고(로그인 화면이 초기화됐다),
  //   그다음엔 확인용 탭을 따로 열었는데 그것도 구글 로그인 흐름을 되돌렸다(2026-08-28).
  //   자동화가 페이지를 만지는 한 로그인은 계속 처음으로 돌아간다.
  //   그래서 확인을 **파일 신호**로 바꾼다 — 사람이 끝났다고 하면 그때 파일이 생긴다.
  const DONE = resolve(ROOT, 'secrets/.studio-login-done');
  if (existsSync(DONE)) { try { (await import('fs')).unlinkSync(DONE); } catch { /* noop */ } }
  log(`로그인 대기 — 브라우저에서 ${arg('--as', '대상 계정')} 으로 로그인하라.`);
  log('  브라우저는 건드리지 않는다. 다 되면 알려주면 확인한다.');
  await page.goto('https://accounts.google.com/ServiceLogin?service=youtube',
    { waitUntil: 'commit', timeout: 60_000 }).catch(() => {});
  const deadline = Date.now() + Number(arg('--wait', '1800')) * 1000;
  const { existsSync: ex } = await import('fs');
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    if (ex(DONE)) { log('신호 받음 — 확인한다'); break; }
    if (ctx.pages().length === 0) { log('브라우저가 닫혔다'); break; }
  }
  const r = await canEdit().catch((e) => ({ ok: false, why: e.message.slice(0, 60) }));
  log('편집 권한:', r.ok ? '✅ YES' : `❌ NO — ${r.why}`);
  log('계정:', await whoami().catch(() => '(못 읽음)'));
  await ctx.close().catch(() => {});
  process.exit(r.ok ? 0 : 1);
}

if (argv.includes('--check')) {
  log('계정:', await whoami());
  const r = await canEdit();
  log('편집 권한:', r.ok ? 'YES' : `NO — ${r.why}`);
  await ctx.close();
  process.exit(r.ok ? 0 : 1);
}

if (argv.includes('--probe')) {
  for (const [name, path] of [['브랜딩(이미지)', 'editing/images'], ['기본정보', 'editing/details']]) {
    await page.goto(`https://studio.youtube.com/channel/${CHANNEL}/${path}`,
      { waitUntil: 'commit', timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(9000);
    log(`===== ${name} =====`);
    const dump = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const t = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      return {
        buttons: [...document.querySelectorAll('button, tp-yt-paper-button, ytcp-button')]
          .filter(vis).map((b, i) => `${i}: ${t(b)}${b.id ? ` #${b.id}` : ''}`).filter((x) => x.length > 3),
        files: [...document.querySelectorAll('input[type=file]')].map((el, i) => `${i}: accept=${el.accept} id=${el.id}`),
        texts: [...document.querySelectorAll('input[type=text], textarea, #textbox')]
          .filter(vis).map((el, i) => `${i}: id=${el.id} name=${el.name || ''} value="${String(el.value || el.textContent || '').slice(0, 40)}"`),
      };
    }).catch((e) => ({ err: e.message }));
    log('버튼:', JSON.stringify(dump.buttons?.slice(0, 40), null, 0));
    log('파일입력:', JSON.stringify(dump.files));
    log('텍스트입력:', JSON.stringify(dump.texts));
  }
  await ctx.close();
  process.exit(0);
}

if (argv.includes('--apply')) {
  const MEDIA = resolveMediaRoot({
    configured: envValue('MEDIA_ROOT'),
    localFallback: resolve(ROOT, 'reports/video'),
    allowLocal: argv.includes('--local-media'),
  });
  const brand = (f) => resolve(MEDIA.root, 'brand', f);
  const AVATAR = arg('--avatar', brand('avatar-800.png'));
  const BANNER = arg('--banner', brand('banner-2560x1440.png'));
  const NAME = arg('--name', 'Flowvium');
  const HANDLE = arg('--handle', '');           // 비우면 핸들은 건드리지 않는다

  const shot = async (tag) => {
    const f = resolve(ROOT, `reports/studio-${tag}.png`);
    await page.screenshot({ path: f }).catch(() => {});
    log('  화면:', f);
  };

  await page.goto(`https://studio.youtube.com/channel/${CHANNEL}/editing/images`,
    { waitUntil: 'commit', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(12_000);
  const r0 = await canEdit();
  if (!r0.ok) { log('❌ 편집할 수 없다 —', r0.why); await ctx.close(); process.exit(1); }

  /**
   * 제목이 붙은 구역 안의 파일 입력을 찾아 넣는다.
   * 파일 입력 3개(사진·배너·워터마크)가 **id 가 전부 같아서**(#file-selector) 순서로 고르면
   *   언젠가 배너 자리에 프로필이 들어간다. 구역 제목으로 짚는다.
   */
  const uploadInto = async (heading, file) => {
    if (!existsSync(file)) { log(`  ⚠ 파일 없음: ${file}`); return false; }
    const sec = page.locator('ytcp-form-file-picker, #picture-section, #banner-section, div')
      .filter({ hasText: new RegExp(heading) }).last();
    const input = sec.locator('input[type=file]').last();
    if (!(await input.count().catch(() => 0))) { log(`  ⚠ "${heading}" 구역의 파일 입력을 못 찾았다`); return false; }
    await input.setInputFiles(file).catch((e) => log('  업로드 실패:', e.message.slice(0, 60)));
    await page.waitForTimeout(6000);
    // 자르기 대화상자가 뜨면 완료를 누른다.
    for (const label of ['완료', 'Done', '저장', 'Save']) {
      const b = page.locator(`ytcp-button:has-text("${label}"), button:has-text("${label}")`).last();
      if (await b.count().catch(() => 0)) { await b.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(3000); break; }
    }
    log(`  ✅ ${heading} ← ${file.split('/').pop()}`);
    return true;
  };

  await uploadInto('사진|Picture', AVATAR);
  await uploadInto('배너 이미지|Banner image', BANNER);
  await shot('images');

  const pub = page.locator('#publish-button').last();
  if (await pub.count().catch(() => 0)) {
    await pub.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(8000);
    log('  게시 눌렀다');
  } else log('  ⚠ 게시 버튼을 못 찾았다');
  await shot('published');

  // ── 이름·핸들 ──────────────────────────────────────────────────────────────
  await page.goto(`https://studio.youtube.com/channel/${CHANNEL}/editing/details`,
    { waitUntil: 'commit', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(12_000);
  const fields = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return [...document.querySelectorAll('input[type=text], textarea, #textbox')]
      .filter(vis).map((el, i) => ({ i, id: el.id || '', value: String(el.value ?? el.textContent ?? '').slice(0, 50) }));
  }).catch(() => []);
  log('  기본정보 입력칸:', JSON.stringify(fields));
  await shot('details');
  log('  이름·핸들은 화면을 보고 다음 단계에서 넣는다 — 어느 칸인지 확인되기 전에는 쓰지 않는다.');

  await ctx.close();
  process.exit(0);
}

console.error('❌ --login / --check / --probe / --apply 중 하나가 필요하다');
await ctx.close();
process.exit(1);
