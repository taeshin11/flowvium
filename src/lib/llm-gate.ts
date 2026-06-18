/**
 * llm-gate.ts — vLLM(단일 GPU) 동시요청 *전역* 세마포어 + 대기 큐 (2026-06-18 사용자 "LLM 들어가는 모든
 *   경로에 세마포어, 넘으면 대기설명+큐"). Redis ZSET 기반이라 web 인스턴스(pm2 cluster)·스크립트 등
 *   여러 프로세스에 걸쳐 vLLM 동시요청을 MAX 로 제한한다. vLLM 자체 배칭이 있어도 폭주·타임아웃을 막고
 *   사용자에게 대기 상황을 알린다.
 *
 * 견고성: 모든 Redis 오류·과대기는 *fail-open*(게이트 통과) — 게이트가 채팅을 절대 막지 않게. 보유자가
 *   crash 해도 TTL(score=획득시각) 로 stale 슬롯 자동 회수(self-heal).
 */
import { createRedis } from '@/lib/redis';

const MAX = Math.max(1, Number(process.env.LLM_MAX_CONCURRENT || 4));
const KEY = 'flowvium:llm:active';
const TTL_MS = 120_000;     // 슬롯 최대 점유(이후 stale 로 간주·회수)
const POLL_MS = 600;
const MAX_WAIT_MS = 90_000; // 과대기 방지 — 이후 fail-open
const redis = createRedis();

/** 현재 활성 vLLM 슬롯 수(전역). Redis 없거나 오류 시 0. */
export async function llmActiveCount(): Promise<number> {
  if (!redis) return 0;
  try { await redis.zremrangebyscore(KEY, 0, Date.now() - TTL_MS); return (await redis.zcard(KEY)) ?? 0; }
  catch { return 0; }
}

/**
 * vLLM 슬롯 획득(전역). 가득 차면 onWait(ahead) 1회 호출 후 슬롯이 빌 때까지 폴링. release() 필수(finally).
 * 1 요청 = 1 슬롯(해석·리서치·최종 생성 전 구간 점유 권장).
 */
export async function acquireLlm(onWait?: (ahead: number) => void): Promise<() => void> {
  if (!redis) return () => { /* fail-open */ };
  const arrival = Date.now();
  const token = `${process.pid}:${arrival}:${Math.round(Math.random() * 1e9)}`;
  const release = () => { try { redis.zrem(KEY, token); } catch { /* */ } };
  // 한 번만 '도착시각' score 로 claim → 이후 rank 만 폴링. 먼저 온 요청이 낮은 rank(공정·무기아).
  try { await redis.zadd(KEY, { score: arrival, member: token }); } catch { return release; }
  let waited = 0, notified = false;
  for (;;) {
    try {
      await redis.zremrangebyscore(KEY, 0, Date.now() - TTL_MS);  // crash 보유자 self-heal
      const rank = (await redis.zrank(KEY, token)) ?? 0;          // 0-based: rank<MAX 면 활성 슬롯
      if (rank < MAX) return release;
      if (!notified && onWait) { onWait(rank - MAX + 1); notified = true; }
    } catch { return release; }  // Redis 오류 → fail-open
    if (waited >= MAX_WAIT_MS) return release;  // 과대기 → fail-open(슬롯은 유지된 채 진행)
    await new Promise((r) => setTimeout(r, POLL_MS));
    waited += POLL_MS;
  }
}

/** 대기 안내 문구. ahead = 내 앞 대기/처리 건수(=내 순번). 순번·예상시간 안내. */
export function waitMessage(ahead: number): string {
  const pos = Math.max(1, ahead);
  const eta = pos * 30; // 1건 ~20-40초 → 대략
  const etaStr = eta >= 60 ? `약 ${Math.ceil(eta / 60)}분` : `약 ${eta}초`;
  return `대기 ${pos}번째 — 앞 분석이 끝나는 대로 시작합니다 (예상 ${etaStr}). 동시 분석이 많아 잠시만요…`;
}
