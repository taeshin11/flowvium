/**
 * portfolio-policy.mjs — 포트폴리오 구성 정책의 단일 소스.
 * 값은 data/portfolio-policy.json 이 쥔다. 여기에 숫자를 박지 않는다.
 * 근거·배경은 JSON 의 _note 필드에 남겼다(값과 사유를 같은 곳에 둔다).
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PATH = process.env.PORTFOLIO_POLICY_PATH ?? resolve(HERE, '../../data/portfolio-policy.json');
let _p = null;

export function loadPolicy() {
  if (_p) return _p;
  const p = JSON.parse(readFileSync(PATH, 'utf8'));
  for (const k of ['maxPositions', 'candidatePoolSize', 'marketQuota', 'krFlowVeto', 'stop']) {
    if (p[k] === undefined) throw new Error(`portfolio-policy: '${k}' 없음 (${PATH})`);
  }
  return (_p = p);
}

/** 시장별 슬롯 상·하한. 종전처럼 하한을 강제하지 않는다(좋은 후보가 있을 때만 담는다). */
export function resolveMarketSlots({ total, market }) {
  const q = loadPolicy().marketQuota[market];
  if (!q) throw new Error(`portfolio-policy: 알 수 없는 시장 '${market}'`);
  return { cap: Math.floor(total * q.cap), floor: Math.floor(total * (q.floor ?? 0)) };
}

/**
 * KR 외국인 수급 veto. 연속성과 강도를 함께 본다.
 * 데이터가 없으면 null — "없는 데이터로 매수 가능"이라고 단정하지 않는다(호출측이 처리).
 */
export function krFlowVeto({ foreignNetStreak, netPct }) {
  if (foreignNetStreak == null || netPct == null) return null;
  const v = loadPolicy().krFlowVeto;
  if (foreignNetStreak <= v.foreignNetStreakLte && netPct <= v.netPctLte) {
    return `KR 수급 veto: 외국인 ${Math.abs(foreignNetStreak)}일 연속 순매도, 강도 ${netPct}% — 신규 KR 롱 차단`;
  }
  return null;
}

/** 손절폭(%) = ATR% × 배수, 클램프. ATR 없으면 null(고정값으로 때우지 않는다). */
export function stopDistancePct({ atrPct }) {
  if (atrPct == null || !Number.isFinite(Number(atrPct))) return null;
  const s = loadPolicy().stop;
  return Math.min(s.maxPct, Math.max(s.minPct, Number(atrPct) * s.atrMultiple));
}
