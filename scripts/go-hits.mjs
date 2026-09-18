#!/usr/bin/env node
/**
 * go-hits.mjs — 유튜브 설명란 링크(/go/{locale})로 들어온 사람 수. (2026-09-18 신설)
 *
 * 왜: 편성을 조회수로 정하고 있었는데, 목표는 사이트 유입이다. 둘은 다르다 —
 *   정치 영상을 본 사람이 증시 사이트에 올 확률은 증시 영상을 본 사람보다 낮다.
 *   그런데 그 유입을 아무도 세지 않아서 확인할 방법이 없었다. 이제 센다.
 *
 * 사용: node scripts/go-hits.mjs [--days 14]
 */
import { loadEnvLocal } from './lib/llm-config.mjs';
loadEnvLocal?.();

const days = (() => { const i = process.argv.indexOf('--days'); return i > 0 ? Number(process.argv[i + 1]) : 14; })();
const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
if (!url || !token) { console.error('❌ UPSTASH_REDIS_REST_URL/TOKEN 이 없다'); process.exit(2); }

const get = async (key) => {
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return 0;
  const j = await r.json();
  return Number(j?.result ?? 0) || 0;
};

const kst = (d) => new Date(Date.now() + 9 * 3600000 - d * 864e5).toISOString().slice(0, 10);
const LOCALES = ['ko', 'en', 'ja'];
const SRC = ['youtube', 'other', 'direct'];

console.log(`유튜브 설명란 링크 유입 (최근 ${days}일 · KST)\n`);
console.log('  날짜         유튜브   기타   직접   합계');
let tot = 0;
for (let d = days - 1; d >= 0; d -= 1) {
  const day = kst(d);
  const per = {};
  for (const s of SRC) {
    let n = 0;
    for (const l of LOCALES) n += await get(`flowvium:go:${day}:${l}:${s}`);
    per[s] = n;
  }
  const sum = SRC.reduce((a, s) => a + per[s], 0);
  tot += sum;
  if (sum) console.log(`  ${day}  ${String(per.youtube).padStart(6)} ${String(per.other).padStart(6)} ${String(per.direct).padStart(6)} ${String(sum).padStart(6)}`);
}
console.log(`\n  합계 ${tot}건`);
if (!tot) console.log('  (아직 기록이 없다 — 배포 후부터 쌓인다)');
