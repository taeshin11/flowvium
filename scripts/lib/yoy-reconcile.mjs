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

/**
 * 이 값이 '실측으로 계산된 YoY' 인가.
 *
 * generate-report-local:8332 이 revenueYoY > 100 을 "비현실"이라며 null 로 버린다.
 * 그 주석은 스스로 "SK하이닉스 198% 같은 실제 가능성 있어"라고 인정하면서도 버린다 —
 * 크기만으로는 'LLM 이 매출 절대값을 넣은 오기입'과 '진짜 고성장'을 구분할 수 없기 때문이다.
 * 실측 대조가 생긴 지금은 근거가 있다: 계산된 YoY 와 같으면 오기입이 아니다.
 * (실측 사례: 039200.KQ FY2025 99,838,669,222 / FY2024 34,007,602,680 → +193.6%)
 *
 * 근거가 없으면 false 를 돌려준다 — 모르면 보수적으로 간다. 크기가 크다고 맞다고 하지 않는다.
 */
export function isMeasuredYoY(ticker, value, signalDigest) {
  if (typeof value !== 'number' || !isFinite(value)) return false;
  if (!signalDigest || typeof signalDigest.get !== 'function') return false;
  const real = parseYoY(signalDigest.get(String(ticker ?? ''))?.fin?.yoy);
  if (real == null) return false;
  return Math.abs(real - value) <= 0.05;
}
