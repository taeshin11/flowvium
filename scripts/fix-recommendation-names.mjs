#!/usr/bin/env node
/**
 * scripts/fix-recommendation-names.mjs — recommendations.name 의 ticker↔회사명 환각을 권위 맵으로 교정.
 *
 * 배경(2026-06-03): CPRT="Cypress Semiconductor", SMCI="Semiconductor Manufacturing International",
 *   CLX="Caterpillar" 등 LLM 이 ticker 에 *다른 회사* 이름을 붙인 행이 DB 에 다수 적재됨. name 검증이
 *   ~60개 하드코딩 화이트리스트로만 돼서 통과. company-names.json(companies-batch*.ts 추출 ~499 실제명)
 *   을 권위 소스로 DB 를 결정적 교정(수작업 아님 — 전 변경 로깅, idempotent).
 *
 * 사용: node scripts/fix-recommendation-names.mjs [--dry]
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';

const DRY = process.argv.includes('--dry');
const NAMES = JSON.parse(readFileSync('data/company-names.json', 'utf8'));

const SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|companies|ltd|limited|plc|llc|lp|holdings?|group|the|technologies|technology|sa|nv|ag|se)\b/g;
const norm = s => String(s || '').toLowerCase().replace(/[.,&'"()\-]/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
const matches = (a, b) => { const na = norm(a), nb = norm(b); if (!na || !nb) return true; return na === nb || na.includes(nb) || nb.includes(na); };

const db = new Database('data/flowvium.db');
const rows = db.prepare('SELECT id, ticker, name FROM recommendations').all();
const upd = db.prepare('UPDATE recommendations SET name = ? WHERE id = ?');

let fixed = 0;
const changes = [];
const tx = db.transaction(() => {
  for (const r of rows) {
    const auth = NAMES[(r.ticker || '').toUpperCase()];
    if (!auth || !r.name) continue;
    if (!matches(r.name, auth)) {
      changes.push(`${r.ticker}: "${r.name}" → "${auth}"`);
      if (!DRY) upd.run(auth, r.id);
      fixed++;
    }
  }
});
tx();

console.log(`[fix-recommendation-names]${DRY ? ' (DRY)' : ''} ${fixed} 행 교정 / ${rows.length} 검사 (권위명 ${Object.keys(NAMES).length})`);
for (const c of [...new Set(changes)]) console.log('  ', c);
db.close();
