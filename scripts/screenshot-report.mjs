#!/usr/bin/env node
/**
 * scripts/screenshot-report.mjs — 보고서 페이지 풀페이지 시각 캡쳐 (발간 전후 검수, 2026-06-14).
 *
 * 사용자 "발간 직전 최종본 미리보기 검수 + 발간 후 창 띄워 캡쳐 검증" 요청. puppeteer-core +
 *   시스템 Chrome(재사용, Chromium 다운로드 없음). fv_member 쿠키 주입으로 회원게이트 우회(전체 보고서
 *   QA) + 렌더 대기 + 풀페이지 PNG. Claude 가 Read 로 육안 검증 → 이상 시 개선·재업로드.
 *
 * 사용: node scripts/screenshot-report.mjs [locale] [out.png]
 *   기본 locale=ko, out=reports/preview/report-<locale>-<ts>.png
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createHmac } from 'crypto';

const ROOT = resolve(import.meta.dirname, '..');
const locale = process.argv[2] || 'ko';
const dir = resolve(ROOT, 'reports/preview');
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const out = process.argv[3] || resolve(dir, `report-${locale}-${Date.now()}.png`);

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!CHROME) { console.error('❌ Chrome/Edge 못 찾음'); process.exit(1); }

// 회원게이트 우회 — fv_member 쿠키 생성(member/route.ts sign() 재현). 검수용 로컬 전용.
function memberCookie(email = 'qa@flowvium.local') {
  const env = (() => { try { return readFileSync(resolve(ROOT, '.env.local'), 'utf8'); } catch { return ''; } })();
  const m = env.match(/^MEMBER_SECRET\s*=\s*(.+)$/m) || env.match(/^CRON_SECRET\s*=\s*(.+)$/m);
  const secret = (m?.[1] ?? process.env.MEMBER_SECRET ?? process.env.CRON_SECRET ?? 'flowvium-member-v1').trim().replace(/^['"]|['"]$/g, '');
  const b64 = Buffer.from(email.toLowerCase()).toString('base64url');
  const mac = createHmac('sha256', secret).update(b64).digest('base64url').slice(0, 24);
  return `${b64}.${mac}`;
}

const url = `http://localhost:3000/${locale}/report`;
console.log(`[screenshot] ${CHROME.split('/').pop()} → ${url} (게이트 우회)`);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1600, deviceScaleFactor: 1 });
  await page.setCookie({ name: 'fv_member', value: memberCookie(), domain: 'localhost', path: '/' });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  // 보고서 핵심 섹션 렌더 대기(클라이언트 fetch). 실패해도 진행.
  await page.waitForSelector('text/AI 투자 전략', { timeout: 8000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3500));   // 차트/지연 fetch 여유
  await page.screenshot({ path: out, fullPage: true });
  // 2026-06-14: 섹션 분할 캡쳐 — 풀페이지는 Read 시 과축소로 텍스트 판독 불가. Claude 검증 위해
  //   세로 2200px 단위로 잘라 읽기가능 PNG 생성(out 베이스명-s1/s2/...). 검증은 이 조각들을 Read.
  const SECT = 2200;
  const full = await page.evaluate(() => document.body.scrollHeight);
  const n = Math.min(6, Math.ceil(full / SECT));   // 최대 6조각
  const base = out.replace(/\.png$/, '');
  for (let i = 0; i < n; i++) {
    const h = Math.min(SECT, full - i * SECT); if (h <= 0) break;
    await page.screenshot({ path: `${base}-s${i + 1}.png`, clip: { x: 0, y: i * SECT, width: 1280, height: h } });
  }
  console.log(`✅ 캡쳐: 풀 ${out} + 섹션 ${n}조각 (${base}-s1..s${n}.png, 판독용)`);
} finally {
  await browser.close();
}
