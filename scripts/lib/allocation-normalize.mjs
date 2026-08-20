/**
 * allocation-normalize.mjs — 포트폴리오 비중 정규화. '레짐 현금'을 존중한다.
 *
 * 배경(2026-08-20): 시장 국면 신호를 거부(veto)에서 노출(비중)로 옮기면서 심판 단계에서 비중을
 *   줄였는데, applyLocalHarness 가 그 뒤에 돌며 합계를 100 으로 되돌려 축소를 무효화했다.
 *   코드를 넣은 것과 효과가 나는 것은 다르다 — 실행 순서를 안 보면 이런 게 조용히 통과한다.
 *
 *   저장소에는 이미 '현금도 포지션' 규율이 있다(종목 4개 미만이면 25% 캡 + 잔여 현금 명시,
 *   2026-07-03 삼성화재 100% 사건). 레짐 축소도 같은 방식으로 다룬다:
 *   줄인 만큼을 명시적 현금으로 잡고, 정규화 목표를 100 이 아니라 (100 - 현금) 으로 둔다.
 *   그래야 verify-report 의 allocation_sum 검사도 '현금 보유 명시 시 <100 허용' 경로로 통과한다.
 */

/**
 * @param {Array<{ticker:string, allocation?:number}>} portfolio
 * @param {{regimeCashReserve?:number, maxSingle?:number, note?:string}} opts
 * @returns {{portfolio:Array, cashReserve:number, note:string|null, from:number, to:number}}
 */
export function normalizeAllocations(portfolio = [], opts = {}) {
  const pf = (portfolio ?? []).map(p => ({ ...p }));
  const reserve = Math.max(0, Math.min(100, Number(opts.regimeCashReserve) || 0));
  const maxSingle = Number(opts.maxSingle) || 0;
  const target = Math.max(0, 100 - reserve);
  const from = pf.reduce((s, p) => s + (p.allocation ?? 0), 0);

  if (!pf.length) return { portfolio: pf, cashReserve: reserve, note: null, from, to: 0 };

  // 비례 축소 — 상대 순위를 바꾸지 않는다. 합계가 0이면(전부 0) 균등 배분으로 되살린다.
  if (from > 0) {
    const scale = target / from;
    for (const p of pf) p.allocation = Math.max(0, Math.round((p.allocation ?? 0) * scale));
  } else {
    const each = Math.floor(target / pf.length);
    for (const p of pf) p.allocation = each;
  }

  // 단일 상한 — 종목이 적을 때 몰빵을 막는 기존 규율. 초과분은 회수하지 않고 현금으로 남긴다
  // (다른 종목에 밀어 넣으면 그쪽이 상한을 넘거나, 애초에 사고 싶지 않던 종목을 늘리게 된다).
  if (maxSingle > 0) for (const p of pf) if (p.allocation > maxSingle) p.allocation = maxSingle;

  // 반올림 잔차는 최대 비중 종목에 흡수 — 단, 상한과 목표를 넘기지 않는다.
  let to = pf.reduce((s, p) => s + p.allocation, 0);
  const drift = target - to;
  if (drift !== 0 && pf.length) {
    const idx = pf.reduce((bi, p, i) => (p.allocation > pf[bi].allocation ? i : bi), 0);
    const cap = maxSingle > 0 ? maxSingle : target;
    pf[idx].allocation = Math.max(0, Math.min(cap, pf[idx].allocation + drift));
    to = pf.reduce((s, p) => s + p.allocation, 0);
  }

  const cash = Math.max(0, 100 - to);
  const note = cash > 0
    ? (opts.note ?? `투자비중 ${to}%만 권고, 잔여 ${cash}%는 현금 보유(현금도 포지션).`)
    : null;
  return { portfolio: pf, cashReserve: cash, note, from, to };
}
