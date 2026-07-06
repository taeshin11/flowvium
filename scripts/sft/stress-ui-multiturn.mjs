#!/usr/bin/env node
// scripts/sft/stress-ui-multiturn.mjs — Playwright 로 유저처럼 *멀티턴* 대량 질문 스트레스 (2026-07-06)
//
// 사용자 "질문을 몇백개 해봐 · 플레이라이트로 실제 유저가 하듯이 멀티턴으로".
// N개 대화 세션 × 턴당 랜덤 후속(3~6턴) = 수백 질문. 각 세션은 실브라우저에서 새 채팅→타이핑→스트리밍
// 답변을 렌더된 그대로 읽어 chat-verify 15종으로 판정. 세션 내 후속질문은 종목 승계/compact 경로를 실제로 태움.
// 산출: eval/stress-ui-<ts>.json(전 턴 판정) + fuel/chat-sft-stress.jsonl(pass=positive/fail=rejected).
// 사용: node scripts/sft/stress-ui-multiturn.mjs [--sessions=60] [--tabs=3] [--headless]
//       [--base=..] [--out=G:/내 드라이브/0.SFT_Flovium]  (턴수는 세션당 3~6 랜덤 → 대략 sessions×4.5)
import { chromium } from 'playwright';
import { appendFileSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkChatDefects } from '../lib/chat-verify.mjs';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = arg('out', 'G:/내 드라이브/0.SFT_Flovium');
const SESSIONS = Number(arg('sessions', 60));
const TABS = Number(arg('tabs', 3));           // 동시 브라우저 컨텍스트(vLLM 세마포어 MAX 4 존중 → 3 권장)
const HEADLESS = process.argv.includes('--headless');
const RUN_TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
mkdirSync(resolve(OUT, 'eval'), { recursive: true });
mkdirSync(resolve(OUT, 'fuel'), { recursive: true });
const FUEL = resolve(OUT, 'fuel', 'chat-sft-stress.jsonl');

let EMAIL = process.env.MEMBER_EMAIL || '';
try { EMAIL = EMAIL || (readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').match(/^MEMBER_EMAIL=(.+)$/m) ?? [])[1]?.trim().replace(/^["']|["']$/g, '') || ''; } catch { /* */ }

// 종목 풀 로드
const ROOT = resolve(process.cwd());
const meta = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8')).meta || {};
const ents = Object.entries(meta).map(([t, m]) => ({ ticker: t, name: m.name || t, kr: /\.(KS|KQ)$/.test(t) }));
const krs = ents.filter(e => e.kr), uss = ents.filter(e => !e.kr);
// 재현성 시드 난수 (Date.now/Math.random 회피)
let seed = 987654321; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

// 세션 스크립트 — 첫 질문(종목/일반/엣지) + 후속 3~5개(지시어 승계·심화·전환 섞음)
const FOLLOWUPS = ['그럼 지금 사도 돼?', '그럼 팔아야 할까?', '손절 라인은 어디가 좋아?', '진입가랑 목표가 알려줘', '이 종목 리스크가 뭐야?', '실적은 어때?', '경쟁사 대비 어때?', '배당은 어때?', '장기 투자로 괜찮아?', '지금 시장 분위기에서 담아도 돼?'];
const GENERAL = ['지금 시장 어때?', '환율이 주식에 미치는 영향은?', '금리 전망 어때?', '오늘 매수 추천 top5 알려줘', '반도체 업황 어때?'];
const EDGE = ['asdfqwer 사도돼?', '없는종목123 어때?', 'QZZX 지금 사도 돼?', '🚀🚀 뭐 살까'];
function sessionScript() {
  const r = rnd();
  const first = r < 0.7 ? `${pick(rnd() < 0.5 ? krs : uss).name} 어때?`
    : r < 0.88 ? pick(GENERAL) : pick(EDGE);
  const nTurns = 3 + Math.floor(rnd() * 3);       // 3~5 후속
  const turns = [first];
  for (let i = 0; i < nTurns; i++) turns.push(rnd() < 0.75 ? pick(FOLLOWUPS) : pick(GENERAL));
  return turns;
}

const results = [];
const stat = { total: 0, pass: 0, byDefect: {} };

async function runSession(ctx, sIdx) {
  const turns = sessionScript();
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/ko/judge`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { const gi = page.locator('input[type="email"]').first(); if (await gi.isVisible({ timeout: 2000 })) { await gi.fill(EMAIL || 'stress@flowvium.net'); await gi.press('Enter'); await page.waitForTimeout(1200); } } catch { /* */ }
    await page.waitForSelector('textarea', { timeout: 20000 });

    const readLast = () => page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('div.space-y-6 > div'));
      const assist = rows.filter(r => !r.className.includes('justify-end') && r.querySelector('div.flex-1'));
      const last = assist[assist.length - 1]; if (!last) return null;
      const content = last.querySelector('div.flex-1');
      const chipBox = content?.querySelector('div[class*="mt-2"]');
      const chips = chipBox ? Array.from(chipBox.querySelectorAll('span')).map(s => s.textContent?.trim() ?? '').filter(Boolean) : [];
      return { full: (content?.innerText ?? '').trim(), chips, spinning: !!last.querySelector('.animate-spin'), nAssist: assist.length };
    }).then(s => { if (!s) return null; const ls = s.full.split('\n'); while (ls.length && s.chips.some(c => ls[ls.length - 1].trim() && (c.includes(ls[ls.length - 1].trim()) || ls[ls.length - 1].trim().includes(c)))) ls.pop(); return { ...s, text: ls.join('\n').trim() }; });

    const sendTurn = async (q) => {
      const before = (await readLast())?.nAssist ?? 0;
      await page.fill('textarea', q); await page.press('textarea', 'Enter');
      const t0 = Date.now(); let stable = '', since = 0;
      for (;;) {
        await page.waitForTimeout(700);
        const s = await readLast();
        if (s && s.nAssist > before && !s.spinning && s.text.trim()) {
          if (s.text === stable) { if (Date.now() - since >= 2200) return { ...s, ms: Date.now() - t0 }; }
          else { stable = s.text; since = Date.now(); }
        }
        if (Date.now() - t0 > 200000) return { text: '', chips: [], ms: Date.now() - t0, timeout: true };
      }
    };

    const chipPrice = (chips) => { for (const c of chips) { const m = c.match(/([\d,]+(?:\.\d+)?)(?:\s*·|$)/); if (m && Number(m[1].replace(/,/g, '')) > 0) return { price: Number(m[1].replace(/,/g, '')) }; } return null; };
    for (let ti = 0; ti < turns.length; ti++) {
      const q = turns[ti];
      const s = await sendTurn(q);
      const grounding = { tickers: chipPrice(s.chips) ? [{ ticker: 'x', price: chipPrice(s.chips).price }] : [] };
      const defects = s.timeout ? [{ type: 'timeout' }] : checkChatDefects(q, s.text, grounding, 'ko').filter(d => d.type !== 'verdict_mismatch');
      const pass = defects.length === 0 && !s.timeout && s.text.length > 0;
      stat.total++; if (pass) stat.pass++;
      for (const d of defects) stat.byDefect[d.type] = (stat.byDefect[d.type] ?? 0) + 1;
      const row = { id: `stress-${RUN_TS}-s${sIdx}-t${ti}`, session: sIdx, turn: ti, q: q.slice(0, 120), answerLen: s.text.length, ms: s.ms, chips: s.chips.slice(0, 4), label: pass ? 'pass' : 'fail', fails: defects.map(d => d.type) };
      results.push(row);
      appendFileSync(FUEL, JSON.stringify({ ...row, origin: 'stress-ui', text: s.text }) + '\n', 'utf8');
    }
  } catch (e) { results.push({ id: `stress-${RUN_TS}-s${sIdx}-err`, session: sIdx, label: 'fail', fails: [`session_error:${String(e.message).slice(0, 40)}`] }); }
  finally { await page.close().catch(() => {}); }
}

const browser = await chromium.launch({ headless: HEADLESS });
try {
  // TABS 개 컨텍스트가 세션 큐를 나눠 처리 — 각자 독립 로그인(익명 쿠키)
  let next = 0;
  const worker = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
    if (EMAIL) { try { await ctx.request.post(`${BASE}/api/member`, { data: { email: EMAIL }, timeout: 12000 }); } catch { /* */ } }
    for (;;) { const s = next++; if (s >= SESSIONS) break; await runSession(ctx, s); if (s % 5 === 0) console.log(`  …세션 ${s + 1}/${SESSIONS} · 누적 ${stat.total}턴 · pass ${stat.total ? Math.round(stat.pass / stat.total * 100) : 0}%`); }
    await ctx.close();
  };
  await Promise.all(Array.from({ length: TABS }, worker));
} finally { await browser.close(); }

const summary = { runTs: RUN_TS, base: BASE, headed: !HEADLESS, sessions: SESSIONS, totalTurns: stat.total, pass: stat.pass, fail: stat.total - stat.pass, passRate: +(stat.pass / Math.max(1, stat.total) * 100).toFixed(1), byDefect: stat.byDefect, results };
writeFileSync(resolve(OUT, 'eval', `stress-ui-${RUN_TS}.json`), JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n=== 멀티턴 UI 스트레스: ${SESSIONS}세션 · ${stat.total}턴 · pass ${stat.pass}/${stat.total} (${summary.passRate}%) ===`);
console.log(`결함 유형: ${JSON.stringify(stat.byDefect)}`);
console.log(`eval → ${resolve(OUT, 'eval', `stress-ui-${RUN_TS}.json`)}\nfuel → ${FUEL}`);
process.exitCode = 0;   // 스트레스는 탐색용 — 결함 있어도 exit0(연료·통계가 산출물). 회귀게이트는 eval-* 가 담당.
