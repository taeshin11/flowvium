/**
 * llm-config.mjs — LLM 접속 정보(URL·모델)의 단일 소스.
 *
 * 배경(2026-08-20 실측): cron 의 segments-refresh 가 15회 실행에 성공 0 / 실패 90 (0.0%)이었다.
 *   20분마다 GPU 를 달구면서 아무것도 못 만들었다. 추적하니:
 *     build-segments-dynamic.mjs:178  model: process.env.OLLAMA_TRANSLATE_MODEL || 'flowvium-local'
 *     · 이 스크립트는 .env.local 을 읽지 않는다 — 그 로딩은 generate-report-local.mjs 안에만 있었다
 *     · cron-runner 의 launchd 환경에도 그 변수가 없다
 *     → 옛 Ollama 별칭 'flowvium-local' 로 폴백 → mlx 가 HTTP 404 로 거부
 *     → `if (!r.ok) return []` 이 조용히 삼켜 'exaone-no-rows' 로 보고
 *   실측: default_model → 200 · flowvium-local → 404.
 *
 *   폴백 기본값이 '서버가 거부하는 값'이면 영원히 실패한다. 기본값을 두더라도
 *   현재 서버가 받는 값이어야 하고, 무엇보다 한 곳에서만 정해야 한다.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

let _cache = null;

/**
 * .env.local 을 파싱해 돌려주고 process.env 에도 주입한다(기존 실제 env 는 보존).
 * generate-report-local.mjs 안에만 있던 loadEnv 를 여기로 옮겨 다른 스크립트도 쓰게 한다.
 */
export function loadEnvLocal() {
  if (_cache) return _cache;
  const env = {};
  try {
    const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* 없으면 process.env 만으로 간다 — 호출부가 판단한다 */ }
  for (const k in env) if (process.env[k] === undefined) process.env[k] = env[k];
  _cache = env;
  return env;
}

// 현재 서버(mlx_lm)가 실제로 받는 이름. 옛 Ollama 별칭(flowvium-local·qwen3:8b)은 404 다.
const SERVED_DEFAULT = 'default_model';

// 백엔드가 한 번에 처리하는 요청 수. 서버 기동 플래그(--prompt-concurrency)와 짝이며
// ~/Library/LaunchAgents/com.spinai.flowvium-llm{,-web}.plist 에 그 값이 있다.
//   :8000 report → --prompt-concurrency 1   :8001 web → --prompt-concurrency 2
// 이 값보다 많이 동시에 던지면 남는 요청이 서버 큐에서 굶는다 — 대기시간이 각 요청의
// AbortSignal 예산을 먹어 함께 죽는다(실측 근거는 llm-gate.mjs 주석). 서버 동시성을
// 바꾸면 .env.local 의 아래 키도 같이 바꿔야 한다 — 코드가 아니라 설정에서 정한다.
const CONCURRENCY_DEFAULT = { report: 1, web: 2 };
const readConcurrency = (lane, ...keys) => {
  for (const k of keys) {
    const v = parseInt(process.env[k] ?? '', 10);
    if (Number.isFinite(v) && v >= 1) return v;
  }
  return CONCURRENCY_DEFAULT[lane];
};

/**
 * 레인별 접속 정보.
 *   'report' — 보고서/무거운 추출용 (기본 :8000, 27B)
 *   'web'    — 웹 대면 번역·챗 (기본 :8001, 소형). 미설정이면 report 레인으로 폴백.
 * @returns {{url: string, model: string, lane: string, concurrency: number}}
 */
export function resolveLlm(lane = 'report') {
  loadEnvLocal();
  const clean = (u) => String(u).replace(/\s+/g, '').replace(/\\n/g, '').replace(/\/+$/, '');
  if (lane === 'web') {
    const url = clean(process.env.LOCAL_LLM_URL || process.env.VLLM_URL || 'http://127.0.0.1:8001/v1');
    const model = process.env.LOCAL_LLM_MODEL || process.env.VLLM_MODEL || SERVED_DEFAULT;
    return { url, model, lane, concurrency: readConcurrency('web', 'LOCAL_LLM_MAX_CONCURRENCY', 'LOCAL_LLM_MAX_CONCURRENT') };
  }
  const url = clean(process.env.VLLM_URL || 'http://127.0.0.1:8000/v1');
  const model = process.env.VLLM_MODEL || process.env.OLLAMA_TRANSLATE_MODEL || SERVED_DEFAULT;
  return { url, model, lane, concurrency: readConcurrency('report', 'VLLM_MAX_CONCURRENCY') };
}

/**
 * 레인을 띄우는 launchd 잡의 라벨.
 *
 * 왜 여기 있나 (2026-08-31 실측 사고): llm-health-check.mjs 의 라벨 기본값이 레인과 무관하게
 *   'com.spinai.flowvium-llm' 이었다. 그래서 `--lane web --repair` 는 :8001 이 죽은 걸 보고
 *   **:8000(27B) 을 재기동** 했다 — 보고서 모델을 죽여서 웹 모델을 고치는 꼴이다.
 *   접속 정보(URL·모델)와 그 서비스를 되살리는 방법은 같은 곳에서 정해야 어긋나지 않는다.
 *   llm-config.test.mjs [5] 가 라벨↔plist↔포트 삼자 일치를 매번 확인한다.
 */
const LANE_LABEL = { report: 'com.spinai.flowvium-llm', web: 'com.spinai.flowvium-llm-web' };

/** @param {'report'|'web'} lane */
export function resolveLaunchdLabel(lane = 'report') {
  loadEnvLocal();
  // 환경으로 덮을 수 있게 두되, 레인별로 나눠 받는다 — 하나로 받으면 두 레인이 다시 겹친다.
  const perLane = lane === 'web' ? process.env.LLM_LAUNCHD_LABEL_WEB : process.env.LLM_LAUNCHD_LABEL;
  return perLane || LANE_LABEL[lane] || LANE_LABEL.report;
}
