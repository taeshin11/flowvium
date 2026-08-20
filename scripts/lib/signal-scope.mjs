/**
 * signal-scope.mjs — 시장 단위 신호와 종목 단위 신호를 분리한다.
 *
 * 배경(2026-08-20 실측): 정오 보고서에 한국 종목이 0개였다. 추적하니 KR 후보 9개 전부에
 *   micro_region_bearish(7점)가 붙었고 VETO_SCORE 가 정확히 7이라 지역 스탠스 단독으로
 *   거부가 성립했다. 140860.KQ 는 데드크로스·200MA이탈·과매수가 전혀 없이 그 7점 하나로 탈락했다.
 *   (오전 실행에선 이 신호가 0건이라 같은 후보풀에서 KR 2석이 나왔다.)
 *
 *   KR 만의 문제가 아니다. 시장 단위 규칙이 단독으로 임계값을 넘는다:
 *     macro_high_risk 8 → 전 우주 매수 금지
 *     macro_vix_spike 6 + macro_fg_extreme_fear 5 = 11 → 전 우주
 *   공석을 메우라고 만든 재충원 장치도 같은 페널티를 받아 구조적으로 실패한다.
 *
 * 선행 사례의 원칙은 일치한다 — 레짐 신호는 '무엇을 고를지'가 아니라 '얼마나 실을지'를 정한다:
 *   · financial-hacker.com "The Market Regime Filter": 레짐 점수대별로 노출을 절반/0 으로 단계 축소
 *   · arXiv 2511.12490 (Drift Regimes): 레짐이 gross exposure 를 줄이고, 종목 조건이 선택을 정함
 *   · emergentmind "Market Regime Filtering": 레짐 필터는 서술적·맥락적이며 신호 생성기가 아님
 *   · MIT Sloan "Portfolio Construction When Regimes Are Ambiguous": 레짐 불확실성은 포트폴리오 층에서
 *
 *   그래서 여기서는 (1) 거부 판정은 종목 단위 점수로만, (2) 시장 점수는 노출도(비중)로 옮긴다.
 *   위험 통제를 없애는 게 아니라 적용 층을 옮기는 것이다 — 나쁜 국면이면 '안 사는' 게 아니라 '적게 산다'.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

/**
 * 범위는 규칙 id 목록이 아니라 condition.type 으로 정한다.
 * id 목록으로 하면 새 규칙이 추가될 때마다 목록을 손봐야 하고, 빠뜨리면 조용히 잘못 편입된다.
 * condition.type 은 '이 규칙이 무엇을 보는가'를 이미 말해준다.
 */
const MARKET_CONDITIONS = new Set([
  'regionStance',    // 해당 지역 전 종목에 동일 적용
  'sectorStance',    // 해당 섹터 전 종목에 동일 적용
  'macroRisk',       // 전 우주
  'vixSpike',        // 전 우주
  'fgExtreme',       // 전 우주
  'krFlowExodus',    // KR 전 종목
]);

/** 'market' | 'security'. 모르는 타입은 security 로 둔다 — 종목 신호의 거부 권한을 보수적으로 유지. */
export function scopeOfCondition(type) {
  return MARKET_CONDITIONS.has(String(type)) ? 'market' : 'security';
}

function loadRules() {
  try { return JSON.parse(readFileSync(resolve(ROOT, 'data/sell-rules-tuned.json'), 'utf8')).rules ?? []; }
  catch { return []; }
}

/** id → condition.type (히트 객체가 condition 을 안 들고 다닐 때 보강용) */
let _condById = null;
function condById() {
  if (!_condById) {
    _condById = new Map();
    for (const r of loadRules()) _condById.set(r.id, (r.condition ?? {}).type);
  }
  return _condById;
}

/**
 * 규칙표에 있는데 여기서 분류를 못 한 condition.type 목록.
 * 비어 있지 않으면 새 규칙이 조용히 잘못 편입되는 중이다 —
 * 이 저장소의 check-gate-registration 과 같은 '침묵 금지' 규율.
 */
export function unclassifiedConditions() {
  const known = new Set([...MARKET_CONDITIONS, ...SECURITY_CONDITIONS]);
  const out = new Set();
  for (const r of loadRules()) {
    const t = (r.condition ?? {}).type;
    if (t && !known.has(t)) out.add(t);
  }
  return [...out];
}

// 종목 단위로 확인된 condition.type. 새 타입이 생기면 unclassifiedConditions 가 드러낸다.
const SECURITY_CONDITIONS = new Set([
  'stopBreach', 'deadCross', 'ma200Breach', 'stopProximity', 'rsiOverbought', 'volumeDivergence',
  'targetProximity', 'opMarginDecline', 'lynchPeg', 'heldWithPnl', 'peVsSector', 'volumeDrop',
  'newsNegative', 'insiderSell', 'institutionalExit', 'heldOnly', 'optionsPutFlow',
  'supplyContractLoss', 'banListSell', 'marksEuphoria', 'druckTrendBreak', 'weakEarningsQuality',
  'negativeOcf', 'dilutionFinancing', 'highResaleMix', 'overextended200ma', 'highDebt',
]);

/**
 * 히트를 범위별로 나눈다.
 * @param {Array<{id?:string, condition?:string, score?:number}>} hits
 */
export function partition(hits = []) {
  const security = [], market = [];
  for (const h of hits) {
    const type = h.condition ?? condById().get(h.id);
    (scopeOfCondition(type) === 'market' ? market : security).push(h);
  }
  const sum = (a) => +a.reduce((s, h) => s + (h.score ?? 0), 0).toFixed(1);
  return { security, market, securityScore: sum(security), marketScore: sum(market) };
}

/**
 * 거부 판정은 종목 단위 점수로만 한다.
 * 시장 점수는 여기 들어오지 않는다 — 대신 exposureFactor 로 비중에 반영된다.
 */
export function shouldVeto(part, vetoScore) {
  return part.securityScore >= vetoScore;
}

/**
 * 레짐 점수 → 노출 배수. 문헌의 '단계적 축소'를 따른다(절벽 대신 계단).
 * 0 이하로 내려가지 않고, 완전 0 으로도 만들지 않는다 —
 * 완전 0 은 결국 전면 금지와 같아지고, 그게 애초의 문제였다.
 */
export function exposureFactor(marketScore) {
  const s = Math.max(0, Number(marketScore) || 0);
  if (s === 0) return 1;
  if (s < 5) return 0.85;
  if (s < 10) return 0.65;
  if (s < 15) return 0.45;
  return 0.3;
}
