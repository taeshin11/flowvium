/**
 * yoy-reconcile.mjs — companyChanges.revenueYoY 를 결정론 실측과 대조한다.
 *
 * 종전 fillCompanyChangesYoY 는 `if (c.revenueYoY != null) continue;` — null 일 때만 채웠다.
 * LLM 이 쓴 값은 실측과 달라도 그대로 발간된다. 같은 구조의 shortSqueeze.score 는 실제로 지어냈다
 * (보고서 43 vs 실측 55). "이번엔 맞았다"는 검증이 아니다.
 *
 * 실측 출처는 signalDigest 의 fin(= getCompanyFinancials 문자열 파싱).
 *   US: /api/company-financials 의 quarterlyRevenue[0].yoyPct
 *   KR: /api/company-kr 의 annuals 최근 2개 revenueKRW 비교(DART)
 * 여기서 YoY 를 다시 계산하지 않는다 — 산식이 두 곳에 있으면 조용히 어긋난다.
 *
 * 실측이 없으면 LLM 값을 지우지 않는다. 근거가 없다고 삭제하면 정보만 잃는다 —
 * 대신 미검증으로 보고해 호출부가 로그로 드러내게 한다.
 * (스퀴즈는 '그 티커가 스퀴즈 후보인가' 자체가 확인 불가라 뺐다. 여기는 항목이 아니라 필드 하나다.)
 */

/** '+57.4% YoY' · '-3.2% YoY' → 57.4 / -3.2 */
function parseYoY(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return isFinite(n) ? n : null;
}

/**
 * @param {Array<{ticker?:string, revenueYoY?:number|null, latestQuarter?:string|null}>} companyChanges
 * @param {Map<string,{fin?:{yoy?:string,label?:string}|null}>} signalDigest
 * @returns {{changes:Array, filled:string[], corrected:string[], unverified:string[]}}
 */
export function reconcileCompanyYoY(companyChanges, signalDigest) {
  const changes = Array.isArray(companyChanges) ? companyChanges : [];
  const filled = [], corrected = [], unverified = [];
  if (!signalDigest || typeof signalDigest.get !== 'function') return { changes, filled, corrected, unverified };

  for (const c of changes) {
    const t = String(c?.ticker ?? '');
    const fin = signalDigest.get(t)?.fin;
    const real = parseYoY(fin?.yoy);
    if (real == null) {
      if (c?.revenueYoY != null) unverified.push(`${t} revenueYoY=${c.revenueYoY}(실측 없음 — 검증 못 함)`);
      continue;
    }
    if (c.revenueYoY == null) {
      c.revenueYoY = real;
      if (fin.label) c.latestQuarter = fin.label;
      filled.push(`${t} → ${real}%`);
      continue;
    }
    const cur = typeof c.revenueYoY === 'number' ? c.revenueYoY : parseFloat(c.revenueYoY);
    // 실측은 소수 1자리로 만들어진다 — 표기 반올림 차이를 교정으로 세지 않는다.
    if (!isFinite(cur) || Math.abs(cur - real) > 0.05) {
      corrected.push(`${t} revenueYoY ${c.revenueYoY} → ${real}(실측)`);
      c.revenueYoY = real;
      // 값만 바꾸면 "Q2 FY2026" 라벨에 다른 분기 수치가 붙는다 — 라벨도 함께 맞춘다.
      if (fin.label) c.latestQuarter = fin.label;
    }
  }
  return { changes, filled, corrected, unverified };
}
