#!/usr/bin/env node
/**
 * paper-trade-sync.mjs — 새 보고서 회차(ko)의 포트폴리오로 /api/paper-trading?action=execute 를 부른다. 2026-10-16.
 * 왜: 로컬 생성기로 옮긴 뒤 가상매매를 부르는 곳이 없어 '처리된 리포트 0' 이었다(lib/paper-trade-sync.test.mjs).
 * 상태: logs/paper-trade-sync.json {lastId}. 처음 돌 때는 가장 최근 회차 하나만(과거 회차를 몰아 매매하지 않음).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { pickNewReport } from './lib/paper-trade-sync.mjs';

const STATE = resolve(ROOT, 'logs/paper-trade-sync.json');
const BASE = process.env.FLOWVIUM_BASE || 'http://127.0.0.1:3000';
const secret = (() => { if (process.env.CRON_SECRET) return process.env.CRON_SECRET; try { const m = readFileSync(resolve(ROOT, '.env.local'), 'utf8').match(/^CRON_SECRET\s*=\s*(.+)$/m); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; } catch { return ''; } })();
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { lastId: null };
const reports = readdirSync(resolve(ROOT, 'reports')).filter((f) => /^report-\d{4}-\d{2}-\d{2}-[a-z]+-ko\.json$/.test(f)).sort().slice(-6).map((f) => {
  try { const r = JSON.parse(readFileSync(resolve(ROOT, 'reports', f), 'utf8')); const m = /^report-(\d{4}-\d{2}-\d{2})-([a-z]+)-ko/.exec(f);
    return { id: `${m[1]}:${m[2]}`, generatedAt: r.generatedAt, portfolio: r.portfolio ?? [] }; } catch { return null; }
}).filter(Boolean);
const pick = pickNewReport(reports, state);
if (!pick) { console.log(`새 회차 없음 (마지막 ${state.lastId})`); process.exit(0); }
const res = await fetch(`${BASE}/api/paper-trading?action=execute`, { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
  body: JSON.stringify({ portfolio: pick.portfolio, reportDate: pick.id.slice(0, 10) }), signal: AbortSignal.timeout(120000) });
const body = await res.json().catch(() => null);
if (!res.ok) { console.error(`실패 HTTP ${res.status} ${JSON.stringify(body)}`); process.exit(1); }
writeFileSync(STATE, JSON.stringify({ lastId: pick.id, at: new Date().toISOString(), result: body }, null, 1));
console.log(`${pick.id}: 매수 ${body?.bought?.join(',') || '-'} · 매도 ${body?.sold?.join(',') || '-'} · 건너뜀 ${body?.skipped?.length ?? 0} · 평가액 ${body?.totalValue}`);
