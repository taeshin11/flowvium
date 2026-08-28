/**
 * flow.mjs — Google Flow(labs.google/fx/tools/flow) 를 브라우저로 몬다.
 *
 * 왜 API 가 아닌가: 사용자는 Google AI Ultra 를 구독 중이고 거기에 Flow 크레딧 25,000/월이
 *   들어 있다. 그중 `Veo 3.1 Lite [Lower Priority]` 는 **0 크레딧**(느린 큐)이다.
 *   같은 Veo 를 Gemini API 로 부르면 초당 과금이라 8초 클립 × 8장면 = 편당 $10 수준이 된다.
 *   매일 발행하는 채널에서 그 차이는 구독을 쓰느냐 마느냐의 문제다.
 *
 * 왜 **전용 프로필**인가(이번 세션에 값비싸게 배운 것):
 *   사용자의 기존 Chrome 에 붙으려는 시도가 전부 실패했다 —
 *     · Chrome 136+ 는 기본 프로필에서 CDP 원격 디버깅을 **차단**한다.
 *     · 프로필 복사는 키체인에 묶인 쿠키 때문에 로그인이 안 따라온다.
 *     · AppleScript 로 "Apple Events JavaScript" 토글을 누르는 건 Chrome 이 거부한다.
 *     · 접근성/화면기록 권한은 VS Code 에 붙어 있어 노드에서 안 먹었다.
 *   전용 userDataDir 은 이 문제들을 통째로 우회한다. 대신 최초 1회 사람이 로그인해야 한다.
 *
 * 왜 channel:'chrome' 인가: 구글 로그인은 번들 Chromium 을 "안전하지 않은 브라우저" 로
 *   막는 경우가 있다. 실제 Chrome 바이너리를 쓰면 통과 확률이 올라간다.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

export const FLOW_URL = 'https://labs.google/fx/tools/flow';
export const PROFILE_DIR = resolve(ROOT, 'secrets/flow-profile');

/**
 * 전용 프로필로 브라우저를 연다. 로그인 세션은 이 디렉터리에 남는다.
 * @param {{headless?:boolean}} opts headless 는 생성 단계에서만. 로그인은 반드시 headed.
 */
export async function openFlow(opts = {}) {
  mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: opts.headless ?? false,
    viewport: null,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  return { ctx, page };
}

/**
 * 미디어 에디터 뷰에 들어와 있으면 빠져나온다.
 *
 * 실측 사고(2026-08-28): 프로젝트를 열면 앱이 **마지막에 보던 클립을 에디터로 복원**한다.
 *   에디터에는 자체 작성기가 있고 모델이 `Omni 1.1 Flash` 다 — 우리가 고정한 Veo 설정은
 *   에이전트 패널 것이라 여기엔 안 걸린다. 게다가 열려 있던 클립의 <video> 를
 *   새 결과로 오인해 **기존 클립을 내려받았다**.
 *
 * 판정은 "완료" 버튼 + 타임라인의 존재로 한다. URL 은 프로젝트 주소 그대로라 구분이 안 된다.
 */
export async function inEditor(page) {
  const done = await page.locator('button:has-text("완료"), button:has-text("Done")')
    .first().count().catch(() => 0);
  return done > 0;
}

export async function exitEditor(page, { tries = 3 } = {}) {
  for (let k = 0; k < tries; k++) {
    if (!(await inEditor(page))) return true;
    const b = page.locator('button:has-text("완료"), button:has-text("Done")').first();
    await b.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  return !(await inEditor(page));
}

/**
 * 프로젝트 화면까지 확실히 들어간다.
 *
 * 실측으로 겪은 것들:
 *   · 상단에 "일일 보너스" 배너가 뜨면 프로젝트 카드 클릭을 가로챈다 — 먼저 닫는다.
 *   · 쿠키 동의("Agree")가 남아 있으면 그 아래 UI 를 못 만진다.
 *   · 성공 판정은 **URL 에 /project/ 가 들어가는가** 다. 클릭했다 ≠ 들어갔다.
 * @returns {Promise<boolean>}
 */
export async function openProject(page) {
  await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(3500);
  for (const t of ['Agree', '동의', 'Accept all']) {
    const b = page.locator(`button:has-text("${t}")`).first();
    if (await b.count().catch(() => 0)) { await b.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1200); break; }
  }
  // 배너 닫기(있으면). 클릭 가로채기의 흔한 원인이다.
  for (const sel of ['button[aria-label*="닫기"]', 'button[aria-label*="Dismiss"]', 'button[aria-label*="Close"]']) {
    const b = page.locator(sel).first();
    if (await b.count().catch(() => 0)) { await b.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(800); }
  }
  const isIn = () => /\/project\//.test(page.url());
  if (isIn()) { await exitEditor(page); return true; }

  // 기존 프로젝트를 재사용한다. 매번 새로 만들면 목록이 쓰레기가 된다.
  const link = page.locator('a[href*="/project/"]').first();
  if (await link.count().catch(() => 0)) {
    const href = await link.getAttribute('href').catch(() => null);
    // 클릭이 가로채이는 경우가 있어 주소로 직접 간다 — 더 확실하다.
    if (href) await page.goto(new URL(href, page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    else await link.click({ timeout: 8000, force: true }).catch(() => {});
    await page.waitForTimeout(6000);
    // 에디터로 복원됐으면 빠져나온다 — 여기 작성기는 다른 모델을 쓴다.
    if (isIn()) { await exitEditor(page); return true; }
  }
  await page.locator('button:has-text("새 프로젝트"), button:has-text("New project")').first()
    .click({ timeout: 8000, force: true }).catch(() => {});
  await page.waitForTimeout(7000);
  if (isIn()) { await exitEditor(page); return true; }
  return false;
}

/** 지금 프로젝트 화면인가. 조작 중간중간 확인한다 — 나가버려도 URL 변수는 옛값을 들고 있다. */
export function inProject(page) {
  return /\/project\//.test(page.url());
}

/**
 * 랜딩 → 앱 진입. 로그인 안 돼 있으면 accounts.google.com 으로 튕긴다.
 * labs.google/fx/tools/flow 는 **로그인 여부와 무관하게 마케팅 랜딩을 보여준다** —
 *   그래서 "이 URL 에 있다" 는 로그인 신호가 아니다. 눌러 봐야 안다.
 */
export async function enterApp(page) {
  for (const t of ['Agree', 'Accept all', '동의', 'I agree']) {
    const b = page.locator(`button:has-text("${t}")`).first();
    if (await b.count().catch(() => 0)) { await b.click({ timeout: 4000 }).catch(() => {}); break; }
  }
  await page.waitForTimeout(1200);
  const enter = page.locator(
    'button:has-text("Create with Google Flow"), a:has-text("Create with Google Flow")',
  ).first();
  if (await enter.count().catch(() => 0)) {
    await enter.click({ timeout: 8000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(4000);
  }
  return page.url();
}

/**
 * 로그인 상태인가.
 *
 * DOM 으로 판정하려다 **세 번** 틀렸다(2026-08-27):
 *   1차 "Sign in 버튼이 없으면 로그인" — Flow 랜딩엔 그 버튼이 아예 없다.
 *   2차 "textarea 가 있으면 앱 화면"   — 랜딩에 숨겨진 textarea 가 있다.
 *   3차 "보이는 입력창이 있으면 앱"     — 사용자가 실제로 로그인했는데도 랜딩에 머물러 못 잡았다.
 * 랜딩 페이지는 로그인 여부와 무관하게 같은 모양이라 DOM 으로는 구분이 안 된다.
 *
 * 확실한 신호는 **프로필에 저장된 구글 세션 쿠키**다. 브라우저를 띄우지 않고도 읽을 수 있고,
 * 화면 상태(어느 탭에 있는지, 랜딩인지 앱인지)와 무관하다.
 */
export function sessionCookiesPresent() {
  const db = resolve(PROFILE_DIR, 'Default/Cookies');
  if (!existsSync(db)) return false;
  try {
    // Chrome 이 잡고 있을 수 있으니 읽기 전용으로 연다.
    const conn = new Database(db, { readonly: true, fileMustExist: true });
    const row = conn.prepare(
      "SELECT COUNT(*) n FROM cookies WHERE host_key LIKE '%google%' AND name IN "
      + "('SID','SSID','HSID','SAPISID','__Secure-1PSID','__Secure-3PSID')",
    ).get();
    conn.close();
    return (row?.n ?? 0) >= 3;   // 구글은 이 쿠키들을 한 벌로 심는다. 한두 개는 잔재일 수 있다.
  } catch { return false; }
}

/** 화면이 실제로 앱인가(프롬프트 입력창이 보이는가). 쿠키 판정과 역할이 다르다. */
export async function appReady(page) {
  const n = await page.locator('textarea:visible, [contenteditable="true"]:visible').count().catch(() => 0);
  return n > 0 && /labs\.google/.test(page.url()) && !/accounts\.google\.com/.test(page.url());
}

/** 하위호환 별칭. 로그인 여부는 쿠키로, 앱 도달 여부는 appReady 로 본다. */
export async function isSignedIn(page) {
  return sessionCookiesPresent() || appReady(page);
}

// ── 생성 기본값(모델) ────────────────────────────────────────────────────────
//
// 패널은 상단 기어가 아니라 **프롬프트 입력창의 슬라이더(tune) 아이콘**이 연다.
//   기어는 "보기 모드"(그리드 크기)만 연다 — 실측으로 구분했다.
// 모델 목록 실측(2026-08-27):
//   Omni Flash / Veo 3.1 - Lite / Veo 3.1 - Fast / Veo 3.1 - Quality / Veo 3.1 - Lite [Lower Priority]

/**
 * 모델 설정 결과. 실패를 전부 빈 문자열로 뭉개면 호출부가 원인을 구분할 수 없다.
 * 실측(2026-08-28): 신기능 안내 모달이 화면을 덮어 tune 클릭이 타임아웃됐는데,
 *   화면에 뜬 메시지는 "0 크레딧 모델이 반영되지 않았다" 였다 — **모델 목록을 뒤지게 만드는 오진**.
 */
export const MODEL_RESULT = {
  OK: 'ok',
  PANEL_CLOSED: 'panel_closed',
  OPTION_MISSING: 'option_missing',
  NOT_APPLIED: 'not_applied',
};

const HINTS = {
  [MODEL_RESULT.OK]: '정상',
  [MODEL_RESULT.PANEL_CLOSED]: '생성 기본값 패널이 열리지 않았다 — 다른 모달이 화면을 덮고 있는지 스크린샷을 보라',
  [MODEL_RESULT.OPTION_MISSING]: '모델 목록에 그 항목이 없다 — Flow 가 모델 구성을 바꿨을 수 있다',
  [MODEL_RESULT.NOT_APPLIED]: '선택은 했는데 표시가 안 바뀐다 — 저장 버튼 또는 선택 클릭이 먹지 않았다',
};

/**
 * 이 실패는 **다시 시도하면 될 일**인가, 사람이 봐야 할 일인가.
 *
 * openai/codex 의 FunctionCallError 에서 차용했다 — 거기 에러는 딱 두 갈래다:
 *     RespondToModel(String)  다르게 시도할 수 있음
 *     Fatal(String)           중단
 *   축이 "무엇이 실패했나" 가 아니라 **"호출부가 뭘 할 수 있나"** 다.
 *   sst/opencode 도 에러 클래스의 message 가 "다음에 뭘 하라" 를 만들고,
 *   browser-use 의 ActionResult 는 error 를 계속 들고 다닌다("always include in long term memory").
 *
 * 내 코드엔 이 축이 없어서 호출부가 전부 중단으로 처리했다 — 안내 모달 하나에 작업이 죽었다.
 */
export function isRetryable(status) {
  return status === MODEL_RESULT.PANEL_CLOSED || status === MODEL_RESULT.NOT_APPLIED;
}

export function modelResult(status, shown = '') {
  return {
    status, shown,
    ok: status === MODEL_RESULT.OK,
    retryable: isRetryable(status),
    hint: HINTS[status] ?? '알 수 없음',
  };
}

/** 표시 문자열이 0 크레딧 모델인가. "Veo 3.1 - Lite" 는 그 접두사일 뿐 유료다. */
export function isFreeModel(shown) {
  return /\[\s*Lower Priority\s*\]/i.test(String(shown ?? ''));
}

/** 0 크레딧 모델. 다른 항목은 25,000/월 크레딧을 태운다. */
export const FREE_VIDEO_MODEL = 'Veo 3.1 - Lite [Lower Priority]';

async function openDefaults(page, { tries = 3 } = {}) {
  for (let k = 0; k < tries; k++) {
    // 모달이 덮고 있으면 클릭이 타임아웃된다. **먼저 치운다** — 이걸 안 해서 오진이 났다.
    await dismissDialogs(page);
    if (await defaultsPanelOpen(page)) break;
    const tune = page.locator('button:has-text("tune")').first();
    if (!(await tune.count().catch(() => 0))) {
      await page.locator('[contenteditable=true]:visible, textarea:visible').last()
        .click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
    await page.locator('button:has-text("tune")').first().click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(2000);
    if (await defaultsPanelOpen(page)) break;
  }
  return page.locator('button:has-text("Omni Flash"), button:has-text("Veo 3.1")').last();
}

/**
 * 설정 패널의 **이미지 모델** 드롭다운. 동영상 것과 같은 패널에 나란히 있다.
 * 실측(2026-08-28): 항목은 `🍌 Nano Banana Pro / 🍌 Nano Banana 2 / 🍌 Nano Banana 2 Lite`.
 *   **셋 다 크레딧 표시가 없고, 실제로 생성해도 잔량이 안 줄었다**(25030 → 25030).
 */
export const IMAGE_MODEL = 'Nano Banana 2';

async function openImageDrop(page) {
  await openDefaults(page);
  return page.locator('button:has-text("Nano Banana")').last();
}

/** 지금 지정된 이미지 모델 이름. */
export async function readImageModel(page) {
  const d = await openImageDrop(page);
  const t = (await d.innerText().catch(() => '')).replace(/\s+/g, ' ').replace('arrow_drop_down', '').trim();
  await closeDefaults(page);
  return t;
}

/**
 * 이미지 모델을 고른다. setVideoModel 과 같은 규칙이다 —
 *   **정확히 그 문자열인 항목만** 고른다. "Nano Banana 2" 는 "Nano Banana 2 Lite" 의 접두사다.
 * @returns {{status:string, shown:string, ok:boolean, retryable:boolean, hint:string}}
 */
export async function setImageModel(page, model = IMAGE_MODEL) {
  const drop = await openImageDrop(page);
  if (!(await drop.count().catch(() => 0))) {
    await closeDefaults(page);
    return modelResult(MODEL_RESULT.PANEL_CLOSED);
  }
  const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').replace('arrow_drop_down', '').replace(/^🍌\s*/, '').trim();
  let shown = norm(await drop.innerText().catch(() => ''));
  if (shown !== model) {
    await drop.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1800);
    const opt = page.locator('[role=option],[role=menuitem],[role=menuitemradio],li')
      .filter({ hasText: new RegExp(`^\\s*(?:🍌\\s*)?${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
    if (!(await opt.count().catch(() => 0))) {
      await closeDefaults(page);
      return modelResult(MODEL_RESULT.OPTION_MISSING, shown);
    }
    await opt.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const save = page.locator('button:has-text("저장"), button:has-text("Save")').first();
    if (await save.count().catch(() => 0)) { await save.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(2000); }
    shown = await readImageModel(page);
  }
  await closeDefaults(page);
  return modelResult(shown === model ? MODEL_RESULT.OK : MODEL_RESULT.NOT_APPLIED, shown);
}

/** 결과 영역의 이미지 URL. videoUrls 의 이미지판이다. */
export async function imageUrls(page) {
  return page.evaluate(() => [...document.querySelectorAll('img')]
    .map((e) => e.currentSrc || e.src)
    .filter((u) => u && !u.startsWith('data:'))).catch(() => []);
}

/**
 * 설정 패널을 닫는다. **판정 기준은 패널 자체**다.
 *
 * 처음엔 "작성기가 보이는가" 로 판정했는데, 그 판정이 다시 패널 상태를 보게 되어 논리가 꼬였다
 *   (작성기 판정 = 패널 닫힘 + 자리표시자 → 서로를 참조). 기준을 하나로 둔다.
 *
 * ⚠ 전역 "arrow_back" 을 누르면 안 된다 — 프로젝트 화면 좌상단의 "돌아가기" 가 걸려서
 *   프로젝트 목록으로 나가버린다. 패널은 오른쪽에 있으므로 **오른쪽 절반의 닫기 버튼만** 누른다.
 */
async function closeDefaults(page, { tries = 5 } = {}) {
  const w = await page.evaluate(() => window.innerWidth).catch(() => 1200);
  for (let k = 0; k < tries; k++) {
    if (!(await defaultsPanelOpen(page))) return true;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(700);
    if (!(await defaultsPanelOpen(page))) return true;
    const closers = page.locator('button:has-text("close"), button[aria-label*="닫기"], button[aria-label*="Close"]');
    const n = await closers.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const box = await closers.nth(i).boundingBox().catch(() => null);
      if (!box || box.x < w / 2) continue;          // 왼쪽 것은 프로젝트 나가기다
      await closers.nth(i).click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(900);
      if (!(await defaultsPanelOpen(page))) return true;
    }
    // 마지막 수단: 화면 왼쪽 빈 곳을 눌러 패널 밖 클릭으로 닫는다.
    await page.mouse.click(w * 0.25, 400).catch(() => {});
    await page.waitForTimeout(900);
  }
  return !(await defaultsPanelOpen(page));
}

/** 생성 기본값(에이전트 설정) 패널이 열려 있는가. 이게 열려 있으면 작성기를 덮는다. */
export async function defaultsPanelOpen(page) {
  return (await page.getByText(/에이전트 설정|생성하기 전에 확인|Agent settings/i).first()
    .count().catch(() => 0)) > 0;
}

/**
 * 작성기를 지금 쓸 수 있는가.
 *
 * 오탐 정정(2026-08-27): 전송 버튼 유무만 보다가, 설정 패널이 열려 작성기를 덮고 있는데도
 *   "보인다" 로 판정했다. 그 결과 패널을 안 닫고 진행해 입력이 통째로 실패했다.
 *   → **패널이 닫혀 있을 것**을 조건에 넣는다. 덮여 있으면 못 쓰는 것이다.
 */
export async function composerVisible(page) {
  if (await defaultsPanelOpen(page)) return false;
  const t = page.getByText(/무엇을 만들고 싶으신가요|What do you want to create/i).first();
  if (await t.count().catch(() => 0)) return true;
  return (await page.locator('button:has-text("arrow_forward"), button[aria-label*="보내기"], button[aria-label*="Send"]')
    .count().catch(() => 0)) > 0;
}

/**
 * 작성기에 프롬프트를 넣는다.
 *
 * 요소를 좌표로 잡을 수 없다 — 실측(2026-08-27): 작성기의 `div[contenteditable=true]` 와
 *   `textarea` 가 **둘 다 0×0** 이다(화면엔 보이는데 바운딩 박스가 없다).
 *   그래서 사람이 하듯 **자리표시자 글자를 눌러 포커스를 주고** 키보드로 친다.
 *
 * 그리고 친 뒤에 **실제로 들어갔는지 읽어서 확인한다.** 빈 프롬프트로 제출하면
 *   첨부만 있는 상태로 엉뚱한 결과가 나오거나 조용히 아무 일도 안 일어난다.
 * @returns {Promise<boolean>}
 */
export async function typePrompt(page, text) {
  // 시도 순서. 위에서부터 되는 게 나올 때까지 — 각 방식이 왜 필요한지는 실측 근거가 있다.
  const attempts = [
    // ① 요소에 **직접 포커스**. 작성기의 contenteditable 이 0×0 이라 클릭으로는 포커스가 안 간다.
    //    focus() 는 크기와 무관하게 동작하고, 이후 실제 키 이벤트를 보내므로 React 가 정상 인식한다.
    async () => page.evaluate(() => {
      const el = document.querySelector('div[contenteditable="true"]')
        ?? document.querySelector('textarea');
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    }).catch(() => false),
    // ② 자리표시자 글자 클릭.
    async () => {
      const t = page.getByText(/무엇을 만들고 싶으신가요|What do you want to create/i).first();
      if (!(await t.count().catch(() => 0))) return false;
      await t.click({ timeout: 6000 }).catch(() => {});
      return true;
    },
    // ③ 작성기 영역 좌표 클릭(최후).
    async () => {
      const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight })).catch(() => null);
      if (!size) return false;
      await page.mouse.click(size.w * 0.5, size.h * 0.86).catch(() => {});
      return true;
    },
  ];

  const read = () => page.evaluate(() => {
    const el = document.querySelector('div[contenteditable="true"]') ?? document.querySelector('textarea');
    return (el?.value ?? el?.innerText ?? el?.textContent ?? '').trim();
  }).catch(() => '');

  for (const attempt of attempts) {
    if (!(await attempt())) continue;
    await page.waitForTimeout(600);
    await page.keyboard.type(text, { delay: 6 }).catch(() => {});
    await page.waitForTimeout(900);
    // 친 뒤에 **읽어서 확인한다.** 빈 프롬프트로 제출하면 첨부만 있는 상태로 엉뚱한 게 나온다.
    const got = await read();
    if (got.includes(text.slice(0, 20))) return true;
  }
  return false;
}

/**
 * 업로드가 끝날 때까지 기다린다.
 * 타일에 진행률(20% …)이 떠 있는 동안 프롬프트를 보내면 첨부 없이 생성될 수 있다.
 */
export async function waitUpload(page, { timeoutMs = 90_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // 이전 실행에서 멈춘 타일이 남아 있을 수 있어 상한을 짧게 두고 치명적으로 다루지 않는다.
    const busy = await page.evaluate(() => /\b\d{1,3}%/.test(document.body.innerText ?? '')).catch(() => false);
    if (!busy) return true;
    await page.waitForTimeout(2000);
  }
  return false;
}

/**
 * 떠 있는 확인 모달을 닫는다.
 *
 * 이미지를 올리면 **권리 확인 모달**이 뜬다("업로드하는 이미지에 필요한 권리가 있는지 확인하세요").
 * 이게 화면을 덮고 있으면 그 아래 UI 를 못 만진다.
 *
 * 실측으로 배운 것: "버튼을 눌렀다" 는 신호로 부족했다. 이름만 보고 아무 버튼이나 누르면
 *   모달 밖의 동명 버튼을 눌러놓고 처리했다고 착각한다(2건 처리했다는데 모달은 그대로였다).
 *   → 모달 **안의** 버튼만 누르고, **모달이 사라졌는지**로 성공을 판정한다.
 *
 * 소재 한정: 우리 입력은 CC0/PD 로 제한한다. CC BY-SA 이미지로 영상을 생성하면 파생물이라
 *   동일조건변경허락이 따라붙는다 — 그 한정은 호출부가 지킨다.
 */
export async function dismissDialogs(page, { tries = 5 } = {}) {
  // 긍정 버튼 후보. **신기능 안내 모달**은 "시작하기"/"Get started" 를 쓴다 —
  //   실측(2026-08-28): "360p option for Gemini Omni Flash" 안내가 화면 전체를 덮어
  //   tune 클릭이 타임아웃됐다. 목록에 없어서 못 닫았고, 오진으로 이어졌다.
  const LABELS = ['시작하기', 'Get started', '동의함', 'I agree', 'Agree', '확인', 'OK',
                  'Got it', 'Continue', '닫기', 'Dismiss'];

  // role=dialog 가 없는 오버레이도 있다 → **화면 중앙을 덮고 있는 최상위 요소**를 구조로 찾는다.
  const overlay = () => page.locator(
    '[role=dialog], [role=alertdialog], [aria-modal="true"]',
  ).filter({ has: page.locator('button') }).first();

  const blocked = async () => {
    if (await overlay().count().catch(() => 0)
        && await overlay().isVisible().catch(() => false)) return true;
    // 구조 판정: 화면 정중앙의 최상위 요소가 본문이 아니라 떠 있는 패널인가.
    return page.evaluate(() => {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if ((cs.position === 'fixed' || cs.position === 'absolute') && Number(cs.zIndex) >= 10) {
          const r = n.getBoundingClientRect();
          if (r.width > innerWidth * 0.4 && r.height > innerHeight * 0.4
              && n.querySelector('button')) return true;
        }
      }
      return false;
    }).catch(() => false);
  };

  for (let k = 0; k < tries; k++) {
    if (!(await blocked())) return true;      // 모달이 **없는 것도 성공**이다
    let clicked = false;
    for (const t of LABELS) {
      const b = page.locator(`button:has-text("${t}"), [role=button]:has-text("${t}")`).first();
      if (await b.count().catch(() => 0) && await b.isVisible().catch(() => false)) {
        await b.click({ timeout: 4000 }).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      // 이름을 못 찾으면 오버레이 **안의** 마지막 버튼(보통 확인)을 누른다.
      const btns = overlay().locator('button, [role=button]');
      const n = await btns.count().catch(() => 0);
      if (n) await btns.nth(n - 1).click({ timeout: 4000 }).catch(() => {});
      else await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(1400);
  }
  return !(await blocked());
}

/** 지금 선택된 동영상 모델 이름. 패널을 열어 읽고 다시 닫는다. */
export async function readVideoModel(page) {
  const drop = await openDefaults(page);
  const t = (await drop.innerText().catch(() => '')).replace(/\s+/g, ' ').replace('arrow_drop_down', '').trim();
  await closeDefaults(page);
  return t;
}

/**
 * 동영상 모델을 고른다.
 *
 * ⚠ "Veo 3.1 - Lite" 는 "Veo 3.1 - Lite [Lower Priority]" 의 **접두사**다.
 *   부분일치(has-text)로 고르면 **유료 모델**이 잡힌다. 정확히 구분되는 조각으로만 찾는다.
 *   매일 도는 자동화에서 이건 조용히 크레딧을 태우는 종류의 실수다.
 *
 * @returns {Promise<string>} 선택 후 실제로 표시되는 모델명(호출부가 검증한다)
 */
export async function setVideoModel(page, model = FREE_VIDEO_MODEL) {
  const drop = await openDefaults(page);
  if (!(await drop.count().catch(() => 0))) {
    await closeDefaults(page);
    return modelResult(MODEL_RESULT.PANEL_CLOSED);
  }
  let shown = (await drop.innerText().catch(() => '')).replace(/\s+/g, ' ').replace('arrow_drop_down', '').trim();
  if (shown !== model) {
    await drop.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1800);
    // 정확히 그 문자열인 항목만. 접두사 매칭 금지 —
    //   "Veo 3.1 - Lite" 는 "Veo 3.1 - Lite [Lower Priority]" 의 접두사라 **유료 모델**이 잡힌다.
    const opt = page.locator('[role=option],[role=menuitem],[role=menuitemradio],li')
      .filter({ hasText: new RegExp(`^\\s*${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
    if (!(await opt.count().catch(() => 0))) {
      await closeDefaults(page);
      return modelResult(MODEL_RESULT.OPTION_MISSING, shown);
    }
    await opt.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const save = page.locator('button:has-text("저장"), button:has-text("Save")').first();
    if (await save.count().catch(() => 0)) { await save.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(2000); }
    // "선택했다" 와 "선택됐다" 는 다르다 — 다시 열어 읽는다.
    shown = await readVideoModel(page);
  }
  // 확인하느라 연 패널을 반드시 닫는다. 열린 채로 두면 작성기를 덮어 다음 단계가 통째로 막힌다.
  await closeDefaults(page);
  return modelResult(shown === model ? MODEL_RESULT.OK : MODEL_RESULT.NOT_APPLIED, shown);
}

/**
 * * 생성된 미디어를 파일로 받는다.
 *
 * 결과 URL 은 labs.google 의 인증이 필요한 리다이렉트다(media.getMediaUrlRedirect).
 * 브라우저 컨텍스트의 request 를 쓰면 **로그인 쿠키가 그대로 실린다** — 별도 인증이 필요 없다.
 */
export async function downloadMedia(page, url, dest) {
  const res = await page.request.get(url, { timeout: 120_000 });
  if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
  const buf = await res.body();
  if (buf.length < 10_000) throw new Error(`너무 작다 ${buf.length}B — 영상이 아닐 수 있다`);
  const { mkdirSync, writeFileSync } = await import('fs');
  const { dirname } = await import('path');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return buf.length;
}

/**
 * 생성 **후에 늘어난** 미디어 하나. 없으면 null.
 *
 * 실측 사고(2026-08-28): 앵커 클립을 요청했는데 기존 시장 클립이 내려받아졌다 —
 *   paid-test.mp4 와 anchor-en.mp4 가 SHA256 까지 동일(4,593,256B / 9dbe1c38…).
 *   화면이 에디터 뷰로 넘어가면서 그 클립의 <video> 가 붙었고, "before 에 없던 URL" 이라
 *   새 결과로 오인했다. 그 탓에 "유료 등급도 워터마크가 붙는다" 는 **틀린 결론**까지 냈다.
 *
 * 그래서 조건을 둘로 한다:
 *   ① before 에 없던 URL 일 것
 *   ② **개수가 늘었을 것** — 줄면서 새 URL 이 나타나는 건 생성이 아니라 화면 전환이다
 */
export function freshMedia(before, after) {
  const b = before ?? [];
  const a = after ?? [];
  if (a.length <= b.length) return null;
  const seen = new Set(b);
  return a.find((u) => !seen.has(u)) ?? null;
}

/**
 * 지금 화면에 있는 결과 영상 URL 들. 새로 생긴 것만 골라내려면 호출 전 목록을 미리 받아둔다.
 * "영상이 보인다" 만으로는 **내가 방금 시킨 것** 인지 알 수 없다 — 이전 실행의 결과가 남아 있다.
 */
export async function videoUrls(page) {
  return page.evaluate(() => [...document.querySelectorAll('video')]
    .map((e) => e.currentSrc || e.src).filter(Boolean)).catch(() => []);
}
