/**
 * log-defect-harvest.mjs — 런타임 로그에 남은 LLM 결함을 학습 이력으로 옮긴다.
 *
 * 배경(2026-08-22): news-cascade 의 asset 검증기가 실제로 환각을 잡고 있다 —
 *   최근 로그 500건에 asset_defect 24건. 예: `unknown_kr_code:035550`.
 *   035550 은 소스 4곳(DART·kr-major-indexes·candidate-tickers·universe-search)
 *   어디에도 없다. 신한지주는 055550 이다 — LLM 이 자릿수를 틀렸다.
 *   검증기가 없었다면 클릭 가능한 티커 배지로 발간됐을 값이다.
 *
 *   그런데 그 발견이 `logger.warn` 에서 끝난다. CLAUDE.md 규칙 2는
 *   "새 LLM 출력 필드를 노출하면 cross-check probe 를 추가 → defect push →
 *    hallucination_history 적재까지" 인데, 마지막 한 칸이 비어 있었다.
 *   적재가 없으면 추세도 없고, 다음 프롬프트에 주입되지도 않는다 —
 *   judge-chat/route.ts:149 가 지적한 "검증로그가 소비처 없는 dead-end" 와 같은 부류다.
 *
 * 왜 요청 경로에서 바로 안 쓰나: news-cascade 는 사용자 요청 경로다. 거기서 SQLite 를
 *   열면 보고서 생성과 락을 다투고 지연이 붙는다. 탐지는 싸게 하고, 수확은 주기 잡이 한다.
 *   로거가 이미 warn/error 를 Redis 리스트(flowvium:log:recent, 500개 캡)에 남긴다.
 *
 * 중복: 같은 (ticker, defect_type, llm_value) 는 한 번만 넣는다.
 *   테이블에 unique 인덱스가 없어(PRAGMA index_list 확인) 넣기 전에 조회한다.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

const LOG_KEY = 'flowvium:log:recent';   // src/lib/logger.ts 의 REDIS_KEY 와 같은 값

/** 결함 사유 → 심각도. 발간되면 사용자가 틀린 값을 보는 것은 high. */
export function severityOf(defect) {
  const d = String(defect ?? '');
  if (/^unknown_kr_code/.test(d)) return 'high';      // 존재하지 않는 종목코드
  if (/^us_name_mismatch/.test(d)) return 'high';     // 주장이 *다른 실재 회사* 로 되짚어짐(CPRT 부류)
  if (/^unverifiable_name_claim/.test(d)) return 'medium'; // 권위 소스와 양립 불가하나 되짚어지지 않음
  if (/^unverifiable_kr_name_claim/.test(d)) return 'medium';
  if (/^dropped_name_claim|^dropped_ticker_hint/.test(d)) return 'low';
  return 'medium';
}

/** 로그 엔트리 배열 → hallucination_history 행 후보. 순수 함수(테스트용). */
export function toDefectRows(entries) {
  const rows = [];
  const seen = new Set();
  for (const e of entries ?? []) {
    if (!e || e.event !== 'asset_defect') continue;
    const raw = e.data?.raw ?? null;
    const defect = e.data?.defect ?? null;
    if (!defect) continue;
    const key = `${raw}|${defect}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      ticker: typeof raw === 'string' ? raw.slice(0, 32) : null,
      defect_type: `cascade_asset_${String(defect).split(':')[0]}`,
      llm_value: raw,
      correct_value: null,   // 권위 소스에 없으므로 정답을 모른다 — 모르는 걸 아는 척하지 않는다
      severity: severityOf(defect),
      details: { defect, link: e.data?.link ?? null, at: e.t ?? null },
    });
  }
  return rows;
}

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* 없으면 아래에서 null 을 돌려준다 */ }
  return env;
}

/** Redis 로그 리스트를 읽어 파싱한다. 접속 불가면 null(= 수확 불가, 실패 아님). */
export async function readRecentLogs(limit = 500) {
  const env = loadEnv();
  const url = env.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const { Redis } = await import('@upstash/redis');
  const r = new Redis({ url, token });
  const items = await r.lrange(LOG_KEY, 0, limit - 1);
  return items.map((x) => { try { return typeof x === 'string' ? JSON.parse(x) : x; } catch { return null; } })
    .filter(Boolean);
}
