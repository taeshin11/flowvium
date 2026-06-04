#!/usr/bin/env node
/**
 * scripts/inject-iv.mjs — 발행된 investment-strategy 캐시의 portfolio 에 종목별 내재변동성(IV) 주입.
 *   IV 통합(generate-report-local) 배포 전 생성된 보고서가 즉시 IV 를 갖도록. 일회성.
 *   US 옵션 IV(atmIv30d) — KR 은 옵션 미제공 → null.
 */
import { readFileSync } from 'fs';
const SITE = 'http://localhost:3000';
const env = {};
for (const l of readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const cmd = a => fetch(env.UPSTASH_REDIS_REST_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).then(r => r.json()).then(j => j.result);
const safeFetch = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(9000) }); return r.ok ? await r.json() : null; } catch { return null; } };

let cur = '0', keys = [];
do { const r = await cmd(['SCAN', cur, 'MATCH', 'flowvium:investment-strategy:*', 'COUNT', '200']); cur = r[0]; keys.push(...r[1]); } while (cur !== '0');
let n = 0;
for (const k of keys) {
  const raw = await cmd(['GET', k]); if (!raw) continue;
  let s; try { s = JSON.parse(raw); } catch { continue; }
  if (!s || !Array.isArray(s.portfolio)) continue;
  let touched = 0;
  for (const p of s.portfolio) {
    if (!p.ticker || /\.(KS|KQ)$/.test(p.ticker)) { p.impliedVol = null; continue; }
    const iv = await safeFetch(`${SITE}/api/iv/${encodeURIComponent(p.ticker)}`);
    p.impliedVol = (iv && typeof iv.atmIv30d === 'number') ? Math.round(iv.atmIv30d * 1000) / 10 : null;
    p.ivSkew = (iv && typeof iv.skew25d === 'number') ? Math.round(iv.skew25d * 1000) / 10 : null;
    if (p.impliedVol != null) touched++;
  }
  if (touched > 0) { await cmd(['SET', k, JSON.stringify(s), 'KEEPTTL']); n++; }
}
console.log(`[inject-iv] ${n}/${keys.length} 키 주입`);
