/**
 * judge-outcome.mjs — 매수 추천 하나의 결과 판정(진입·손절·목표·보유). 근거·규칙은 judge-outcome.test.mjs 머리말.
 *   2026-10-25 evaluate-recommendations.mjs 에서 옮겼다 — 판정이 '그 가격에 실제로 체결될 수 있었는가'를 따르게.
 *   종전: 손절 = 저가 <= 손절가×1.02, 목표 = 고가 >= 목표가×0.98, 추천 전 가격 포함, 진입가 = 진입 하단.
 */

/** Yahoo chart result → 날짜별 봉. 시·고·저·종 중 하나라도 비면 그 날을 통째로 뺀다(배열 어긋남 방지). */
export function barsFromChart(result) {
  const ts = result?.timestamp ?? [];
  const q = result?.indicators?.quote?.[0] ?? {};
  const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (pos(o) && pos(h) && pos(l) && pos(c)) out.push({ t: ts[i], o, h, l, c });
  }
  return out;
}

/**
 * @param {{generated_at:string, entry_low?:number|null, entry_high?:number|null, stop_loss?:number|null, target?:number|null}} rec
 * @param {{t:number,o:number,h:number,l:number,c:number}[]} bars  t = 장 시작 시각(epoch 초)
 * @returns {{outcome:'stop_loss'|'hit_target'|'still_holding'|'not_entered'|'unknown', entryPrice?:number, exitPrice?:number,
 *            highSeen?:number, lowSeen?:number, lastClose?:number, detail:string, neClass?:string}}
 */
export function judgeOutcome(rec, bars) {
  const genSec = Date.parse(rec.generated_at) / 1000;
  const live = (bars ?? []).filter((b) => b.t >= genSec);   // 추천 뒤에 열린 장만
  if (!live.length) return { outcome: 'unknown', detail: 'no bars after recommendation' };
  const entryHigh = rec.entry_high ?? rec.entry_low;
  const stop = rec.stop_loss, target = rec.target;
  let entered = false, entryPrice;
  let highSeen = -Infinity, lowSeen = Infinity;
  for (let i = 0; i < live.length; i++) {
    const b = live[i];
    if (!entered) {
      if (entryHigh == null || b.l > entryHigh) continue;
      entered = true;
      entryPrice = Math.min(b.o, entryHigh);
    }
    // 진입한 뒤의 가격만 센다(진입 전 고점·저점은 이 보유와 무관하다)
    if (b.h > highSeen) highSeen = b.h;
    if (b.l < lowSeen) lowSeen = b.l;
    // 같은 날 둘 다 닿으면 손절(보수적)
    if (stop != null && b.l <= stop) {
      const exitPrice = b.o < stop ? b.o : stop;
      return { outcome: 'stop_loss', entryPrice, exitPrice, highSeen, lowSeen, lastClose: b.c, detail: `day${i + 1}: low=${b.l} <= stop=${stop}${exitPrice !== stop ? ` (gap open ${b.o})` : ''}` };
    }
    if (target != null && b.h >= target) {
      const exitPrice = b.o > target ? b.o : target;
      return { outcome: 'hit_target', entryPrice, exitPrice, highSeen, lowSeen, lastClose: b.c, detail: `day${i + 1}: high=${b.h} >= target=${target}` };
    }
  }
  const lastClose = live.at(-1).c;
  if (!entered) {
    const hi = Math.max(...live.map((b) => b.h)), lo = Math.min(...live.map((b) => b.l));
    // 2026-06-14 NE 세분 — buy 룰 정확성 vs entry calibration 오염 방지(evaluate-recommendations 에서 옮김)
    const ranToTarget = target != null && hi >= target;
    const roseAboveEntry = entryHigh != null && hi > entryHigh * 1.02;
    const neClass = ranToTarget ? 'NE_WINNER_MISSED' : roseAboveEntry ? 'NE_UP_DRIFT' : 'NE_NO_FILL';
    return { outcome: 'not_entered', neClass, highSeen: hi, lowSeen: lo, lastClose,
      detail: `${neClass}: low_seen=${lo} > entry_high=${entryHigh}, high_seen=${hi}${target ? ` (target ${target})` : ''}` };
  }
  return { outcome: 'still_holding', entryPrice, highSeen, lowSeen, lastClose, detail: `last=${lastClose}` };
}
