#!/usr/bin/env node
// scripts/sft/eval-chat-ui-multiturn.mjs — Playwright 로 *유저가 하듯이* 채팅 UI 멀티턴 eval (2026-07-06)
//
// 사용자 "가급적 플레이라이트 띄워서 유저가 하듯이 했으면 함. 멀티턴으로" — API 직호출이 아니라
// 실제 브라우저(기본 headed)로 /ko/judge 에 로그인 → textarea 타이핑 → Enter → 스트리밍 답변을
// *렌더된 그대로* 읽어 엄격 판정. API-eval 이 못 보는 렌더/스트림/게이트 계층까지 유저 경험 전체를 검증.
//
// 시나리오 (한 대화 7턴 — 실사용 스토리):
//   t1 매입정보(NVDA 180달러 20주) → t2~t5 화제전환(시장/반도체/금리/환율) → t6 지시어 승계(손절)
//   → [compact 요약 대기] → t7 창밖 수익률 질문(±0.6%p 정확도). + 새 채팅: QZZX 정직성.
// 판정: 렌더 텍스트에 chat-verify 15종(verdict_mismatch 제외 — UI 에선 expectedAction 비노출) +
//   티커 칩(이름+가격) 기반 승계/가격 assert + 렌더==저장본 대조. 턴별 스크린샷 + SFT 연료 적재.
// 사용: node scripts/sft/eval-chat-ui-multiturn.mjs [--base=http://127.0.0.1:3000] [--headless]
//       [--out=G:/내 드라이브/0.SFT_Flovium]  (MEMBER_EMAIL 은 .env.local 에서 자동 로드)
import { chromium } from 'playwright';
import { appendFileSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Redis from 'ioredis';
import { checkChatDefects } from '../lib/chat-verify.mjs';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = arg('out', 'G:/내 드라이브/0.SFT_Flovium');
const HEADLESS = process.argv.includes('--headless');
const RUN_TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const SHOT_DIR = resolve(OUT, 'eval', `ui-${RUN_TS}`);
mkdirSync(SHOT_DIR, { recursive: true });
const FUEL = resolve(OUT, 'fuel', 'chat-sft-eval.jsonl');

// MEMBER_EMAIL — .env.local (로그인 게이트 해제)
let EMAIL = process.env.MEMBER_EMAIL || '';
try { EMAIL = EMAIL || (readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').match(/^MEMBER_EMAIL=(.+)$/m) ?? [])[1]?.trim().replace(/^["']|["']$/g, '') || ''; } catch { /* */ }

const results = [];
let shotN = 0;

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
try {
  if (EMAIL) { try { await ctx.request.post(`${BASE}/api/member`, { data: { email: EMAIL }, timeout: 12000 }); } catch { /* 게이트 UI 폴백 */ } }
  const page = await ctx.newPage();
  await page.goto(`${BASE}/ko/judge`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 로그인 게이트가 여전히 뜨면 유저처럼 이메일 입력
  try {
    const gateInput = page.locator('input[type="email"], input[placeholder*="이메일"]').first();
    if (await gateInput.isVisible({ timeout: 3000 })) { await gateInput.fill(EMAIL || 'sft-eval@flowvium.net'); await gateInput.press('Enter'); await page.waitForTimeout(1500); }
  } catch { /* 게이트 없음 = 이미 로그인 */ }
  await page.waitForSelector('textarea', { timeout: 20000 });

  // 마지막 assistant 렌더 상태 스냅샷 (본문 innerText + 칩 분리) — 칩 문구가 본문 판정(절단 등)을 오염 방지
  const readLast = () => page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('div.space-y-6 > div'));
    const assist = rows.filter(r => !r.className.includes('justify-end') && r.querySelector('div.flex-1')); // bottomRef 빈 div 제외
    const last = assist[assist.length - 1];
    if (!last) return null;
    const content = last.querySelector('div.flex-1');
    const chipBox = content?.querySelector('div[class*="mt-2"]');
    const chips = chipBox ? Array.from(chipBox.querySelectorAll('span')).map(s => s.textContent?.trim() ?? '').filter(Boolean) : [];
    const full = (content?.innerText ?? '').trim();
    const spinning = !!last.querySelector('.animate-spin');
    return { full, chips, spinning, nAssist: assist.length };
  }).then((s) => {
    if (!s) return null;
    // 본문 = innerText 에서 꼬리의 칩 라인 제거
    const lines = s.full.split('\n');
    while (lines.length && s.chips.some(c => lines[lines.length - 1].trim() && (c.includes(lines[lines.length - 1].trim()) || lines[lines.length - 1].trim().includes(c)))) lines.pop();
    return { ...s, text: lines.join('\n').trim() };
  });

  // 유저처럼 한 턴: 타이핑 → Enter → 스트리밍 완료(스피너 소멸 + 본문 2.5s 안정) 대기
  const sendTurn = async (q, { timeoutMs = 240000 } = {}) => {
    const before = (await readLast())?.nAssist ?? 0;
    await page.fill('textarea', q);
    await page.press('textarea', 'Enter');
    const t0 = Date.now();
    let stable = '', stableSince = 0;
    for (;;) {
      await page.waitForTimeout(700);
      const s = await readLast();
      if (s && s.nAssist > before && !s.spinning && s.text.trim()) {
        if (s.text === stable) { if (Date.now() - stableSince >= 2500) return { ...s, ms: Date.now() - t0 }; }
        else { stable = s.text; stableSince = Date.now(); }
      }
      if (Date.now() - t0 > timeoutMs) throw new Error(`턴 타임아웃(${q.slice(0, 20)}…)`);
    }
  };

  const chipPrice = (chips, nameRe) => {
    for (const c of chips) { if (nameRe.test(c)) { const m = c.match(/([\d,]+(?:\.\d+)?)(?:\s*·|$)/); if (m) return Number(m[1].replace(/,/g, '')); } }
    return null;
  };
  const judge = async (scenario, turn, q, s, extraFails, grounding) => {
    shotN++;
    const shot = `${SHOT_DIR}/${String(shotN).padStart(2, '0')}-${scenario}-t${turn}.png`;
    try { await page.screenshot({ path: shot }); } catch { /* */ }
    // 렌더 텍스트 판정 — UI 에선 결정론 심판값 비노출이라 verdict_mismatch 는 제외(API-eval 이 담당)
    const defects = checkChatDefects(q, s.text, grounding ?? { tickers: [] }, 'ko').filter(d => d.type !== 'verdict_mismatch');
    const fails = [...defects.map(d => `defect:${d.type}${d.detail ? `(${String(d.detail).slice(0, 40)})` : ''}`), ...extraFails];
    const row = { id: `ui-${RUN_TS}-${scenario}-t${turn}`, scenario, turn, ts: new Date().toISOString(), ms: s.ms, q: q.slice(0, 160), answerLen: s.text.length, chips: s.chips.slice(0, 6), label: fails.length ? 'fail' : 'pass', fails, shot };
    results.push(row);
    appendFileSync(FUEL, JSON.stringify({ ...row, origin: 'ui-eval', messages: [{ role: 'user', content: q }, { role: 'assistant', content: s.text }] }) + '\n', 'utf8');
    console.log(`${fails.length ? '❌' : '✅'} [${scenario} t${turn}] ${(s.ms / 1000).toFixed(1)}s ${s.text.length}자${fails.length ? ` | ${fails.join(' · ')}` : ''}`);
  };

  // ── 시나리오 A: 7턴 실사용 스토리 (한 대화 — 승계·compact·수익률) ──────────────
  const t1q = '나 3주 전에 NVDA를 주당 180달러에 20주 매수했어. 지금 어때?';
  let s = await sendTurn(t1q);
  const nvdaP1 = chipPrice(s.chips, /NVIDIA|NVDA/i);
  await judge('A', 1, t1q, s, nvdaP1 ? [] : ['assert:NVDA 가격 칩 없음'], { tickers: [{ ticker: 'NVDA', price: nvdaP1 }] });
  const fillers = ['요즘 시장 변동성은 어때?', '반도체 업황 전반은 어떻게 봐?', '금리는 언제 내릴 것 같아?', '환율 영향은 어때?'];
  for (let i = 0; i < fillers.length; i++) { s = await sendTurn(fillers[i]); await judge('A', i + 2, fillers[i], s, [], { tickers: [] }); }
  const t6q = '그럼 손절 라인은 어디로 잡는 게 좋아?';
  s = await sendTurn(t6q);
  const nvdaP6 = chipPrice(s.chips, /NVIDIA|NVDA/i);
  await judge('A', 6, t6q, s, nvdaP6 ? [] : ['assert:지시어 승계 실패(NVDA 칩 없음)'], { tickers: [{ ticker: 'NVDA', price: nvdaP6 }] });
  // compact 요약 대기(백그라운드) — 12메시지 시점에 창밖 4개 → 요약 생성됨
  const rd = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 2 });
  let summary = null;
  try {
    const idx = (await rd.lrange('flowvium:judge-chat:index', 0, 8)).map(x => JSON.parse(x)).find(e => (e.q ?? '').startsWith('그럼 손절 라인'));
    if (idx?.key) for (let i = 0; i < 18 && !summary; i++) { summary = JSON.parse(await rd.get(idx.key) ?? '{}').summary ?? null; if (!summary) await new Promise(res => setTimeout(res, 5000)); }
  } finally { rd.disconnect(); }
  const t7q = '아까 내가 산 단가와 수량 기준으로 지금 수익률이 어느 정도야?';
  s = await sendTurn(t7q);
  const nvdaP7 = chipPrice(s.chips, /NVIDIA|NVDA/i) ?? nvdaP6 ?? nvdaP1;
  const expectPct = nvdaP7 ? (nvdaP7 / 180 - 1) * 100 : null;
  const pcts = Array.from(s.text.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)).map(m => Number(m[1]));
  const t7fails = [];
  if (!summary) t7fails.push('assert:compact 요약 미생성(90s)');
  if (expectPct != null && !pcts.some(v => Math.abs(v - expectPct) <= 0.6)) t7fails.push(`assert:수익률 부정확(기대 ${expectPct.toFixed(1)}% vs 렌더 ${pcts.join(',') || '없음'})`);
  await judge('A', 7, t7q, s, t7fails, { tickers: [{ ticker: 'NVDA', price: nvdaP7 }] });
  // 렌더==저장본 대조 — 유저가 본 마지막 답변 vs Redis 저장 conv (스트림/렌더 계층 회귀 게이트).
  //   (2026-07-06 1차 실행 버그 fix: action=list 가 빈 결과일 때 빈 saved 로 false-fail — Redis 직조회로 교체.)
  try {
    const rd2 = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 2 });
    let saved = '';
    try {
      const idx2 = (await rd2.lrange('flowvium:judge-chat:index', 0, 15)).map(x => JSON.parse(x)).find(e => (e.q ?? '').startsWith(t7q.slice(0, 12)));
      if (idx2?.key) saved = String([...(JSON.parse(await rd2.get(idx2.key) ?? '{}').messages ?? [])].reverse().find(m => m.role === 'assistant')?.content ?? '');
    } finally { rd2.disconnect(); }
    const norm = (x) => x.replace(/\s+/g, '');
    const ok = !!saved.trim() && norm(saved) === norm(s.text);
    results.push({ id: `ui-${RUN_TS}-A-savedcheck`, scenario: 'A', turn: 'saved', label: ok ? 'pass' : 'fail', fails: ok ? [] : [`assert:렌더≠저장본(rendered ${s.text.length}자 vs saved ${saved.length}자)`] });
    console.log(`${ok ? '✅' : '❌'} [A saved] 렌더==저장본 대조${ok ? '' : ` — rendered "${s.text.slice(0, 60)}" vs saved "${saved.slice(0, 60)}"`}`);
  } catch (e) { console.log(`⚠️ 저장본 대조 skip: ${e.message}`); }

  // ── 시나리오 B: 새 채팅 → 미존재 티커 정직성 (유저가 새 대화 시작하듯) ─────────
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea', { timeout: 20000 });
  const bq = 'QZZX 어때? 지금 사도 돼?';
  s = await sendTurn(bq);
  const bFails = [];
  if (chipPrice(s.chips, /QZZX|Q[A-Z]{2,3}X/i)) bFails.push('assert:미존재 티커에 가격 칩(유사치환 의심)');
  if (/\$\s?\d{2,}|\d{2,3}(?:,\d{3})+\s*(달러|원)|RSI\s*\d/.test(s.text) && !/(데이터|정보|종목).{0,14}(없|찾지 못|확인되지 않|불러오지 못)/.test(s.text)) bFails.push('assert:데이터 없는 종목에 수치 제시(날조)');
  await judge('B', 1, bq, s, bFails, { tickers: [] });
} finally { await browser.close(); }

const passN = results.filter(r => r.label === 'pass').length;
const summaryOut = { runTs: RUN_TS, base: BASE, headed: !HEADLESS, total: results.length, pass: passN, fail: results.length - passN, passRate: +(passN / results.length * 100).toFixed(1), shots: SHOT_DIR, results };
writeFileSync(resolve(OUT, 'eval', `ui-eval-${RUN_TS}.json`), JSON.stringify(summaryOut, null, 2), 'utf8');
console.log(`\n=== UI 멀티턴 eval(유저 플로우): ${passN}/${results.length} pass (${summaryOut.passRate}%) ===`);
console.log(`eval → ${resolve(OUT, 'eval', `ui-eval-${RUN_TS}.json`)}\nshots → ${SHOT_DIR}\nfuel → ${FUEL}`);
process.exitCode = passN === results.length ? 0 : 1;
