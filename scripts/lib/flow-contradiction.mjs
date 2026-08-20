/**
 * flow-contradiction.mjs — 수급 방향 모순 패턴의 단일 소스.
 *
 * 배경(2026-08-20 오후 실행, 발간 차단): 결정론 수급은 "외국인 순매도 3.08조원"인데
 *   marketNarrative.why 가 "원화 강세가 외국인 자금 유입을 가속"이라 썼다.
 *   verify-report(:955)의 검출기는 잡아서 pre-publish gate 가 발간을 막았다(정상 동작).
 *   그런데 narrative-fix 의 교정기 fixKrFlowContradiction 은 못 고쳤다 — 패턴이 달랐기 때문이다:
 *       검출기: 순유입|자금\s*유입|유입\s*확대|유입세|순매수\s*(지속|…)
 *       교정기: (매수세|순매수)[^.]{0,8}(지속|확대|이어)        ← '유입' 형태 없음
 *   2026-07-05 주석은 "detector-without-corrector 해소"라고 적혀 있는데, 패턴을 두 파일에
 *   각각 적어둔 탓에 조용히 다시 갈라졌다.
 *
 * 지켜야 할 불변식: 검출기가 결함이라고 한 문장은 교정기가 고칠 수 있어야 한다.
 *   아니면 발간이 막히기만 하고 스스로 회복하지 못한다(오후 보고서가 실제로 그렇게 됐다).
 */

// 매수/유입을 주장하는 표현. '유입' 계열을 포함한다 — 실제 사례가 그 형태였다.
const BUY_CLAIM = String.raw`(외국인|기관)[^.]{0,16}(순유입|자금\s*유입|유입\s*확대|유입세|유입[을를]?\s*(가속|확대|견인)|매수세|순매수)`;
// 매도/유출을 주장하는 표현.
const SELL_CLAIM = String.raw`(외국인|기관)[^.]{0,16}(순유출|자금\s*유출|유출\s*확대|유출세|매도세|순매도)`;

// '둔화/감소' 수식이 붙으면 정상 서술이다 — "순매수 둔화가 이어진다"는 매수 주장이 아니다.
const SLOWDOWN = /(순매수|순매도|유입|유출)[^.]{0,6}(둔화|감소|축소|위축|약화)/;
// 과거→현재 전환 서술은 정상 — "유입이 있었으나 지금은 이탈".
// 과거형 전체를 잡으면 안 된다: 종전 /(있었|였|…)/ 는 "강세를 보였다"의 '였'에 걸려
// 진짜 모순("외국인 매수세 지속으로 … 보였다")을 정상으로 흘려보냈다(실측).
// 대조·전환 어미만 본다.
const PAST_SHIFT = /(있었|이었|였)(으나|지만|는데)|했(지만|으나|는데)|(반면|그러나|하지만)[,\s]/;

/** 실측 문구에서 방향 추출. 'buy' | 'sell' | null. */
export function measuredDirection(claimText) {
  const s = String(claimText ?? '');
  if (/순매수/.test(s)) return 'buy';
  if (/순매도/.test(s)) return 'sell';
  return null;
}

/** 문장 하나가 실측 방향과 반대되는 주장인가. */
function sentenceContradicts(sentence, measuredDir) {
  const s = String(sentence ?? '');
  if (!s) return false;
  if (SLOWDOWN.test(s)) return false;      // "순매수 둔화" — 매수 주장이 아니다
  if (PAST_SHIFT.test(s)) return false;    // "유입이 있었으나 지금은 이탈" — 전환 서술
  return new RegExp(measuredDir === 'sell' ? BUY_CLAIM : SELL_CLAIM).test(s);
}

/**
 * 텍스트 안에 실측 방향과 반대되는 주장이 있는가.
 *
 * 문장 단위로 본다. 2026-08-20 실측: 필드를 합쳐 통째로 판정했더니 다른 문장의 대조 어미
 * ('…매수했지만…')가 전체를 제외시켜 진짜 모순("자금 유입을 가속")을 놓쳤다 —
 * 게이트가 약해지는 방향의 버그라 반드시 문장별로 갈라 본다.
 */
export function isContradiction(text, measuredDir) {
  const s = String(text ?? '');
  if (!s || (measuredDir !== 'buy' && measuredDir !== 'sell')) return false;
  return splitSentences(s).some((sent) => sentenceContradicts(sent, measuredDir));
}

/** 문장 분리. 한국어 마침표/줄바꿈/파이프 구분자 기준. */
export function splitSentences(text) {
  return String(text ?? '').split(/(?<=[.!?。])\s+|\n+|\s\|\s/).map((x) => x.trim()).filter(Boolean);
}

/** 교정기가 문장 치환에 쓰는 정규식(같은 패턴). */
export function contradictionRegex(measuredDir) {
  return new RegExp(measuredDir === 'sell' ? BUY_CLAIM : SELL_CLAIM);
}

/** 검출·교정이 함께 보는 필드 목록. 한쪽만 늘리면 다시 갈라진다. */
export const NARRATIVE_FIELDS = ['thesis', 'macroAnalysis'];
export const MARKET_NARRATIVE_FIELDS = ['why', 'story', 'watch'];

/** 검출기가 읽는 텍스트(필드 결합) — 검출과 교정이 같은 범위를 보게 한다. */
export function narrativeText(report) {
  const parts = [];
  for (const k of NARRATIVE_FIELDS) if (typeof report?.[k] === 'string') parts.push(report[k]);
  for (const k of MARKET_NARRATIVE_FIELDS) {
    const v = report?.marketNarrative?.[k];
    if (typeof v === 'string') parts.push(v);
  }
  return parts.join(' ');
}
