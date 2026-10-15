/**
 * fedwatch-calc.ts — 연방기금 선물(ZQ)로 FOMC 회의별 금리 변동 확률을 계산한다(순수 함수). 2026-10-16 신설.
 *
 * 왜(사이트 전체 눈검증 10/16 — agy argon 이 홈 '금리 전망' 카드를 잡았다):
 *   /api/fedwatch 가 현재 목표금리를 2026-04-26 값(3.50~3.75%)으로 **박아 두고** 그 위에서 확률을 계산했다.
 *   9/17 FOMC 인상으로 실제는 3.75~4.00%(FRED DFEDTARL/U), 실효금리 3.88%(DFF). 그래서 선물이 '동결'을 가리키는데
 *   화면은 'Oct 29 동결 16% · 인상 84%', 홈 카드는 '동결 16% / 인하 0%'(인상 빠짐), '현재 금리 3.625%' 로 나갔고
 *   보고서 생성기에도 같은 숫자가 들어갔다. 지난 회의(4~9월)도 목록에 남아 있었다.
 * 계산(CME FedWatch 와 같은 생각, 단순형):
 *   - 기준 = 실효금리(DFF) — 선물은 실효금리로 정산된다.
 *   - 회의 뒤 금리 = 회의 **다음 달** 계약의 내재금리(100 - 가격) — 그 달은 결정이 온전히 반영된다.
 *   - 변동 Δ = 회의 뒤 금리 - 기준. 25bp 단위로 나눠 가까운 두 결과에 선형 배분(예: +0.07%p → 인상 28%·동결 72%).
 *   - 확률은 **현재 대비 누적**이다(그 회의까지 몇 번 움직였나). 회의별 조건부 확률이 아니다.
 * 손으로 정한 확률·금리는 없다. 기준을 못 받으면 계산하지 않는다(정적 값 폴백 금지 — CLAUDE.md 시계열 규칙).
 */

export interface FomcMeetingCalc {
  date: string; label: string;
  probHike: number; probHike50: number; probHold: number; probCut25: number; probCut50: number; probCut75: number;
  impliedRate: number; changeBps: number; cumulativeCuts: number;
  targetLow: number; targetHigh: number; current: number; contract: string;
}

/** Redis 캐시 키 — 한 곳에서만. 10/16 라우트만 v3 로 올렸더니 홈 카드(latest-updates)가 v2 를 직접 읽어 옛 값을 계속 냈다. */
export function fedwatchCacheKey(d: Date = new Date()): string {
  return `flowvium:fedwatch:v3:${d.toISOString().slice(0, 10)}`;
}

const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 회의 다음 달 ZQ 계약 코드(예: 2026-10-29 → ZQX26). */
export function postMeetingContract(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 0 : m;            // 0-based 다음 달
  return `ZQ${MONTH_CODES[nm]}${String(ny).slice(2)}`;
}

/** Δ(%p) → 25bp 단위 결과 확률(%). 가까운 두 결과에 선형 배분. */
export function stepProbs(deltaPct: number): Record<number, number> {
  const steps = deltaPct / 0.25;
  const lo = Math.floor(steps + 1e-9);
  const frac = steps - lo;
  const out: Record<number, number> = {};
  out[lo] = (1 - frac) * 100;
  if (frac > 1e-9) out[lo + 1] = frac * 100;
  return out;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** 미래 회의마다 확률. dates 는 공식 FOMC 일정(결정일), today 이후만 남긴다. prices: 계약코드 → 가격. */
export function computeMeetings(
  { dates, prices, effr, targetLow, targetHigh, today }:
  { dates: string[]; prices: Record<string, number>; effr: number; targetLow: number; targetHigh: number; today: string },
): FomcMeetingCalc[] {
  const out: FomcMeetingCalc[] = [];
  for (const date of dates) {
    if (date < today) continue;
    const contract = postMeetingContract(date);
    const p = prices[contract];
    if (!(p > 90 && p < 100)) continue;   // 가격이 없거나 이상하면 그 회의는 계산하지 않는다
    const implied = 100 - p;
    const delta = implied - effr;
    const probs = stepProbs(delta);
    const at = (k: number) => probs[k] ?? 0;
    const hike = Object.entries(probs).filter(([k]) => Number(k) > 0).reduce((s, [, v]) => s + v, 0);
    const cut75 = Object.entries(probs).filter(([k]) => Number(k) <= -3).reduce((s, [, v]) => s + v, 0);
    const modal = Number(Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0]);
    const [, m, d] = date.split('-').map(Number);
    out.push({
      date, label: `${MONTH_NAMES[m - 1]} ${d}`, contract,
      probHike: r1(hike), probHike50: r1(Object.entries(probs).filter(([k]) => Number(k) >= 2).reduce((s, [, v]) => s + v, 0)),
      probHold: r1(at(0)), probCut25: r1(at(-1)), probCut50: r1(at(-2)), probCut75: r1(cut75),
      impliedRate: Math.round(implied * 1000) / 1000, changeBps: Math.round(delta * 100),
      cumulativeCuts: Math.max(0, Math.round(-delta * 100)),
      targetLow: targetLow + modal * 0.25, targetHigh: targetHigh + modal * 0.25, current: (targetLow + targetHigh) / 2,
    });
  }
  return out;
}
