#!/usr/bin/env node
/**
 * llm-config.test.mjs — LLM 접속 정보(URL·모델)의 단일 소스.
 *
 * 배경(2026-08-20 실측): cron 의 segments-refresh 가 15회 실행에 성공 0 / 실패 90 (0.0%)이었다.
 *   20분마다 GPU 를 달구면서 아무것도 못 만들고 있었다. 원인을 따라가 보니:
 *     build-segments-dynamic.mjs:178  model: process.env.OLLAMA_TRANSLATE_MODEL || 'flowvium-local'
 *     · 이 스크립트는 .env.local 을 읽지 않는다(그 로딩은 generate-report-local.mjs 안에만 있다)
 *     · cron-runner 의 launchd 환경에도 그 변수가 없다
 *     → 옛 Ollama 별칭 'flowvium-local' 로 폴백 → mlx 가 HTTP 404 로 거부
 *     → `if (!r.ok) return []` 이 조용히 삼킴 → 'exaone-no-rows' 로 보고
 *   실측 확인: default_model → 200 · flowvium-local → 404.
 *   Qwen 이관 때 남은 구멍이고, 폴백 기본값이 '서버가 거부하는 값'이라 영원히 실패한다.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let C;
try { C = await import('./llm-config.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

// [1] .env.local 을 읽어 process.env 에 주입 (기존 env 는 보존)
const env = C.loadEnvLocal();
env.VLLM_MODEL ? ok(`.env.local 로드 (VLLM_MODEL=${env.VLLM_MODEL})`) : bad('.env.local 로드 실패');
process.env.VLLM_MODEL === env.VLLM_MODEL ? ok('process.env 주입') : bad('process.env 미주입');

// [2] 레인별 해석
const rep = C.resolveLlm('report');
rep.url.includes('8000') && rep.model ? ok(`report 레인: ${rep.url} · ${rep.model}`) : bad(`report 레인 이상: ${JSON.stringify(rep)}`);
const web = C.resolveLlm('web');
web.url.includes('8001') && web.model ? ok(`web 레인: ${web.url} · ${web.model}`) : bad(`web 레인 이상: ${JSON.stringify(web)}`);

// [3] 서버가 거부하는 옛 별칭을 기본값으로 쓰면 안 된다 — 그게 이번 사고의 원인이다
for (const stale of ['flowvium-local', 'qwen3:8b', 'exaone']) {
  rep.model !== stale && web.model !== stale ? ok(`옛 별칭 미사용: ${stale}`) : bad(`옛 별칭을 반환: ${stale}`);
}

// [4] 실행 경로의 스크립트들이 옛 별칭을 폴백으로 들고 있으면 드러나야 한다
const stalePat = /['"`](flowvium-local|qwen3:8b)['"`]/;
const offenders = [];
for (const f of readdirSync(resolve(ROOT, 'scripts')).filter(x => x.endsWith('.mjs'))) {
  const p = resolve(ROOT, 'scripts', f);
  let src = ''; try { src = readFileSync(p, 'utf8'); } catch { continue; }
  // 주석 줄은 제외 — 사고 경위 기록은 남겨야 한다
  const live = src.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  if (stalePat.test(live)) offenders.push(f);
}
offenders.length === 0
  ? ok('실행 경로에 옛 모델 별칭 폴백 없음')
  : bad(`옛 별칭 폴백 잔존 ${offenders.length}개: ${offenders.join(', ')}`);

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
