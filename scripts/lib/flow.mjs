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
