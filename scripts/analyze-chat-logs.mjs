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

  // ── 폐루프 효과 검증(2026-06-18): 챗 결함→프롬프트 anti-pattern 주입 루프가 *실제로 결함을 줄이는지*.
  //   교정율(corrected): sanitize 결정론 레이어가 결함을 답변 반환 전 제거한 비율. "검증→교정" 시스템화 증거.
  // 2026-07-10: 건수 half-split → *시간창* 비교(최근 7일 vs 이전)로 교체 — 트래픽이 버스트형이라
  //   half-split 은 "최근 절반"이 수주 전 사건일(07-06 vLLM 다운+hanja 버스트)을 포함해
  //   "악화 30.6% vs 10.9%" 오판을 냈다(당일 실측: 최근 4일 결함 0). 추세는 달력 기준이어야 한다.
  const RECENT_MS = 7 * 24 * 3600 * 1000;
  const cutoff = Date.now() - RECENT_MS;
  const tsOf = (e) => { const t = new Date(e.ts ?? 0).getTime(); return Number.isFinite(t) ? t : 0; };
  const recentEntries = entries.filter((e) => tsOf(e) >= cutoff);
  const olderEntries = entries.filter((e) => tsOf(e) < cutoff);
  const rateOf = (arr) => arr.length ? arr.filter((e) => (e.defectCount ?? 0) > 0).length / arr.length : 0;
  const recentRate = rateOf(recentEntries);
  const olderRate = rateOf(olderEntries);
  const trend = (recentEntries.length >= 10 && olderEntries.length >= 10)
    ? (recentRate < olderRate - 0.02 ? '개선' : recentRate > olderRate + 0.02 ? '악화' : '횡보')
    : `n/a(표본부족 최근7일 ${recentEntries.length}건)`;
  const recentTypes = {}, olderTypes = {};
  for (const e of recentEntries) for (const d of (e.defects ?? [])) recentTypes[d.type] = 1;
  for (const e of olderEntries) for (const d of (e.defects ?? [])) olderTypes[d.type] = 1;
  const persistent = Object.keys(recentTypes).filter((t) => olderTypes[t]); // 과거·최근 모두 — 루프가 못 잡는 유형
  const correctedN = entries.filter((e) => e.corrected).length;
  const closedLoop = { recentRate: +(recentRate * 100).toFixed(1), olderRate: +(olderRate * 100).toFixed(1), trend, persistent, correctedRate: +(correctedN / entries.length * 100).toFixed(1) };
  console.log(`\n[폐루프 효과] 최근 ${closedLoop.recentRate}% vs 과거 ${closedLoop.olderRate}% → ${trend} | sanitize 교정율 ${closedLoop.correctedRate}%`);
  if (persistent.length) console.log(`  ⚠️ 루프가 못 잡는 잔존 결함유형: ${persistent.join(', ')} — 프롬프트 교훈 강화 또는 결정론 sanitize 규칙 추가 필요`);

  // ■5 死藏 해소(2026-07-06 AISVI "loop 3단 점검" 차용): flowvium:discovered-tickers ZSET 은 judge-chat 이
  //   기록만 하고 소비처 0 이던 프로듀서-only loop — 매 사이클 상위 발견종목을 surface(유니버스 승격 검토 입력).
  let discoveredTop = [];
  try {
    const raw = await r.zrevrange('flowvium:discovered-tickers', 0, 9, 'WITHSCORES');
    for (let i = 0; i < raw.length; i += 2) discoveredTop.push({ ticker: raw[i], asks: Number(raw[i + 1]) });
    if (discoveredTop.length) console.log(`\n[풀 밖 발견종목 Top — 유니버스 승격 검토]\n  ${discoveredTop.map((d) => `${d.ticker}(${d.asks}회)`).join(', ')}`);
  } catch { /* 비치명 */ }

  // 상태파일 기록(모니터/대시보드 소비) + 결함률 경고. 매 cron 사이클 자동 갱신.
  const defectRate = withDefect.length / entries.length;
  const status = {
    updatedAt: new Date().toISOString(), analyzed: entries.length, total,
    defectAnswers: withDefect.length, defectRate: +(defectRate * 100).toFixed(1),
    types, byMode, closedLoop, discoveredTop,
    recent: withDefect.slice(0, 8).map((e) => ({ ts: e.ts, q: (e.q || '').slice(0, 40), types: (e.defects || []).map((d) => d.type) })),
  };
  try { writeFileSync(resolve(ROOT, 'logs/chat-verify-status.json'), JSON.stringify(status, null, 2)); } catch { /* */ }
  if (defectRate >= WARN_RATE) console.log(`\n🚨 [경고] 채팅 결함률 ${status.defectRate}% (임계 ${WARN_RATE * 100}%) — 프롬프트/검증 점검 필요`);
  else console.log(`\n✅ 채팅 결함률 ${status.defectRate}% (정상)`);
  console.log('');
} finally { r.disconnect(); }
