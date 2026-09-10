/**
 * kr-flow-claim.mjs — KRX 실측 수급을 LLM 에게 넘길 **계약 문장**으로 만든다.
 *
 * 왜 분리했나 (2026-09-10): 이 판단이 generate-report-local.mjs 안에 인라인으로 있어
 *   테스트가 없었고, 임계 하나가 조용히 사실오류를 만들었다.
 *
 * 무엇이 잘못이었나: 임계가 **외국인+기관 합계** |합| ≥ 3,000억이었다.
 *   2026-09-09 실측 — 외국인 -5,441억 · 기관 +6,343억 → 합계 +901억 → 미달 → 계약 미생성.
 *   계약이 없으면 LLM 은 수급을 자유롭게 쓴다. 그날 자정 회차는
 *   "외국인 자금 유입을 견인했다"를 발간했다(실측은 순매도). 교정기도 이 계약을 보고 도는지라
 *   함께 죽어, 검출기만 잡고 아무도 못 고친 채 라이브로 나갔다.
 *
 * 합계가 작다는 것은 "수급이 없었다"가 아니라 **둘이 반대로 크게 움직였다**는 뜻이다.
 *   그날이야말로 서술이 헷갈려 계약이 가장 필요하다. 그래서 임계를 각 주체로 본다.
 *   양쪽 다 작을 때만 잡음으로 버린다.
 *
 * 범위 명시(2026-07-04): korea-flow 합계는 시장 전체가 아니라 수급 상위 종목 합계다.
 *   무범위 서술("외국인 1.9조 순매수")은 시장 전체 수급으로 과대해석된다.
 */

/** 잡음 컷. 이 값 미만이면 그 주체는 언급하지 않는다. */
export const KR_FLOW_MIN = 3e11;

const 억 = (n) => `${(Math.abs(n) / 1e8).toFixed(0)}억원`;
const dir = (n) => (n > 0 ? '순매수' : '순매도');

/**
 * @returns {{id,kind,market,text,allowedVerbs,confidence}|null}
 *   외국인 수치가 없으면 null — 없는 것을 지어내지 않는다.
 */
export function buildKrFlowClaim(koreaFlow) {
  const fNet = koreaFlow?.foreignNet;
  if (!Number.isFinite(fNet)) return null;
  const iNet = koreaFlow?.institutionNet;
  const hasInst = Number.isFinite(iNet);

  const bigF = Math.abs(fNet) >= KR_FLOW_MIN;
  const bigI = hasInst && Math.abs(iNet) >= KR_FLOW_MIN;
  if (!bigF && !bigI) return null;            // 양쪽 다 작다 = 잡음

  // 외국인을 먼저 쓴다 — 검출기(measuredDirection)가 앞에서 방향을 읽고,
  //   regionStances.korea.thesis 도 외국인 기준이라 둘이 어긋나면 안 된다.
  const parts = [];
  if (bigF) parts.push(`외국인 ${dir(fNet)} ${억(fNet)}`);
  if (bigI) parts.push(`기관 ${dir(iNet)} ${억(iNet)}`);
  const period = koreaFlow?.period ?? '기간';

  return {
    id: 'kr_smart_flow', kind: 'true_flow', market: 'KR',
    text: `KR 주요 종목 ${parts.join(', ')}(${period}, 수급 상위 종목 합계)`,
    allowedVerbs: ['순매수', '순매도', '유입', '이탈'], confidence: 'high',
  };
}
