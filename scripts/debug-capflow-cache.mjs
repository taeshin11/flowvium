#!/usr/bin/env node
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __d = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__d, '..');
function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return env;
}
const env = loadEnv();
const URL_ = env.UPSTASH_REDIS_REST_URL;
const TOKEN = env.UPSTASH_REDIS_REST_TOKEN;

async function getKey(key) {
  const r = await fetch(`${URL_}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) return { err: r.status };
  const d = await r.json();
  return d?.result;
}
async function delKey(key) {
  const r = await fetch(`${URL_}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return r.ok ? await r.json() : null;
}

const KEYS = [
  'flowvium:capital-flows:v11:yahoo',
  'flowvium:capital-flows:v11:twelve',
  'flowvium:capital-flows:v12:yahoo',
  'flowvium:capital-flows:v12:twelve',
  'flowvium:capital-flows:stale:yahoo',
  'flowvium:capital-flows:stale:twelve',
  'flowvium:capital-flows:stale:any',
  'flowvium:capital-flows:stale:v2:yahoo',
  'flowvium:capital-flows:stale:v2:twelve',
  'flowvium:capital-flows:stale:v2:any',
];

const cmd = process.argv[2] ?? 'list';

if (cmd === 'list') {
  console.log('\n=== Redis capital-flows 키 현황 ===\n');
  for (const k of KEYS) {
    const v = await getKey(k);
    if (v == null) { console.log(`(empty)        ${k}`); continue; }
    let obj;
    try { obj = typeof v === 'string' ? JSON.parse(v) : v; } catch { obj = null; }
    const updated = obj?.updatedAt ?? obj?.dataAsOf ?? '?';
    const wAgo = obj?.flow?.rotations1w?.[0]?.weeksAgo;
    const size = (typeof v === 'string' ? v.length : JSON.stringify(v ?? '').length);
    console.log(`(${size}B) updatedAt=${updated} rotations1w[0].weeksAgo=${wAgo}  ${k}`);
  }
} else if (cmd === 'purge') {
  console.log('\n=== 모든 capital-flows 캐시 키 삭제 ===\n');
  for (const k of KEYS) {
    const r = await delKey(k);
    console.log(`  del ${k} → ${JSON.stringify(r)}`);
  }
}
