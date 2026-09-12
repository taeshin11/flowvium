/**
 * ohlc.mjs — 날짜가 붙은 일봉. 배열이 어긋나지 않게. (2026-09-12 신설)
 *
 * 왜 따로 뒀나: evaluate-recommendations 의 가져오기는 closes/highs/lows 를 **각각 따로**
 *   걸러낸다. 어느 하루의 close 만 결측이면 그 배열만 한 칸 짧아지고, 이후 인덱스가
 *   서로 다른 날을 가리킨다. 하루씩 순회하며 손절/목표를 판정하는 로직이 그 인덱스를 쓴다.
 *   게다가 timestamp 를 아예 안 돌려줘서 "며칠째에 손절됐나" 를 되물을 수가 없다.
 *
 * 여기서는 **하루를 통째로 버리거나 통째로 남긴다.** 날짜를 함께 돌려준다 —
 *   언제 나왔는지 모르면 "그 뒤에 올랐나" 를 물을 수 없다.
 */
import { toYahooTicker } from './ticker-normalize.mjs';

/**
 * @returns {{ bars: {t:number,o:number,h:number,l:number,c:number}[], dropped: number } | null}
 */
export async function fetchBars(rawTicker, fromIso, toIso, { timeoutMs = 12000 } = {}) {
  const ticker = toYahooTicker(rawTicker);
  const p1 = Math.floor(new Date(fromIso).getTime() / 1000);
  const p2 = Math.floor(new Date(toIso).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`
    + `?period1=${p1}&period2=${p2}&interval=1d`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'Mozilla/5.0' }, cache: 'no-store' });
  } catch { return null; }
  if (!res.ok) return null;
  let d; try { d = await res.json(); } catch { return null; }
  const r = d?.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const bars = [];
  let dropped = 0;
  for (let i = 0; i < ts.length; i++) {
    const h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], o = q.open?.[i];
    // 하루 안에서 하나라도 없으면 그 하루를 버린다 — 반쪽짜리 날로 판정하지 않는다.
    if (![h, l, c].every((v) => typeof v === 'number' && v > 0)) { dropped++; continue; }
    bars.push({ t: ts[i] * 1000, o: typeof o === 'number' && o > 0 ? o : c, h, l, c });
  }
  return { bars, dropped };
}

/** 진입·손절·목표를 하루씩 따라가며 언제 무엇이 걸렸는지. evaluate-recommendations 와 같은 규칙. */
export function walkExit({ bars, entryHigh, stop, target }) {
  let entered = false, entryIdx = null;
  let peakBefore = -Infinity, troughBefore = Infinity;
  for (let i = 0; i < bars.length; i++) {
    const { h, l } = bars[i];
    if (!entered && entryHigh != null && l <= entryHigh) { entered = true; entryIdx = i; }
    if (entered) {
      if (h > peakBefore) peakBefore = h;
      if (l < troughBefore) troughBefore = l;
      if (stop != null && l <= stop * 1.02) return { kind: 'stop', idx: i, entryIdx, at: bars[i].t, price: stop, peakBefore, troughBefore };
      if (target != null && h >= target * 0.98) return { kind: 'target', idx: i, entryIdx, at: bars[i].t, price: target, peakBefore, troughBefore };
    }
  }
  return { kind: entered ? 'open' : 'no_entry', idx: null, entryIdx, at: null, price: null, peakBefore, troughBefore };
}

/** 청산 뒤 N 거래일의 최고·최저·마지막. "더 기다릴 여지" 를 재는 자리. */
export function afterExit(bars, exitIdx, n = 20) {
  const slice = bars.slice(exitIdx + 1, exitIdx + 1 + n);
  if (!slice.length) return null;
  return {
    days: slice.length,
    high: Math.max(...slice.map((b) => b.h)),
    low: Math.min(...slice.map((b) => b.l)),
    last: slice.at(-1).c,
  };
}

/**
 * 진입 뒤 규칙을 바꿔 가며 다시 돌려 본다 — 같은 일봉, 다른 청산 규칙.
 *
 * 하루 안의 순서는 알 수 없으므로 손절과 목표가 같은 날 걸리면 **손절 우선**(보수적).
 * 그렇게 해야 "이렇게 했으면 좋았을 텐데" 가 과장되지 않는다.
 *
 * @param {{
 *   bars: {t:number,h:number,l:number,c:number}[], entryHigh:number,
 *   stopPct:number,            // 진입가 대비 손절 폭 (양수, 예: 0.08)
 *   targetPct:number|null,     // 진입가 대비 목표 폭 (양수). null 이면 목표 없음(추격만)
 *   breakevenAt?:number|null,  // 평가이익이 이만큼(진입가 대비) 넘으면 손절을 본전으로
 *   trailPct?:number|null,     // 고점 대비 이만큼 밀리면 청산 (추격 손절)
 * }}
 * @returns {{kind:'stop'|'target'|'trail'|'open'|'no_entry', pnlPct:number|null, idx:number|null}}
 */
export function simulate({ bars, entryHigh, stopPct, targetPct, breakevenAt = null, trailPct = null }) {
  let entered = false, entry = null, peak = -Infinity;
  for (let i = 0; i < bars.length; i++) {
    const { h, l, c } = bars[i];
    if (!entered) {
      if (entryHigh != null && l <= entryHigh) { entered = true; entry = entryHigh; peak = h; }
      else continue;
    } else if (h > peak) peak = h;

    let stop = entry * (1 - stopPct);
    if (breakevenAt != null && peak >= entry * (1 + breakevenAt)) stop = Math.max(stop, entry);
    if (trailPct != null) stop = Math.max(stop, peak * (1 - trailPct));

    if (l <= stop) return { kind: stop > entry * (1 - stopPct) ? 'trail' : 'stop', pnlPct: (stop - entry) / entry * 100, idx: i };
    if (targetPct != null && h >= entry * (1 + targetPct)) return { kind: 'target', pnlPct: targetPct * 100, idx: i };
  }
  if (!entered) return { kind: 'no_entry', pnlPct: null, idx: null };
  return { kind: 'open', pnlPct: (bars.at(-1).c - entry) / entry * 100, idx: null };
}
