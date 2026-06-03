#!/usr/bin/env node
/**
 * scripts/fix-published-strategy-names.mjs — Redis 에 발행된 investment-strategy 캐시의 회사명 환각 교정.
 *
 * 배경(2026-06-03): /report 화면은 Redis 키(flowvium:investment-strategy:*) 의 strategy 를 표시.
 *   DB recommendations 만 고쳐도 캐시가 옛 name(CPRT="Cypress Semiconductor")을 유지 → 화면 그대로.
 *   이 스크립트가 발행된 모든 strategy 캐시의 portfolio/companyChanges name 을 권위 맵으로 교정.
 *
 * 사용: node scripts/fix-published-strategy-names.mjs [--dry]
 */
import { readFileSync } from 'fs';

const DRY = process.argv.includes('--dry');
const NAMES = JSON.parse(readFileSync('data/company-names.json', 'utf8'));

// .env.local 직접 파싱 (UPSTASH 자격증명)
const envRaw = readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envRaw.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = env.UPSTASH_REDIS_REST_URL, TOKEN = env.UPSTASH_REDIS_REST_TOKEN;
if (!URL || !TOKEN) { console.error('UPSTASH env 누락'); process.exit(1); }

async function cmd(arr) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(arr),
  });
  return (await res.json()).result;
}

const SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|companies|ltd|limited|plc|llc|lp|holdings?|group|the|technologies|technology|sa|nv|ag|se)\b/g;
const norm = s => String(s || '').toLowerCase().replace(/[.,&'"()\-]/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
const matches = (a, b) => { const na = norm(a), nb = norm(b); if (!na || !nb) return true; return na === nb || na.includes(nb) || nb.includes(na); };

function fixArr(arr, changes, where) {
  if (!Array.isArray(arr)) return 0;
  let n = 0;
  for (const it of arr) {
    const auth = NAMES[(it?.ticker || '').toUpperCase()];
    if (!auth || !it.name) continue;
    if (!matches(it.name, auth)) { changes.push(`${it.ticker}: "${it.name}" → "${auth}" [${where}]`); it.name = auth; n++; }
  }
  return n;
}

// SCAN 전체 키
async function scanAll(pattern) {
  let cursor = '0', keys = [];
  do {
    const r = await cmd(['SCAN', cursor, 'MATCH', pattern, 'COUNT', '200']);
    cursor = r[0]; keys.push(...r[1]);
  } while (cursor !== '0');
  return keys;
}

const keys = await scanAll('flowvium:investment-strategy:*');
console.log(`[fix-published] ${keys.length} strategy 키 스캔`);
let totalFixed = 0, keysTouched = 0;
const allChanges = [];

for (const key of keys) {
  const raw = await cmd(['GET', key]);
  if (!raw) continue;
  let obj; try { obj = JSON.parse(raw); } catch { continue; }
  const strat = obj && typeof obj === 'object' ? obj : null;
  if (!strat) continue;
  const changes = [];
  let n = 0;
  n += fixArr(strat.portfolio, changes, 'portfolio');
  n += fixArr(strat.companyChanges, changes, 'companyChanges');
  if (n > 0) {
    keysTouched++; totalFixed += n;
    allChanges.push(`  · ${key.slice(0, 60)} (${n})`);
    for (const c of changes) allChanges.push(`      ${c}`);
    if (!DRY) await cmd(['SET', key, JSON.stringify(strat), 'KEEPTTL']);
  }
}

console.log(`[fix-published]${DRY ? ' (DRY)' : ''} ${keysTouched} 키 / ${totalFixed} name 교정`);
for (const c of allChanges) console.log(c);
