#!/usr/bin/env node
/**
 * peek-retro-db.mjs — Redis 추천 추적 키 현황 점검
 *
 * 무엇이 쌓여 있고, 평가 가능한 항목은 몇 개인지 한눈에 확인.
 * 호출: node scripts/peek-retro-db.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function loadEnv() {
  const env = {};
  try {
    const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return env;
}
const env = loadEnv();
const URL_ = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
const TOKEN = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;

if (!URL_ || !TOKEN) {
  console.error('❌ UPSTASH 자격증명 없음');
  process.exit(1);
}

async function get(key) {
  const r = await fetch(`${URL_}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d?.result ?? null;
}
function parse(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

const KEYS = {
  PRED:    'flowvium:retro:predictions:v2',
  EVAL:    'flowvium:retro:evaluated:v2',
  SCORES:  'flowvium:retro:scores:v2',
  LESS_S2: 'flowvium:retro:lessons:s2:v2',
  LESS_S7: 'flowvium:retro:lessons:s7:v2',
  HIST:    'flowvium:investment-strategy:history:arr:v1',
};

const now = new Date().toISOString();
console.log(`\n=== Redis 추천 추적 현황 (${now.slice(0, 19)}) ===\n`);

const [predRaw, evalRaw, scoresRaw, lessS2, lessS7, histRaw] = await Promise.all([
  get(KEYS.PRED), get(KEYS.EVAL), get(KEYS.SCORES),
  get(KEYS.LESS_S2), get(KEYS.LESS_S7), get(KEYS.HIST),
]);

const pred = parse(predRaw) ?? [];
const evals = parse(evalRaw) ?? [];
const scores = parse(scoresRaw);
const hist = parse(histRaw) ?? [];

const overdue = Array.isArray(pred) ? pred.filter(p => p?.evaluateAfter <= now) : [];
const pending = Array.isArray(pred) ? pred.filter(p => p?.evaluateAfter > now) : [];

console.log(`📦 predictions (${KEYS.PRED})`);
console.log(`   총 ${Array.isArray(pred) ? pred.length : 0} 건`);
console.log(`   • 평가 대기 (evaluateAfter > now): ${pending.length}`);
console.log(`   • 평가 가능 (overdue):              ${overdue.length}`);
if (overdue.length > 0) {
  const sample = overdue.slice(0, 5).map(p => `${p.ticker}@${p.generatedAt?.slice(0,10)}`);
  console.log(`     샘플: ${sample.join(', ')}`);
}
if (pending.length > 0) {
  const earliestEval = pending.map(p => p.evaluateAfter).sort()[0];
  console.log(`     첫 평가 가능 시점: ${earliestEval?.slice(0, 10)}`);
}

console.log(`\n📊 evaluated (${KEYS.EVAL})`);
console.log(`   총 ${Array.isArray(evals) ? evals.length : 0} 건`);
if (Array.isArray(evals) && evals.length > 0) {
  const byOutcome = {};
  for (const e of evals) byOutcome[e.outcome ?? 'unknown'] = (byOutcome[e.outcome ?? 'unknown'] ?? 0) + 1;
  console.log(`   outcome: ${JSON.stringify(byOutcome)}`);
}

console.log(`\n📈 aggregate scores (${KEYS.SCORES})`);
if (scores) {
  console.log(`   samples=${scores.samples} quality=${scores.avg_quality}/100`);
  console.log(`   direction=${(scores.avg_direction*100).toFixed(0)}% entry=${(scores.avg_entry*100).toFixed(0)}% target=${(scores.avg_target*100).toFixed(0)}%`);
} else {
  console.log(`   (없음 — 평가 후 자동 생성)`);
}

console.log(`\n📚 history (${KEYS.HIST})`);
console.log(`   ${Array.isArray(hist) ? hist.length : 0} 보고서 메타`);

console.log(`\n📝 lessons`);
console.log(`   S2 tactical: ${lessS2 ? `${String(lessS2).length} chars` : '없음'}`);
console.log(`   S7 strategic: ${lessS7 ? `${String(lessS7).length} chars` : '없음'}`);

console.log('');
if (overdue.length === 0 && (!Array.isArray(evals) || evals.length === 0)) {
  console.log('💡 평가 가능 항목 없음 — backfill 추천의 evaluateAfter 가 14일 후라 아직 대기 중.');
  console.log('   해결책: backfill 데이터의 evaluateAfter 를 지나간 날짜로 재기록하면');
  console.log('         과거 보고서 → 현재 가격 비교로 즉시 평가 가능.');
}
