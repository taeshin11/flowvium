/**
 * flow-move-claim.mjs — 자금흐름 claim 이 '이동' 인가 '비교' 인가.
 *
 * 왜(2026-08-22): verify-report.mjs 가 `/→| vs /` 로 이동형 claim 을 판정했다.
 *   그래서 " vs " 가 든 모든 비교를 이동으로 보고 서사에 '어디서→어디로' 를 요구했다.
 *   실측 — `flow_movement_missing` 결함 6건(07-10 ~ 08-22)이 **전부 같은 오탐**이었다:
 *     ICI 주간 실측: 미국주식 ETF +91억달러 vs 해외주식 +74억달러 · 채권 +145억달러 순창설
 *   세 항목이 모두 유입(+)이다. 이동이 없으니 서사에 이동 표현이 없는 게 맞다.
 *
 * 단순 오탐이 아니다: 이 결함이 hallucination_history 에 쌓이고 다음 보고서 프롬프트에
 *   anti-pattern 으로 주입된다(F26 루프). **데이터에 없는 이동 표현을 쓰라고 모델을 가르친다.**
 *   오탐이 환각을 만드는 구조다.
 *
 * 그리고 kind 를 함께 본다. 화살표가 있어도 `return_proxy`(가격 기준 proxy)면 자금 이동이 아니다.
 *   실측 — 같은 보고서에 이런 claim 이 있었다:
 *     equity→alts 로테이션(1주 수익률 스프레드 12.4%p — **가격 기준 proxy**)
 *     섹터 로테이션(가격 기준): Tech(XLK -3.5%)→Healthcare(XLV +4.3%)
 *   바로 위 `return_proxy_as_flow` 검사는 proxy 를 '자금유입' 으로 쓰면 결함으로 잡는다.
 *   그러면서 여기서 이동 서사를 요구하면 **두 검사가 서로 모순**이다. 시스템 자신의 분류를 따른다.
 *
 * 판정: 실제 자금흐름(kind='true_flow')이면서, 화살표(→)가 있거나 부호가 갈릴 때만 이동이다.
 *   전부 유입이거나 전부 유출이면 비교다. 특정 문구(ICI 등)를 예외로 두지 않는다 —
 *   claim 자체의 숫자에서 판정하므로 새로운 표현이 와도 규칙이 그대로 적용된다.
 */

/** 부호 있는 수치를 뽑는다. '+91억달러' · '-2.2%' · '+145억달러' 등. */
function signsOf(text) {
  return [...String(text ?? '').matchAll(/([+-])\s*[\d.,]+\s*(?:억달러|조원|억원|백만달러|달러|원|%|bp)/g)]
    .map((m) => m[1]);
}

/**
 * @param {string|{text?: string, kind?: string}} claim  claim 원문 또는 {text, kind}
 * @returns {boolean} 자금이 A에서 B로 옮겨갔다는 주장인가
 */
export function isMovementClaim(claim) {
  const t = String(typeof claim === 'string' ? claim : (claim?.text ?? ''));
  const kind = typeof claim === 'string' ? null : claim?.kind;
  if (!t) return false;
  // kind 가 명시돼 있는데 실제 자금흐름이 아니면 이동으로 보지 않는다.
  //   kind 가 없으면(문자열만 받은 경우) 텍스트만으로 판정한다 — 모르는 걸 배제하지 않는다.
  if (kind && kind !== 'true_flow') return false;
  if (t.includes('→')) return true;          // 명시적 이동 표기
  if (!/ vs /.test(t)) return false;
  const s = signsOf(t);
  if (s.length < 2) return false;             // 숫자 근거가 없으면 단정하지 않는다
  return s.includes('+') && s.includes('-');  // 부호가 갈릴 때만 이동
}
