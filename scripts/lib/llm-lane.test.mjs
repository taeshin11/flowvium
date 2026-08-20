#!/usr/bin/env node
/**
 * llm-lane.test.mjs — 웹 경유 LLM(번역·챗)이 보고서 생성과 분리된 레인을 쓰는지 검증.
 *
 * 배경(2026-08-20 실측):
 *   · 원래 구조는 vLLM(:8000, 보고서)과 Ollama(번역)가 분리돼 있었다. 맥 이관에서 하나로 합쳤다.
 *   · OOM 방지를 위해 --prompt-concurrency 1 을 걸자, 보고서의 20분짜리 프리필이 LLM 을 독점한다.
 *   · localChatNoBleed 의 timeoutMs 60000 을 넘겨 항상 null → route.ts:74 조건 미충족 →
 *     cloud fallback → LLM_LOCAL_ONLY=1 로 키 revoked → 원문(영문) 그대로 반환.
 *   · 실측: 보고서 생성 중 /api/translate 가 "Apple designs and sells smartphones." 원문 반환(30초).
 *     같은 프롬프트를 :8000 에 직접 보내면 300초 타임아웃(빈 응답).
 *   · 화면 증거: 한국어 리포트 페이지의 뉴스 헤드라인이 영문 그대로.
 *
 * 검증: 웹 레인 URL 이 보고서 레인과 분리 가능해야 하고(설정으로), 분리했을 때 실제로 응답해야 한다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// ① 코드가 별도 레인 URL 을 인식해야 한다
const src = readFileSync(resolve(ROOT, 'src/lib/llm-local.ts'), 'utf8');
/LOCAL_LLM_URL/.test(src) ? ok('llm-local.ts 가 LOCAL_LLM_URL 인식')
                          : bad('llm-local.ts 가 VLLM_URL 하나만 쓴다 — 보고서와 같은 레인');

// ② 설정에 레인이 지정돼 있어야 한다
const env = (() => { try { return readFileSync(resolve(ROOT, '.env.local'), 'utf8'); } catch { return ''; } })();
/^LOCAL_LLM_URL=/m.test(env) ? ok('.env.local 에 LOCAL_LLM_URL 설정')
                             : bad('.env.local 에 LOCAL_LLM_URL 없음');

// ③ 웹 레인이 실제로 응답해야 한다 (보고서가 돌든 말든)
const laneUrl = (env.match(/^LOCAL_LLM_URL=(.+)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
if (!laneUrl) { bad('레인 URL 미설정 — 응답 확인 불가'); }
else {
  const t0 = Date.now();
  try {
    const r = await fetch(`${laneUrl.replace(/\/+$/, '')}/models`, { signal: AbortSignal.timeout(10_000) });
    r.ok ? ok(`웹 레인 도달 ${laneUrl} (${Date.now() - t0}ms)`) : bad(`웹 레인 HTTP ${r.status}`);
  } catch (e) { bad(`웹 레인 도달 실패 ${laneUrl} — ${e.cause?.message ?? e.message}`); }
}
console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
