#!/usr/bin/env node
// analyze-chat-logs.mjs — 채팅 질답 검증로그(flowvium:judge-chat:verify) 누적 분석 (2026-06-18 사용자
//   "이전 질답로그 분석하고있어? 반드시 하라"). per-answer 검증을 모아 결함률·유형·추세·최근 결함 예시 요약 +
//   logs/chat-verify-status.json 기록(모니터/대시보드용) + 결함률 높으면 경고. run-report.bat 가 매 사이클 자동실행.
//   실행: node scripts/analyze-chat-logs.mjs [--n=1000]
import Redis from 'ioredis';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const N = Number((process.argv.find(a => a.startsWith('--n=')) || '--n=1000').split('=')[1]);
const WARN_RATE = 0.15; // 결함률 15%+ 면 경고
const r = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 2 });

try {
  const rows = await r.lrange('flowvium:judge-chat:verify', 0, N - 1);
  const total = await r.llen('flowvium:judge-chat:verify');
  if (!rows.length) { console.log('검증 로그 없음(아직 질답 미발생).'); process.exit(0); }

  const entries = rows.map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
  const withDefect = entries.filter((e) => (e.defectCount ?? 0) > 0);
  const types = {};
  const byMode = {};
  for (const e of entries) {
    byMode[e.mode] = byMode[e.mode] || { n: 0, def: 0 };
    byMode[e.mode].n++; if ((e.defectCount ?? 0) > 0) byMode[e.mode].def++;
    for (const d of (e.defects ?? [])) types[d.type] = (types[d.type] ?? 0) + 1;
  }

  console.log(`\n=== FlowVium 채팅 질답 검증 분석 (최근 ${entries.length}건 / 총 ${total}건) ===`);
  console.log(`결함 포함 답변: ${withDefect.length}건 (${(withDefect.length / entries.length * 100).toFixed(1)}%)`);
  console.log(`\n[결함 유형별]`);
  const typeRows = Object.entries(types).sort((a, b) => b[1] - a[1]);
  if (!typeRows.length) console.log('  (결함 0 — 전부 clean)');
  else for (const [t, c] of typeRows) console.log(`  ${t}: ${c}건`);
  console.log(`\n[모드별 결함률]`);
  for (const [m, s] of Object.entries(byMode)) console.log(`  ${m}: ${s.def}/${s.n} (${(s.def / s.n * 100).toFixed(0)}%)`);
  if (withDefect.length) {
    console.log(`\n[최근 결함 답변 예시 (최대 8)]`);
    for (const e of withDefect.slice(0, 8)) console.log(`  ${e.ts?.slice(0, 19)} | "${(e.q || '').slice(0, 30)}" | ${(e.defects || []).map((d) => d.type).join(', ')}`);
  }

  // 상태파일 기록(모니터/대시보드 소비) + 결함률 경고. 매 cron 사이클 자동 갱신.
  const defectRate = withDefect.length / entries.length;
  const status = {
    updatedAt: new Date().toISOString(), analyzed: entries.length, total,
    defectAnswers: withDefect.length, defectRate: +(defectRate * 100).toFixed(1),
    types, byMode, recent: withDefect.slice(0, 8).map((e) => ({ ts: e.ts, q: (e.q || '').slice(0, 40), types: (e.defects || []).map((d) => d.type) })),
  };
  try { writeFileSync(resolve(ROOT, 'logs/chat-verify-status.json'), JSON.stringify(status, null, 2)); } catch { /* */ }
  if (defectRate >= WARN_RATE) console.log(`\n🚨 [경고] 채팅 결함률 ${status.defectRate}% (임계 ${WARN_RATE * 100}%) — 프롬프트/검증 점검 필요`);
  else console.log(`\n✅ 채팅 결함률 ${status.defectRate}% (정상)`);
  console.log('');
} finally { r.disconnect(); }
