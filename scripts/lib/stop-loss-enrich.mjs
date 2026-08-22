/**
 * stop-loss-enrich.mjs — 손절 근거 문자열에 현재가/손절선을 그 종목의 통화로 덧붙인다.
 *
 * 2026-08-22: generate-report-local.mjs 안에 있던 enrichStopLoss 를 여기로 옮기며
 *   `$` 하드코딩을 제거했다. 원래 코드는
 *       parts.push(isEn ? `cur $${lp.price} …` : `현재 $${lp.price} …`)
 *   로 **언어**(isEn)만 분기하고 **통화**는 항상 달러였다. 그래서 KR 종목의 원화가
 *   `현재 $281500` 으로 나갔고, 하네스(6j-2)가 매번 `$`→`₩` 로 되돌렸다.
 *   집계: harness_currencyMismatch 187건 중 185건이 이 코드가 만든 문자열이고
 *   실제 모델 오류는 2건뿐이었다(2026-06-17~08-22).
 *
 *   발간본에 틀린 기호가 나간 적은 없다 — 하네스가 먼저 고쳤다. 비용은 다른 데 있었다:
 *     ① 코드가 만든 문자열을 코드가 고치고 **모델의 결함으로 기록**했다(오귀인 185건)
 *     ② 그래서 결함 추세·/admin/logs·오탐률 분석이 왜곡됐다
 *   (프롬프트 주입은 아니었다 — db.mjs:1377 이 harness_* 를 주입 대상에서 제외한다.)
 *
 * 통화 판정은 여기 한 곳에만 둔다. 두 벌이 되면 표기가 갈린다.
 */

/** 티커 접미사 → 표시 통화. buildTechnicalData 의 isKR 판정과 같은 규칙. */
export function nativeCurrencyForTicker(ticker) {
  const t = (ticker ?? '').toUpperCase();
  if (t.endsWith('.KS') || t.endsWith('.KQ')) return '₩';
  if (t.endsWith('.AS') || t.endsWith('.PA') || t.endsWith('.DE')) return '€';
  return '$';
}

/** 통화별 자리수: 원화는 소수점이 의미 없다(₩261,795.00 은 오표기). */
export function formatPrice(n, curr) {
  if (!isFinite(n)) return null;
  if (curr === '₩') return `${curr}${Math.round(n).toLocaleString('en-US')}`;
  return `${curr}${n > 100 ? n.toFixed(2) : parseFloat(n.toFixed(4))}`;
}

const STOP_PCT = 0.07;

export function enrichStopLoss(stopLossRationale, livePrices, technicalData, locale = 'ko') {
  const isEn = !['ko', 'ja', 'zh-CN', 'zh-TW', 'zh'].includes(locale);
  let enriched = 0;
  for (const entry of (stopLossRationale ?? [])) {
    if (!entry.ticker || (entry.rationale ?? '').length >= 100) continue;
    const lp = livePrices?.get(entry.ticker);
    const tech = technicalData?.get(entry.ticker);
    const parts = [];
    if (lp?.price > 0) {
      const curr = nativeCurrencyForTicker(entry.ticker);
      const cur = formatPrice(lp.price, curr);
      const stop = formatPrice(lp.price * (1 - STOP_PCT), curr);
      if (cur && stop) {
        parts.push(isEn
          ? `cur ${cur} → stop ~${stop} (-7%)`
          : `현재 ${cur} → 손절선 ~${stop} (-7%)`);
      }
    }
    if (tech) parts.push(tech);
    if (parts.length === 0) continue;
    const append = parts.slice(0, 2).join(' / ');
    entry.rationale = entry.rationale ? `${entry.rationale} | ${append}` : append;
    enriched++;
  }
  if (enriched > 0) console.log(`  [후처리] stopLossRationale 구체화: ${enriched}개`);
  return stopLossRationale;
}
