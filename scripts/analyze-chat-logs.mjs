#!/usr/bin/env node
// analyze-chat-logs.mjs — 채팅 질답 검증로그(flowvium:judge-chat:verify) 누적 분석 (2026-06-18 사용자
//   "이전 질답로그 분석하고있어?"). per-answer 검증을 모아 결함률·유형·추세·최근 결함 예시를 요약한다.
//   실행: node scripts/analyze-chat-logs.mjs [--n=500]
import Redis from 'ioredis';

const N = Number((process.argv.find(a => a.startsWith('--n=')) || '--n=1000').split('=')[1]);
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
  console.log('');
} finally { r.disconnect(); }
