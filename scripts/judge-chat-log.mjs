#!/usr/bin/env node
/**
 * judge-chat-log.mjs — 매수·매도 심판엔진 채팅 전체 대화 검토 (2026-06-18 신설)
 *
 * 사용자 "전체 대화 저장 — 검토·학습용". /api/judge-chat 가 conv 키(180일) + index 리스트에
 * 질문+답변+히스토리+종목+모드+소스를 저장 → 이 스크립트로 최근 대화를 열람.
 *
 * 사용:  node scripts/judge-chat-log.mjs [N]      # 최근 N개(기본 20) 전체 대화
 *        node scripts/judge-chat-log.mjs --brief  # 한 줄 요약(질문+종목+소스)만
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(process.cwd());
const env = {};
try {
  for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch { /* ignore */ }

const URL = env.UPSTASH_REDIS_REST_URL, TOKEN = env.UPSTASH_REDIS_REST_TOKEN;
if (!URL || !TOKEN) { console.error('Upstash env(.env.local) 없음'); process.exit(1); }

async function cmd(arr) {
  const r = await fetch(URL, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(arr) });
  return (await r.json()).result;
}

const args = process.argv.slice(2);
const brief = args.includes('--brief');
const N = parseInt(args.find(a => /^\d+$/.test(a)) ?? '20', 10);

const idx = (await cmd(['LRANGE', 'flowvium:judge-chat:index', '0', String(N - 1)])) ?? [];
if (!idx.length) { console.log('저장된 대화 없음.'); process.exit(0); }
console.log(`=== 심판엔진 채팅 최근 ${idx.length}건 ===\n`);

if (brief) {
  for (const s of idx) {
    const e = typeof s === 'string' ? JSON.parse(s) : s;
    console.log(`${e.ts?.slice(0, 19)} [${e.source ?? '?'}] ${(e.tickers || []).join(',') || '-'} | ${e.q}`);
  }
  process.exit(0);
}

const keys = idx.map(s => (typeof s === 'string' ? JSON.parse(s) : s).key).filter(Boolean);
const convs = keys.length ? await cmd(['MGET', ...keys]) : [];
for (let i = 0; i < convs.length; i++) {
  const c = convs[i] ? (typeof convs[i] === 'string' ? JSON.parse(convs[i]) : convs[i]) : null;
  if (!c) continue;
  console.log(`──── ${c.ts?.slice(0, 19)} · 모드 ${c.mode} · ${c.source} · ${c.durationMs}ms · 종목 ${(c.tickers || []).join(',') || '-'} ────`);
  for (const m of c.messages || []) {
    const who = m.role === 'user' ? '🙋 사용자' : '⚖️ 심판엔진';
    console.log(`${who}: ${String(m.content).replace(/\n/g, '\n   ')}`);
  }
  console.log('');
}
