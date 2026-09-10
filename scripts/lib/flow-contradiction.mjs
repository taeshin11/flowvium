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

/**
 * 실측 KR 수급 문구를 보고서에서 꺼낸다 — 검출기와 교정기가 **같은 입력**을 보게 한다.
 *
 * 2026-09-10: 검출기는 regionStances.korea.thesis 를, 교정기는 flowEvidence 의
 *   kr_smart_flow claim 을 봤다. 자정 회차엔 그 claim 이 없어 교정기가 아예 돌지 않았고
 *   ("_krFlowDirFix": null) 모순 문장이 그대로 발간됐다. 판단만 통일해선 부족하다 —
 *   **입력도 같아야** 갈라지지 않는다. claim 이 있으면 그걸, 없으면 thesis 를 쓴다.
 */
export function measuredClaimText(report, claimText = null) {
  const c = String(claimText ?? '');
  if (measuredDirection(c)) return c;
  return String(report?.regionStances?.korea?.thesis ?? '');
}

/** 실측 문구에서 방향 추출. 'buy' | 'sell' | null. */
export function measuredDirection(claimText) {
  const s = String(claimText ?? '');
  // 2026-09-10: 종전엔 문자열 전체에서 순매수를 먼저 찾았다. 계약문이 외국인과 기관을 함께
  //   적으면("외국인 순매도 5441억원, 기관 순매수 6343억원") **기관 방향을 읽어** 실측이 뒤집혔다.
  //   이 모듈의 모든 판정은 외국인 기준이다(regionStances.korea.thesis 도 외국인 기준).
  //   외국인 절이 있으면 그것만 본다.
  const f = s.match(/외국인[^,.]{0,16}(순매수|순매도)/);
  if (f) return f[1] === '순매수' ? 'buy' : 'sell';
  if (/순매수/.test(s)) return 'buy';
  if (/순매도/.test(s)) return 'sell';
  return null;
}

// 실측 주체(외국인)의 방향을 문장이 명시적으로 인정하는가 — "외국인 자금 이탈에도 불구하고".
const ACK_SELL = /외국인[^.]{0,16}(순매도|매도세|이탈|유출)/;
const ACK_BUY = /외국인[^.]{0,16}(순매수|매수세|유입)/;
// 매수/매도 주장의 주체가 외국인이 아닌가 — 기관·개인·연기금은 별개 주체다.
const OTHER_SUBJECT = /(기관|개인|연기금|국내)[^.]{0,10}(순유입|자금\s*유입|유입세|매수세|순매수|매도세|순매도|유출)/;

/**
 * 문장 하나가 실측 방향과 반대되는 주장인가.
 *
 * 검출기(verify-report)와 교정기(narrative-fix)가 **이 함수 하나만** 봐야 한다.
 *   2026-09-10: 주체 인식을 여기 넣었는데 교정기는 여전히 원시 정규식을 쓰고 있어,
 *   교정기가 검출기보다 공격적이 됐다 — 참인 문장("외국인 이탈에도 기관·개인 매수")까지 지웠다.
 *   판단이 두 곳에 있으면 반드시 갈라진다.
 */
export function sentenceContradicts(sentence, measuredDir) {
  const s = String(sentence ?? '');
  if (!s) return false;
  if (SLOWDOWN.test(s)) return false;      // "순매수 둔화" — 매수 주장이 아니다
  if (PAST_SHIFT.test(s)) return false;    // "유입이 있었으나 지금은 이탈" — 전환 서술
  const claimRe = new RegExp(measuredDir === 'sell' ? BUY_CLAIM : SELL_CLAIM);
  if (!claimRe.test(s)) return false;
  // 2026-09-10: 외국인이 팔고 기관·개인이 사는 것은 **동시에 성립한다**. 문장이 실측 방향을
  //   명시적으로 인정하면서 다른 주체의 반대 매매를 말하는 것은 모순이 아니다.
  //   느슨해지는 쪽 실수가 더 나쁘므로 **인정이 있고 + 주체가 외국인이 아닐 때**만 뺀다.
  //   "외국인 순매도에도 불구하고 외국인 순매수" 는 주체가 같으므로 그대로 잡힌다.
  const ack = measuredDir === 'sell' ? ACK_SELL.test(s) : ACK_BUY.test(s);
  const claimSubjectIsForeign = new RegExp(`외국인[^.]{0,16}(${(measuredDir === 'sell'
    ? '순유입|자금\\s*유입|유입\\s*확대|유입세|유입[을를]?\\s*(가속|확대|견인)|매수세|순매수'
    : '순유출|자금\\s*유출|유출\\s*확대|유출세|매도세|순매도')})`).test(s);
  if (ack && !claimSubjectIsForeign && OTHER_SUBJECT.test(s)) return false;
  return true;
}

/**
 * 텍스트 안에 실측 방향과 반대되는 주장이 있는가.
 *
 * 문장 단위로 본다. 2026-08-20 실측: 필드를 합쳐 통째로 판정했더니 다른 문장의 대조 어미
 * ('…매수했지만…')가 전체를 제외시켜 진짜 모순("자금 유입을 가속")을 놓쳤다 —
 * 게이트가 약해지는 방향의 버그라 반드시 문장별로 갈라 본다.
 */
export function isContradiction(text, measuredDir) {
  return contradictingSentence(text, measuredDir) != null;
}

/**
 * 모순되는 **문장 자체**를 돌려준다. 없으면 null.
 *
 * 2026-09-10: 종전 검출기는 결함을 잡은 뒤 메시지에 `text.match(regex)[0]` 를 썼다.
 *   그건 텍스트 **전체의 첫 매치**라 실제로 걸린 문장이 아니었다. 자정 회차에서
 *   진짜 결함은 "…외국인 자금 유입을 견인했다" 였는데 메시지는 앞 문장의
 *   "기관과 개인 매수세" 를 인용했고, 그걸 보고 오탐이라 판단할 뻔했다.
 *   틀린 문장을 가리키는 오류 메시지는 없는 것보다 나쁘다.
 */
export function contradictingSentence(text, measuredDir) {
  const s = String(text ?? '');
  if (!s || (measuredDir !== 'buy' && measuredDir !== 'sell')) return null;
  return splitSentences(s).find((sent) => sentenceContradicts(sent, measuredDir)) ?? null;
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
