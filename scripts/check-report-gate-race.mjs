#!/usr/bin/env node
/**
 * check-report-gate-race.mjs — 비회원이 /ko/report 를 열었을 때 **죽지 않는가.** (2026-09-24 신설)
 *
 * 사고: 2026-09-18 부터 비회원에게 보고서 페이지가 "일시적인 오류가 발생했습니다" 로 뜰 수 있었다.
 *   서버는 비회원 응답에서 portfolio 등 20개 필드를 지우고 `gated: true` 를 붙인다(route.ts gateResponse).
 *   페이지는 그 표시를 안 보고 **자기 판정**(member === false)만 믿었다. member 는 처음에 null 이라,
 *   보고서 데이터가 /api/member 보다 먼저 오면 gated=false → 전체 화면을 그리려다
 *   `data.portfolio.some(...)` 에서 undefined.some → 오류 경계가 페이지 전체를 덮는다.
 *   먼저 오는 쪽이 매번 달라서 **어떤 땐 멀쩡하고 어떤 땐 죽었다**(실측: 81,503자 vs 691자).
 *   매 회차 "보고서 화면에 이상" 경고가 찍혔는데 아무도 안 봤다.
 *
 * 경쟁은 한 번 열어서는 안 잡힌다. **여러 번** 연다. 한 번이라도 죽으면 실패다.
 */
import { chromium } from 'playwright';
const N = Number(process.argv.find((a) => a.startsWith('--n='))?.split('=')[1] ?? 6);
const URL = process.argv.find((a) => a.startsWith('--url='))?.split('=')[1] ?? 'http://localhost:3000/ko/report';
const b = await chromium.launch();
let crashed = 0;
const rows = [];
for (let i = 1; i <= N; i++) {
  const ctx = await b.newContext();                // 쿠키 없음 = 비회원
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error' && /TypeError/.test(m.text())) errs.push(m.text().split('\n')[0]); });
  p.on('pageerror', (e) => errs.push(String(e.message)));
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const body = await p.textContent('body').catch(() => '') ?? '';
  const errScreen = /일시적인 오류가 발생했습니다/.test(body);
  if (errScreen || errs.length) crashed++;
  rows.push(`  ${i}: ${errScreen ? '❌ 오류 화면' : '✅'} · 본문 ${body.length}자${errs.length ? ` · ${errs[0].slice(0, 90)}` : ''}`);
  await ctx.close();
}
await b.close();
console.log(rows.join('\n'));
console.log(crashed ? `\n❌ 비회원 ${N}회 중 ${crashed}회 죽었다` : `\n✅ 비회원 ${N}회 모두 정상`);
process.exit(crashed ? 1 : 0);
