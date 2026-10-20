/**
 * fin-once.mjs — 보고서 한 번 안에서 종목 재무(company-financials / company-kr)는 한 번 받아 같이 쓴다. 2026-10-20 신설.
 * 근거·규칙은 fin-once.test.mjs 머리말.
 */

/**
 * @param {(url:string, timeoutMs:number)=>Promise<any|null>} fetchJson  실패면 null(예: safeFetch)
 * @returns {{ get:(url:string, timeoutMs:number)=>Promise<any|null>, misses:()=>string[] }}
 *   get: 이 실행에서 받은 적 있는 url 은 그 응답을 그대로 준다. 받은 적 없으면 받고, 성공만 기억한다(실패는 다음에 다시 받는다).
 *   misses: 끝내 못 받은 url — 호출부가 '못 봤다' 를 로그에 남기게 한다.
 */
export function finOnce(fetchJson) {
  const got = new Map();
  const missed = new Set();
  return {
    async get(url, timeoutMs) {
      if (got.has(url)) return got.get(url);
      const d = await fetchJson(url, timeoutMs);
      if (d != null) { got.set(url, d); missed.delete(url); } else missed.add(url);
      return d;
    },
    misses: () => [...missed],
  };
}
