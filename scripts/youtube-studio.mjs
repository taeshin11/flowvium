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
import { currentChannel } from './lib/youtube.mjs';

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
    // 파일 입력 3개(배너·사진·워터마크)의 id 가 전부 #file-selector 라 순서로 고를 수 없다.
    //   화면 순서도 **배너가 위, 사진이 아래**여서 직관과 반대다(실측 2026-08-28).
    //   각 입력에서 위로 올라가며 만나는 첫 제목으로 짚는다.
    const idx = await page.evaluate((h) => {
      const re = new RegExp(h);
      const heads = [...document.querySelectorAll('h1,h2,h3,h4,div,span')]
        .filter((e) => e.children.length === 0 && re.test((e.textContent || '').trim()));
      const inputs = [...document.querySelectorAll('input[type=file]')];
      let best = -1, bestDist = Infinity;
      inputs.forEach((inp, i) => {
        // 입력이 속한 카드의 시작 위치와 제목 위치의 세로 거리로 짝짓는다.
        const ir = inp.closest('ytcp-form-file-picker, div')?.getBoundingClientRect();
        if (!ir) return;
        for (const hd of heads) {
          const hr = hd.getBoundingClientRect();
          const d = ir.top - hr.top;
          if (d >= 0 && d < bestDist) { bestDist = d; best = i; }
        }
      });
      return best;
    }, heading).catch(() => -1);
    if (idx < 0) { log(`  ⚠ "${heading}" 구역의 파일 입력을 못 찾았다`); return false; }
    log(`  "${heading}" → 파일입력 #${idx}`);
    const input = page.locator('input[type=file]').nth(idx);
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

  if (!argv.includes('--skip-images')) {
    await uploadInto('사진|Picture', AVATAR);
    await uploadInto('배너 이미지|Banner image', BANNER);
    await shot('images');
  } else log('  이미지는 건너뛴다(--skip-images)');

  if (!argv.includes('--skip-images')) {
    const pub = page.locator('#publish-button').last();
    if (await pub.count().catch(() => 0)) {
      await pub.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(8000);
      log('  게시 눌렀다');
    } else log('  ⚠ 게시 버튼을 못 찾았다');
    await shot('published');
  }

  // ── 이름·핸들 ──────────────────────────────────────────────────────────────
  // 이름·핸들도 **같은 맞춤설정 페이지**의 아래쪽에 있다(별도 /editing/details 가 아니다).
  //   화면 밖에 있으면 보이지 않아 못 찾으므로 끝까지 스크롤한 뒤 짚는다.
  await page.goto(`https://studio.youtube.com/channel/${CHANNEL}/editing/images`,
    { waitUntil: 'commit', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(12_000);
  for (let k = 0; k < 6; k++) {
    await page.mouse.wheel(0, 1200).catch(() => {});
    await page.waitForTimeout(900);
  }
  const fields = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return [...document.querySelectorAll('input, textarea, [contenteditable=true], #textbox')]
      .filter(vis).map((el, i) => {
        // 이 칸이 어느 항목인지 — 위로 올라가며 만나는 가장 가까운 제목.
        const r = el.getBoundingClientRect();
        let label = '';
        let bestD = Infinity;
        for (const h of document.querySelectorAll('h1,h2,h3,h4,div,span')) {
          if (h.children.length) continue;
          const t = (h.textContent || '').trim();
          if (!t || t.length > 20) continue;
          const hr = h.getBoundingClientRect();
          const d = r.top - hr.top;
          if (d >= 0 && d < bestD) { bestD = d; label = t; }
        }
        return { i, label, tag: el.tagName, id: el.id || '',
                 value: String(el.value ?? el.textContent ?? '').slice(0, 40) };
      });
  }).catch(() => []);
  log('  입력칸:', JSON.stringify(fields));
  await shot('details');

  /**
   * **현재 값으로** 칸을 특정해 바꾼다.
   *
   * 라벨(가장 가까운 제목)로 짚었더니 스크롤 위치에 따라 "이름" 이 "의견 보내기" 로 잡혔다.
   *   화면 좌표에 기대는 판정은 흔들린다. 지금 들어 있는 값은 흔들리지 않는다.
   *
   * 입력은 focus + 전체선택 + insertText 로 한다.
   *   click 후 Meta+A 는 **문서 전체**를 선택했고, fill() 은 30초 타임아웃이 났다(2026-08-28).
   * 넣은 뒤 반드시 읽어서 확인한다 — "입력했다" 와 "들어갔다" 는 다르다.
   */
  const setByValue = async (currentValue, value, what) => {
    const all = page.locator('input');
    const n = await all.count().catch(() => 0);
    let target = -1;
    for (let i = 0; i < n; i++) {
      const v = await all.nth(i).inputValue().catch(() => null);
      // 대소문자는 무시한다. API 는 핸들을 소문자(@dreliot_en)로 주는데
      //   입력칸에는 원래 대소문자(dreliot_EN)가 들어 있다(2026-08-28 실측).
      if (v != null && v.toLowerCase() === String(currentValue).toLowerCase()) { target = i; break; }
    }
    if (target < 0) { log(`  ⚠ ${what} 칸을 못 찾았다(현재값 "${currentValue}") — 쓰지 않는다`); return false; }
    const el = all.nth(target);
    await el.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    await el.evaluate((node) => { node.focus(); node.setSelectionRange(0, node.value.length); }).catch(() => {});
    await page.keyboard.insertText(value).catch((e) => log(`  ${what} 입력 실패:`, e.message.slice(0, 60)));
    await page.waitForTimeout(1500);
    const after = await el.inputValue().catch(() => null);
    if (after !== value) { log(`  ⚠ ${what} 반영 안 됨 — 기대 "${value}", 실제 "${after}"`); return false; }
    log(`  ${what}: "${currentValue}" → "${after}" ✅`);
    return true;
  };

  const cur = await currentChannel();
  /**
   * 채널 링크(배너 아래에 뜨는 것)를 추가한다. API 로는 못 넣는다.
   * 이미 같은 URL 이 있으면 건너뛴다 — 돌릴 때마다 링크가 쌓이면 안 된다.
   */
  const addLink = async (title, url) => {
    // 본문 전체를 훑으면 **설명란에 적어 둔 같은 주소**가 잡힌다(2026-08-28 오탐).
    //   링크 칸(값이 http 로 시작하는 입력)만 본다. 채널 URL 칸은 youtube.com 이라 안 겹친다.
    const host = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const already = await page.evaluate((h) => [...document.querySelectorAll('input')]
      .some((el) => /^https?:\/\//.test(el.value || '') && el.value.includes(h)), host).catch(() => false);
    if (already) { log(`  링크 이미 있다: ${url}`); return false; }
    const btn = page.locator('ytcp-button:has-text("링크 추가"), button:has-text("링크 추가"), ytcp-button:has-text("ADD LINK")').last();
    if (!(await btn.count().catch(() => 0))) { log('  ⚠ "링크 추가" 버튼을 못 찾았다'); return false; }
    await btn.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    await btn.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    // 새로 생긴 빈 입력 두 개(제목·URL)를 값이 빈 것으로 찾는다.
    const inputs = page.locator('input');
    const n = await inputs.count().catch(() => 0);
    const empty = [];
    for (let i = 0; i < n; i++) {
      const el = inputs.nth(i);
      const v = await el.inputValue().catch(() => null);
      const vis = await el.isVisible().catch(() => false);
      const ro = await el.evaluate((x) => x.readOnly || x.disabled).catch(() => true);
      if (vis && !ro && v === '') empty.push(i);
    }
    if (empty.length < 2) { log(`  ⚠ 링크 입력칸을 못 찾았다(빈 칸 ${empty.length}개)`); return false; }
    for (const [idx, val, what] of [[empty[0], title, '링크 제목'], [empty[1], url, '링크 URL']]) {
      const el = inputs.nth(idx);
      await el.evaluate((x) => { x.focus(); x.setSelectionRange(0, x.value.length); }).catch(() => {});
      await page.keyboard.insertText(val).catch(() => {});
      await page.waitForTimeout(900);
      const got = await el.inputValue().catch(() => null);
      if (got !== val) { log(`  ⚠ ${what} 반영 안 됨 — 기대 "${val}", 실제 "${got}"`); return false; }
    }
    log(`  링크 추가: "${title}" → ${url} ✅`);
    return true;
  };

  const nameOk = cur.title === NAME ? (log('  이름 이미 맞다'), false)
    : await setByValue(cur.title, NAME, '이름');
  const curHandle = String(cur.customUrl ?? '').replace(/^@/, '');
  const handleOk = !HANDLE || curHandle.toLowerCase() === HANDLE.toLowerCase()
    ? (HANDLE ? (log('  핸들 이미 맞다'), false) : false)
    : await setByValue(curHandle, HANDLE, '핸들');
  const SITE = arg('--site', 'https://flowvium.net');
  const linkOk = argv.includes('--no-link') ? false : await addLink('Flowvium', SITE);

  if (nameOk || handleOk || linkOk) {
    const pub2 = page.locator('#publish-button').last();
    if (await pub2.count().catch(() => 0)) {
      await pub2.click({ timeout: 8000 }).catch(() => {});
      // 눌렀다고 끝난 게 아니다. 게시 버튼이 **비활성으로 돌아갈 때까지** 기다린다 —
      //   8초만 기다렸더니 버튼이 아직 활성인 채로 끝나 핸들이 반영되지 않았다(2026-08-28).
      let settled = false;
      for (let k = 0; k < 15; k++) {
        await page.waitForTimeout(4000);
        const disabled = await pub2.evaluate((n) => n.hasAttribute('disabled') || n.getAttribute('aria-disabled') === 'true')
          .catch(() => false);
        if (disabled) { settled = true; break; }
      }
      log(settled ? '  게시 완료(버튼 비활성 확인)' : '  ⚠ 게시 버튼이 계속 활성 — 반영 안 됐을 수 있다');
      // 화면에 오류 문구가 떴는지 본다(핸들 중복·변경 횟수 초과 등).
      const err = await page.evaluate(() => {
        const t = document.body.innerText || '';
        const m = t.match(/[^\n]*(사용할 수 없|이미 사용|already taken|Try another|오류|error)[^\n]*/i);
        return m ? m[0].trim().slice(0, 120) : null;
      }).catch(() => null);
      if (err) log('  화면 메시지:', err);
    }
    await shot('details-published');
  }

  await ctx.close();
  process.exit(0);
}

console.error('❌ --login / --check / --probe / --apply 중 하나가 필요하다');
await ctx.close();
process.exit(1);
