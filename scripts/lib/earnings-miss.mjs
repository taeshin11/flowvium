/**
 * earnings-miss.mjs — 최근 발표된 실적이 컨센서스를 하회했는지.
 *
 * 왜 생겼나(2026-08-21): detectPeakDumpRisk 의 "가이던스 하향/어닝미스(펀더멘탈 악화)" 신호가
 *   ctxRaw?.companyFinancials 라는 *존재하지 않는 키*를 읽어 한 번도 발화하지 않았다.
 *   배선을 고쳐도 안 됐다 — getCompanyFinancials 는 순수 수치 문자열만 만들어
 *   FUND_NEG_KW(/guidance lowered|miss|가이던스 하향/) 가 매칭될 문장 자체가 없었다.
 *
 *   의도를 실측으로 살린다. getRawEarnings 의 epsSurprise 가 음수면 컨센서스 하회다.
 *   임계값을 새로 만들지 않는다 — '하회'는 부호로 정의되는 표준 개념이고, 크기는 호출부가 라벨에 실어
 *   독자가 판단하게 한다. 임의의 컷오프를 넣는 순간 그게 곧 투자 판단이 된다.
 *
 *   가이던스는 결정론적 소스가 없다. companyChanges[].guidance 는 LLM 산출이라
 *   리스크 신호의 입력으로 쓰지 않는다 — 지어낸 값이 근거가 되는 걸 방금 스퀴즈 점수에서 고쳤다.
 */

const DAY = 86400000;

/**
 * 숫자로 쓸 수 있으면 표시 정밀도(유효 4자리)까지 정리해 돌려준다.
 * 값을 바꾸는 게 아니라 잡음을 지운다 — 실측: RLX epsActual = 0.20227199999999998 이 그대로 발간될 뻔했다.
 * 4자리 이내 값은 그대로 남는다(-11.934 → -11.934).
 */
function num(v) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  return Number(v.toFixed(4));
}

/**
 * @param {string} ticker
 * @param {Array<{ticker:string,date:string,epsActual:number|null,epsEstimate:number|null,epsSurprise:number|null}>} rows getRawEarnings() 산출
 * @param {{today?: Date, windowDays?: number}} [opt] windowDays 기본 7 — getRawEarnings 의 과거 수집창과 같다.
 * @returns {{miss:true, date:string, epsActual?:number, epsEstimate?:number, surprisePct?:number}|null}
 *   원본(epsActual/epsEstimate)이 있으면 그것을, 없으면 surprisePct 를 싣는다. 하회가 아니면 null.
 */
export function earningsMissSignal(ticker, rows, opt = {}) {
  const t = String(ticker ?? '').trim().toUpperCase();
  if (!t || !Array.isArray(rows) || rows.length === 0) return null;
  const today = opt.today instanceof Date ? opt.today : new Date();
  const windowDays = Number.isFinite(opt.windowDays) ? opt.windowDays : 7;
  // 실적 날짜는 'YYYY-MM-DD'(=T00:00Z)인데 today 는 시각을 갖는다.
  //   '현재시각 − 7일'로 자르면 정확히 7일 전 발표분이 간발로 밖에 놓여 하루가 통째로 사라진다.
  //   실측에서 실제로 그랬다 — 음수 서프라이즈 34건 전부 7일 전이었고 한 건도 안 잡혔다.
  //   '7일'은 달력 일수다. 양끝을 날짜 단위로 맞춘다.
  const todayMid = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const from = todayMid - windowDays * DAY;
  const until = todayMid + DAY - 1;   // 오늘 발표분 포함

  let best = null;
  for (const r of rows) {
    if (String(r?.ticker ?? '').trim().toUpperCase() !== t) continue;
    const d = new Date(r.date);
    if (isNaN(d.getTime())) continue;
    // 아직 안 나온 실적은 실적이 아니다. epsSurprise 가 붙어 있어도 추정치다.
    if (d.getTime() > until) continue;   // 아직 안 나온 실적은 실적이 아니다
    if (d.getTime() < from) continue;
    // 2026-08-21 2차: epsSurprise 는 못 믿을 파생값이다.
    //   컨센서스가 0 근처면 퍼센트가 발산하고 상류가 ±999 로 잘라낸다
    //   (실측: LNZA 실적 -2.04 / 컨센 -0.0944 → surprise -999. 431행 중 |surprise|>100 이 16건).
    //   그 값을 라벨에 실으면 "어닝미스 -999.0%" 가 발간된다.
    //   임계값을 새로 만들 게 아니라 원본으로 판정한다 — '하회'는 epsActual < epsEstimate 다.
    //   원본이 있으면 퍼센트는 아예 싣지 않는다. 불안정한 파생값보다 원본이 낫다.
    const act = num(r.epsActual);
    const est = num(r.epsEstimate);
    let hit = null;
    if (act != null && est != null) {
      if (act >= est) continue;                            // 상회·동일은 신호가 아니다
      hit = { miss: true, epsActual: act, epsEstimate: est, date: r.date };
    } else {
      // 원본이 없을 때만 surprise 로 폴백한다 — 정보를 버리지 않되, 근거가 약함을 값으로 드러낸다.
      const sp = r.epsSurprise;
      if (typeof sp !== 'number' || !isFinite(sp)) continue;   // 모르는 것을 나쁘다고 하지 않는다
      if (sp >= 0) continue;
      hit = { miss: true, surprisePct: sp, date: r.date };
    }
    // 같은 창에 여러 건이면 가장 최근 발표를 쓴다
    if (!best || new Date(best.date).getTime() < d.getTime()) best = hit;
  }
  return best;
}
