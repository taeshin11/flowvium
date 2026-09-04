#!/usr/bin/env node
/**
 * footage-report.mjs — 소재 선택 실태를 숫자로 본다.
 *
 * 사용자(2026-09-04): "지켜보면서 고치자".
 *   매 회차 영상을 열어 확인하는 대신, 쌓인 기록으로 경향을 본다.
 *   "카드 비율이 높다" · "재사용이 잦다" · "통신사 출처가 늘었다" 를 바로 알 수 있어야
 *   근거를 가지고 고칠 수 있다.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const f = resolve(ROOT, 'logs/footage-picks.jsonl');
if (!existsSync(f)) { console.log('아직 기록이 없다 — 다음 렌더부터 쌓인다'); process.exit(0); }
const rows = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const days = Number((process.argv.find((a) => a.startsWith('--days=')) ?? '').split('=')[1] ?? 7);
const since = Date.now() - days * 86400000;
const recent = rows.filter((r) => new Date(r.at).getTime() >= since);
if (!recent.length) { console.log(`최근 ${days}일 기록 없음 (전체 ${rows.length}건)`); process.exit(0); }

let picked = 0, reused = 0, card = 0, risky = 0, total = 0;
const bySource = new Map();
for (const r of recent) for (const s of r.scenes ?? []) {
  total++;
  if (s.card) card++;
  else if (s.reused) reused++;
  else if (s.picked) { picked++; bySource.set(s.picked.source, (bySource.get(s.picked.source) ?? 0) + 1); if (s.picked.risky) risky++; }
}
const pct = (n) => `${(n / total * 100).toFixed(0)}%`;
console.log(`  최근 ${days}일 · 편 ${recent.length} · 장면 ${total}`);
console.log(`    새 소재  ${String(picked).padStart(3)}  ${pct(picked)}`);
console.log(`    재사용   ${String(reused).padStart(3)}  ${pct(reused)}`);
console.log(`    카드     ${String(card).padStart(3)}  ${pct(card)}   ← 높으면 소재를 못 찾고 있다는 뜻`);
if (risky) console.log(`    ⚠ 통신사 출처 ${risky}건 — 저작권 위험`);
console.log('  출처:');
for (const [src, n] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${String(src).padEnd(28)} ${n}`);
console.log('\n  최근 편의 훅(썸네일이 되는 1번만):');
for (const r of recent.slice(-6)) console.log(`    ${r.at.slice(5, 16)} [${r.issue}] ${r.scenes?.[0]?.hook ?? ''}`);
