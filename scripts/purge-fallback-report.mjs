#!/usr/bin/env node
// scripts/purge-fallback-report.mjs
// fallback 보고서 감지 + 삭제 (2026-06-17 사용자 "fallback 보고서는 절대 못올라가게 하고 설사 올라갔어도
//   감지하고 지워야"). 발행 경로 차단(uploadFromFile source 게이트) + 라우트 캐싱 차단(route.ts isFallback)
//   에 더한 3중 안전망: Redis 에 이미 올라간 fallback 을 SCAN 으로 찾아 삭제.
// 동작: flowvium:investment-strategy:v8:* (세션) + :stale:v8:* 키를 SCAN → 각 GET → 저장된 source 가
//   real(local-/cloud provider) 이 아니면 DEL. hist:* 는 과거기록이라 건드리지 않음.
// 출력 1줄 "PURGE-FALLBACK OK/ALERT ...". exit 0(삭제 0) / 1(삭제 발생 — 라이브에 fallback 있었음).
// 사용: node scripts/purge-fallback-report.mjs [--dry]
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');

// .env.local 로드
const env = {};
try {
  const p = resolve(ROOT, '.env.local');
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const URL = env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SITE = (env.NEXT_PUBLIC_SITE_URL || 'https://flowvium.net').replace(/\s+/g, '');

const out = (line, code) => { console.log(line); process.exitCode = code; setTimeout(() => process.exit(code), 1500).unref(); };
if (!URL || !TOKEN) { out('PURGE-FALLBACK ALERT: Upstash env 없음 — 검사 불가', 1); }

async function rpost(body) {
  const r = await fetch(URL, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return (await r.json()).result;
}
// 2026-06-17 전수조사 C2: 삭제 판정을 'REAL 화이트리스트 밖이면 삭제'(위험 — 신규 provider 실보고서
//   exaone/deepseek/gpt 등을 fallback 으로 오인해 *실제 보고서 삭제* = 데이터손실)에서 → 'fallback 마커에
//   명시적으로 해당할 때만 삭제'로 반전. 빈 source 는 의심스럽지만 삭제 안 함(route 발행게이트가 이미 차단).
const REAL = /^(local-|gemini|groq|claude|openrouter|qwen|vllm|gpt|openai|anthropic|deepseek|mistral|exaone|llama|cohere)/i;
const FALLBACK = /^(fallback|data$|데이터\s*기반)/i; // 'fallback','fallback-no-prices','data','데이터 기반 모델'
const isFallbackSrc = (s) => FALLBACK.test(String(s ?? ''));

async function scan(pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const res = await rpost(['SCAN', cursor, 'MATCH', pattern, 'COUNT', '200']);
    cursor = Array.isArray(res) ? res[0] : '0';
    const batch = Array.isArray(res) ? res[1] : [];
    if (Array.isArray(batch)) keys.push(...batch);
  } while (cursor !== '0' && keys.length < 2000);
  return keys;
}

const deleted = [];
const checked = [];
const deletedGenAt = new Set(); // 히스토리 배열에서 제거할 generatedAt
try {
  // 세션 키 + stale 키 + 히스토리 리포트 키 — fallback source 면 모두 삭제.
  //   (2026-06-17: 히스토리도 포함 — 발행 실패로 route 가 캐싱한 fallback 이 hist:report 키(90일)에 남아
  //    히스토리 탭에 'Fallback' 보고서로 노출되던 것 제거. 단 real source 과거 보고서는 보존.)
  const keys = [...new Set([
    ...(await scan('flowvium:investment-strategy:v8:*')),
    ...(await scan('flowvium:investment-strategy:stale:v8:*')),
    ...(await scan('flowvium:investment-strategy:hist:report:*')),
  ])];
  for (const k of keys) {
    let j = null;
    try { const raw = await rpost(['GET', k]); j = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { continue; }
    const src = String(j?.source ?? '');
    checked.push({ k, src });
    if (isFallbackSrc(src)) { // 명시적 fallback 마커만 삭제 (REAL 화이트리스트 역방향 아님 — 데이터손실 방지)
      if (!DRY) await rpost(['DEL', k]);
      if (j?.generatedAt) deletedGenAt.add(j.generatedAt);
      deleted.push({ k: k.replace('flowvium:investment-strategy:', ''), src });
    }
  }
  // 히스토리 배열에서 fallback 엔트리 제거 (source 가 fallback 이거나 위에서 삭제된 generatedAt).
  try {
    const HIST_KEY = 'flowvium:investment-strategy:history:arr:v1';
    const raw = await rpost(['GET', HIST_KEY]);
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(arr)) {
      // 비-fallback 은 보존(신규 provider 포함), 명시적 fallback + 위에서 삭제된 generatedAt 만 제거.
      const cleaned = arr.filter((e) => !isFallbackSrc(e?.source) && !deletedGenAt.has(e?.generatedAt));
      if (cleaned.length !== arr.length) {
        if (!DRY) await rpost(['SET', HIST_KEY, JSON.stringify(cleaned)]);
        deleted.push({ k: `history:arr (${arr.length - cleaned.length}개 엔트리)`, src: 'history-meta' });
      }
    }
  } catch { /* 히스토리 배열 정리 실패 비치명 */ }
} catch (e) { out(`PURGE-FALLBACK ALERT: SCAN 실패 ${String(e?.message).slice(0, 60)}`, 1); }

// 라이브 현재 source (참고)
let liveSrc = '?';
try { const r = await fetch(`${SITE}/api/investment-strategy`, { signal: AbortSignal.timeout(9000), headers: { connection: 'close' } }); if (r.ok) liveSrc = String((await r.json()).source ?? '?'); } catch {}

if (deleted.length) {
  out(`PURGE-FALLBACK ALERT: ${DRY ? '[dry] ' : ''}fallback ${deleted.length}개 ${DRY ? '발견' : '삭제'} (live=${liveSrc}) — ${deleted.slice(0, 4).map((d) => `${d.k}=${d.src}`).join(', ')}`, 1);
} else {
  out(`PURGE-FALLBACK OK  ${checked.length}키 검사, fallback 0 (live=${liveSrc})`, 0);
}
