/**
 * llm-gate.mjs — 백엔드가 실제로 동시에 처리할 수 있는 수만큼만 요청을 흘려보낸다.
 *
 * 왜 필요한가(2026-08-21 실측):
 *   :8000 의 27B 는 `--prompt-concurrency 1 --decode-concurrency 1` 로 떠 있다.
 *   한 번에 한 건만 처리한다(성공 런의 완료시각이 단조 증가하는 것이 증거:
 *   215.4 → 335.6 → 603.6 → 765.2 → 1667.7s). 그런데 호출부는 Promise.all 로 5건을
 *   동시에 던졌다. 남는 4건은 서버 큐에서 기다린다.
 *
 *   확증된 사망 경로: 5건이 3600s AbortSignal 한 시계를 나눠 쓰면 큐 대기시간까지
 *   각자의 예산에서 빠져나가, 총합이 천장을 넘는 순간 함께 죽는다
 *   (실측 `Wave1 총 소요: 3598.1s` → 4건 aborted, 2026-08-21 자정 런).
 *
 *   또 하나의 알려진 위험: 큐 대기 중에는 헤더만 받고 바디가 한 바이트도 안 온다
 *   (직접 측정: 대기 요청의 헤더 17.3s, 첫 바디청크 90.5s = 앞 요청 종료 직후).
 *   이 공백은 소켓 유휴 타임아웃(undici bodyTimeout 기본 300s)의 사정권이고,
 *   로컬 LLM 진영에서 널리 보고된 실패 형태다(cline#6549, Roo-Code#6570).
 *   이 저장소는 그 타임아웃을 이미 꺼 두었으므로 지금은 그 경로로 죽지 않는다.
 *   (2026-08-21 오후 런의 fetch failed 3건은 원인 미상 — 옛 코드가 cause 코드를 버렸다.
 *    describeFetchError 로 고쳐 두었으니 다음 발생 때 드러난다. 여기서 단정하지 않는다.)
 *
 * 고치는 방식:
 *   타임아웃을 늘리거나 재시도를 붙이는 건 증상 덮기다. 큐에서 기다리는 시간이
 *   요청의 타임아웃 예산을 갉아먹는 게 원인이므로, *애초에 큐에 넣지 않는다*.
 *   게이트는 대기를 AbortSignal 이 시작되기 전으로 옮긴다 — callVLLMOnce 가 slot 을
 *   얻은 뒤에야 signal 을 만들기 때문에, 대기시간이 더는 예산을 먹지 않는다.
 *   서버가 1건씩 처리하면 클라이언트도 1건씩 보낸다. 총 소요시간은 어차피 같다
 *   (서버가 직렬이므로). 달라지는 건 "대기 중 사망" 이 사라진다는 것뿐이다.
 *
 * 폭(width)은 서버 기동 플래그와 짝이다. 코드에 숫자를 박지 않고 llm-config.resolveLlm()
 *   가 .env.local 에서 읽어 준다. 서버 동시성을 올리면 그 값도 같이 올려야 한다.
 */

/**
 * 폭 width 의 FIFO 세마포어. `limit(fn)` 은 slot 을 얻은 뒤 fn() 을 실행하고,
 * fn 이 끝나야(성공·실패 무관) 다음 대기자에게 slot 을 넘긴다.
 * @param {number} width 동시 실행 허용 수 (>=1)
 */
export function createLimiter(width) {
  const w = Math.max(1, Math.floor(Number(width)) || 1);
  let active = 0;
  const waiters = [];

  const pump = () => {
    while (active < w && waiters.length > 0) {
      const { fn, resolve, reject } = waiters.shift();
      active++;
      // fn 이 동기 throw 해도 slot 이 새지 않도록 Promise 체인 안에서 부른다.
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => { active--; pump(); });
    }
  };

  const limit = (fn) => new Promise((resolve, reject) => {
    waiters.push({ fn, resolve, reject });
    pump();
  });
  limit.stats = () => ({ width: w, active, queued: waiters.length });
  return limit;
}

// URL(=백엔드) 별로 하나씩. 한 프로세스 안의 모든 호출부가 같은 게이트를 지나야
// 의미가 있다 — 호출부마다 새로 만들면 동시성 제한이 안 걸린다.
const _registry = new Map();

/**
 * @param {string} key  백엔드 식별자(보통 resolveLlm().url)
 * @param {number} width 동시 실행 허용 수
 */
export function limiterFor(key, width) {
  let l = _registry.get(key);
  if (!l) { l = createLimiter(width); _registry.set(key, l); }
  return l;
}

/** 테스트용 — 등록된 게이트 상태 조회 */
export function gateStats() {
  return Object.fromEntries([..._registry].map(([k, l]) => [k, l.stats()]));
}
