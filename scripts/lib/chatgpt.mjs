/**
 * chatgpt.mjs — 전용 크롬 프로필(spinaiceo 로그인)의 ChatGPT 에 묻고 답을 받는다. 머리말은 chatgpt.test.mjs.
 *
 * ensureBrowser(): 포트 9334 가 안 살아 있으면 secrets/chatgpt-profile 로 크롬을 다시 띄운다(로그인 쿠키 그대로).
 * ask(q): 새 탭 → 로그인 확인 → 입력 → 답이 멎을 때까지 기다림 → 탭 닫기. 로그아웃이면 던진다(빈 답으로 넘기지 않는다).
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT } from './project-root.mjs';

export const PORT = Number(process.env.CHATGPT_CDP_PORT ?? 9334);
const PROFILE = resolve(ROOT, 'secrets/chatgpt-profile');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 화면 대화 조각 [{label,text}] 에서 마지막 "ChatGPT 답변" 본문. 없으면 null. */
export function answerFromTurns(turns) {
  const a = turns.filter((t) => /ChatGPT\s*답변|ChatGPT said/i.test(t.label)).at(-1);
  if (!a) return null;
  return a.text.replace(a.label, '').trim();
}

export const isLoggedOut = (session) => !session?.email;

async function alive() {
  try { return (await fetch(`${BASE}/json/version`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}

export async function ensureBrowser() {
  if (await alive()) return 'running';
  spawn(CHROME, [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check'],
    { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 30; i++) { await sleep(1000); if (await alive()) return 'launched'; }
  throw new Error(`ChatGPT 크롬(포트 ${PORT})이 뜨지 않는다`);
}

/** 그 탭이 아직 chatgpt.com 인가(공용 맥 — 입력 직전마다 본다). */
export const onChatGpt = (url) => { try { return /(^|\.)chatgpt\.com$/.test(new URL(url).hostname); } catch { return false; } };

/**
 * 브라우저 수준 CDP 로 **새 창**을 포커스 없이 연다(newWindow + background) — 공용 맥(10/15 Mac mini2 조건).
 * 같은 창의 뒤쪽 탭(background 탭)은 쓰면 안 된다: 10/15 실측 visibilityState 'hidden' 이라 ChatGPT 가 입력창을
 *   안 그리고(40초 내내 box=false) 질문이 안 들어가 600초 시간초과로 끝났다. 따로 연 창은 'visible' 이고 답이 나온다.
 * 창을 맨 앞으로 안 올린다는 건 확인 못 했다(그때 이미 이 크롬이 맨 앞) — 쓰기 전에 공용 맥 세션에 알린다.
 */
async function createBackgroundTarget(url) {
  const { webSocketDebuggerUrl } = await (await fetch(`${BASE}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const res = await new Promise((r) => { ws.onmessage = (m) => r(JSON.parse(m.data)); ws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url, newWindow: true, background: true } })); });
  ws.close();
  const id = res.result?.targetId;
  if (!id) throw new Error(`탭을 못 열었다: ${JSON.stringify(res.error ?? res).slice(0, 120)}`);
  for (let i = 0; i < 20; i++) {
    const t = (await (await fetch(`${BASE}/json/list`)).json()).find((x) => x.id === id);
    if (t?.webSocketDebuggerUrl) return t;
    await sleep(250);
  }
  throw new Error('새 탭의 디버거 주소를 못 찾았다');
}

async function openPage(url) {
  const t = await createBackgroundTarget(url);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const j = JSON.parse(m.data); if (pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const close = async () => { ws.close(); await fetch(`${BASE}/json/close/${t.id}`).catch(() => {}); };
  return { send, ev, close };
}

const TURNS_JS = `[...document.querySelectorAll('h4.sr-only, h5.sr-only, h6.sr-only')].map(h=>({label:h.innerText.trim(), text:h.parentElement.innerText}))`;

export async function ask(question, { timeoutMs = 180000, log = () => {} } = {}) {
  log(`브라우저 ${await ensureBrowser()}`);
  const pg = await openPage('https://chatgpt.com/');
  try {
    let box = false;
    for (let i = 0; i < 30 && !box; i++) { await sleep(1000); box = await pg.ev(`!!document.querySelector('#prompt-textarea, [contenteditable=true]')`); }
    const session = await pg.ev(`fetch('/api/auth/session').then(r=>r.json()).then(j=>({email:j.user?.email??null})).catch(()=>({email:null}))`);
    if (isLoggedOut(session)) throw new Error('ChatGPT 로그아웃 상태 — 전용 크롬 창에서 spinaiceo 로 다시 로그인 필요(사람)');
    if (!box) throw new Error('ChatGPT 입력창을 못 찾았다');
    const guard = async () => { const u = await pg.ev('location.href'); if (!onChatGpt(u)) throw new Error(`탭이 chatgpt.com 이 아니다(${String(u).slice(0, 60)}) — 입력 중단`); };
    await guard();
    const before = (await pg.ev(TURNS_JS)).length;
    await pg.ev(`(document.querySelector('#prompt-textarea')||document.querySelector('[contenteditable=true]')).focus()`);
    await pg.send('Input.insertText', { text: question });
    await sleep(600);
    await guard();
    for (const type of ['keyDown', 'keyUp']) await pg.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    // 답이 생기고, 생성 중지 버튼이 사라지고, 본문이 4초 동안 그대로면 끝.
    let last = null; let same = 0;
    for (const end = Date.now() + timeoutMs; Date.now() < end;) {
      await sleep(1000);
      const turns = await pg.ev(TURNS_JS);
      const busy = await pg.ev(`!!document.querySelector('[data-testid=stop-button], button[aria-label*="중지"], button[aria-label*="Stop"]')`);
      const a = turns.length > before ? answerFromTurns(turns) : null;
      if (a && !busy && a === last) { if (++same >= 4) return a; } else same = 0;
      last = a;
    }
    throw new Error(`ChatGPT 답이 ${timeoutMs / 1000}초 안에 끝나지 않았다`);
  } finally { await pg.close(); }
}
