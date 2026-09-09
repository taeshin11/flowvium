#!/usr/bin/env node
/**
 * republish-report.mjs — 이미 발간된 회차를 **교정본으로 덮어쓴다**.
 *
 * 왜 (2026-09-10): 자정 회차가 "외국인 자금 유입을 견인했다"를 발간했다 — 실측은
 *   외국인 5,441억 순매도다. 교정기가 안 돌아 생긴 사실오류이고, 코드는 고쳤지만
 *   이미 Redis 에 올라간 회차는 다음 회차(06:43)까지 7시간 동안 그대로 나간다.
 *   틀린 사실이 라이브에 떠 있는 것을 기다릴 이유가 없다.
 *
 * 안전장치:
 *   · 로컬 파일을 verify-report 로 먼저 통과시킨 뒤에만 올린다 — 교정 안 된 것을 덮어쓰면 더 나쁘다.
 *   · generatedAt 은 원본 그대로 둔다. 새 회차인 척하면 히스토리가 어긋난다.
 *   · --yes 없이는 무엇을 올릴지 보여주기만 한다.
 *
 * 사용: node scripts/republish-report.mjs --file reports/report-....json [--yes]
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadEnvLocal } from './lib/llm-config.mjs';

loadEnvLocal();
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = arg('--file');
const YES = process.argv.includes('--yes');
if (!FILE) { console.error('사용: --file reports/report-....json [--yes]'); process.exit(2); }

const report = JSON.parse(readFileSync(FILE, 'utf8'));
const [, date, session, locale] = FILE.match(/report-(\d{4}-\d{2}-\d{2})-([a-z]+)-([a-z]{2})\.json$/) ?? [];
if (!date) { console.error(`파일명에서 회차를 못 읽는다: ${FILE}`); process.exit(2); }

// 교정 안 된 것을 올리면 문제를 키운다. 먼저 검증을 통과해야 한다.
const v = spawnSync(process.execPath, ['scripts/verify-report.mjs', FILE], { encoding: 'utf8' });
if (v.status !== 0) {
  console.error('❌ 이 파일은 아직 결함이 있다 — 올리지 않는다:');
  console.error(v.stdout.split('\n').filter((l) => l.includes('❌')).slice(0, 5).join('\n'));
  process.exit(1);
}
console.log('✓ 검증 통과');

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) { console.error('❌ UPSTASH_REDIS_REST_URL/TOKEN 이 없다'); process.exit(1); }

const keys = [
  [`flowvium:investment-strategy:v8:${date}:${session}:${locale}`, 86400],
  [`flowvium:investment-strategy:hist:report:${report.generatedAt}`, 90 * 86400],
  [`flowvium:investment-strategy:stale:v8:${locale}`, 7 * 86400],
];
console.log(`대상 ${date}:${session}:${locale} · generatedAt ${report.generatedAt}`);
for (const [k] of keys) console.log(`  · ${k}`);
if (!YES) { console.log('\n실제로 올리려면 --yes'); process.exit(0); }

// Upstash REST 는 **베이스 URL 에 명령 배열**을 POST 한다. 경로형(/set/<key>)로 보내면
//   HTTP 200 이 오지만 값은 안 들어간다 — 처음에 그렇게 쓰고 r.ok 만 보고 성공이라 적었다.
//   성공 판정은 result === 'OK' 이고, 마지막엔 반드시 되읽어 확인한다.
async function redisCmd(cmd) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  return (await res.json()).result;
}

for (const [k, ex] of keys) {
  const r = await redisCmd(['SET', k, JSON.stringify(report), 'EX', String(ex)]);
  console.log(r === 'OK' ? `  ✅ ${k.slice(0, 62)}` : `  ❌ ${k.slice(0, 62)} — ${JSON.stringify(r)}`);
}

// 되읽기 — 올렸다고 말하기 전에 실제로 들어갔는지 본다.
const back = await redisCmd(['GET', keys[0][0]]);
const got = back ? JSON.parse(back)?.generatedAt : null;
console.log(got === report.generatedAt
  ? `\n✅ 되읽기 확인 — ${keys[0][0].split(':').slice(-3).join(':')} = ${got}`
  : `\n❌ 되읽기 불일치 — 기대 ${report.generatedAt}, 실제 ${got ?? '(없음)'}`);
process.exit(got === report.generatedAt ? 0 : 1);
