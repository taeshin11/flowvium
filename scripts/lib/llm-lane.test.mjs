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
// 2026-08-22: 이 테스트가 무엇을 필요로 하는지 스스로 선언한다. 없으면 스킵(코드 77).
//   CI(깨끗한 clone)엔 .env.local·라이브 LLM·데이터가 든 DB 가 없다 — 그걸 '실패' 로 세면
//   CI 가 상시 빨갛고, 상시 빨간 CI 는 아무도 안 본다. --strict 에서는 스킵도 실패로 센다.
import { requires } from './test-env.mjs';
await requires({ envFile: true, env: ['LOCAL_LLM_URL'] });

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
// ── 2026-09-02: 이 레인을 아무도 감시하지 않았다 ────────────────────────────────
//   실측 사고: :8001 이 Metal OOM 으로 죽었다(09-01 05:58, mlx-web.log 의
//   `RuntimeError: [METAL] Command buffer execution failed: Insufficient Memory`).
//   그 뒤 **37시간** 동안:
//     · 유튜브 자동 게시가 6회 연속 실패 (video/make-issue-video.mjs 가 대본을 :8001 로 뽑는다)
//     · 사이트 번역·챗도 같은 레인이라 함께 죽어 있었다
//   그런데 모니터는 20분마다 돌면서 아무 알람도 내지 않았다 — check-stall 이 :8000 만 보기 때문이다.
//
//   08-28 사건 때 "탐지는 됐고 아무도 조치하지 않았다" 를 고쳤는데, 이번엔 **탐지 자체가 없었다.**
//   레인을 하나 더 띄웠으면 감시도 하나 더 있어야 한다. 그게 이 검사다.
//
//   왜 구조 검사인가: 런타임에 :8001 이 살아 있으면 통과해 버리는 검사는 이 결함을 못 잡는다.
//   "감시 코드가 존재하는가" 를 물어야 한다(report-launcher.test.mjs 가 호출부를 보는 것과 같은 원리).
{
  const src = readFileSync(resolve(ROOT, 'scripts/check-stall.mjs'), 'utf8');
  const watchesWeb = /resolveLlm\(\s*['"]web['"]\s*\)/.test(src) || /8001/.test(src) || /lane\s*[:=]\s*['"]web['"]/.test(src);
  watchesWeb
    ? ok('check-stall 이 웹 레인(:8001)도 본다')
    : bad('check-stall 이 :8000 만 본다 — :8001 이 죽어도 아무도 모른다(09-01 37시간 무탐지)');

  // 그리고 그 결과가 issues 로 올라가야 한다. info 로 쌓기만 하면 08-28 의 3일 침묵과 같아진다.
  const webBlock = src.match(/웹 레인[\s\S]{0,900}/)?.[0] ?? '';
  /issues\.push/.test(webBlock)
    ? ok('웹 레인 이상은 issues 로 올린다(info 로 묻지 않는다)')
    : bad('웹 레인 검사 결과가 issues 로 안 간다 — 탐지해도 조용하면 없는 것과 같다');
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
