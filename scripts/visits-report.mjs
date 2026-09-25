#!/usr/bin/env node
/**
 * visits-report.mjs — flowvium.net 방문자 요약(자가호스팅 측정, 2026-09-25).
 * 사용: node scripts/visits-report.mjs [--days 7]
 * 데이터: data/visits.db (src/lib/visits.ts 가 쓴다). 봇은 들어올 때 이미 걸렀다.
 */
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const i = process.argv.indexOf('--days');
const DAYS = i > 0 ? Number(process.argv[i + 1]) || 7 : 7;
const f = resolve(ROOT, 'data/visits.db');
if (!existsSync(f)) { console.log('아직 기록이 없다(data/visits.db 없음) — 배포 뒤 첫 방문부터 쌓인다'); process.exit(0); }
const db = new Database(f, { readonly: true });
const since = new Date(Date.now() + 9 * 3600e3 - (DAYS - 1) * 86400e3).toISOString().slice(0, 10);
const q = (sql, ...a) => db.prepare(sql).all(...a);
console.log(`=== flowvium.net 방문 (최근 ${DAYS}일, KST, ${since}~) ===\n`);
console.log('날짜         방문자   조회');
for (const r of q(`SELECT day, COUNT(DISTINCT visitor) v, COUNT(*) n FROM page_views WHERE day >= ? GROUP BY day ORDER BY day`, since))
  console.log(`${r.day}   ${String(r.v).padStart(6)}  ${String(r.n).padStart(5)}`);
const block = (title, sql) => {
  console.log(`\n${title}`);
  for (const r of q(sql, since)) console.log(`  ${String(r.k ?? '(없음)').slice(0, 48).padEnd(48)} ${String(r.v).padStart(5)}명 ${String(r.n).padStart(6)}회`);
};
block('많이 본 페이지', `SELECT path k, COUNT(DISTINCT visitor) v, COUNT(*) n FROM page_views WHERE day >= ? GROUP BY path ORDER BY n DESC LIMIT 15`);
block('유입처(첫 페이지 기준 아님 — 조회마다)', `SELECT ref k, COUNT(DISTINCT visitor) v, COUNT(*) n FROM page_views WHERE day >= ? AND ref != '(내부)' GROUP BY ref ORDER BY v DESC LIMIT 12`);
block('utm_source', `SELECT utm k, COUNT(DISTINCT visitor) v, COUNT(*) n FROM page_views WHERE day >= ? AND utm IS NOT NULL GROUP BY utm ORDER BY v DESC LIMIT 10`);
block('나라', `SELECT country k, COUNT(DISTINCT visitor) v, COUNT(*) n FROM page_views WHERE day >= ? GROUP BY country ORDER BY v DESC LIMIT 10`);
block('로케일', `SELECT locale k, COUNT(DISTINCT visitor) v, COUNT(*) n FROM page_views WHERE day >= ? GROUP BY locale ORDER BY v DESC LIMIT 10`);
