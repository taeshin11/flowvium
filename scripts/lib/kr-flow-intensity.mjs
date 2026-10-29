// scripts/lib/kr-flow-intensity.mjs — KR 종목별 수급강도 (2026-07-04 이연 이행). 규칙·사례는 kr-flow-intensity.test.mjs.
//
// 원천: m.stock.naver.com/api/stock/<code>/trend — 일별 외국인·기관 순매수량·종가·거래량(JSON, 최신이 앞).
//   2026-10-30: 종전엔 frgn.naver 표 페이지를 긁었다. 네이버가 그 페이지를 새 앱(investmentinfo)으로 넘겨
//   9/10 뒤 253회차 전부 '0/N' — 파서가 null 만 냈다. 사이트 api/korea-flow 는 같은 일로 이 JSON 으로 옮겼는데
//   여기 사본은 남아 있었다. 그동안 micro_kr_smart_flow(매수)·micro_kr_flow_exodus(매도)가 입력 없이 침묵했다.
// 산출: 외인/기관 연속 순매수 streak(일), 5일 순매수 합(원), 수급강도 = (외인+기관 5d 순매수) / 5d 거래대금.
// 소비: buildBuyCandidates stage-3 (KR 후보 ≤15) · 매도 후보 KR 보유 종목 → 엔진 krFlowIntensity 룰.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const num = (v) => { const n = Number(String(v ?? '').replace(/[,+\s]/g, '')); return Number.isFinite(n) ? n : 0; };

/** trend JSON 줄들(최신이 앞) → 수급강도. 종가·거래량 있는 줄이 없으면 null. */
export function flowFromTrend(data) {
  if (!Array.isArray(data)) return null;
  const rows = [];
  for (const r of data.slice(0, 10)) {
    const close = num(r?.closePrice);
    const volume = num(r?.accumulatedTradingVolume);
    if (!close || !volume) continue;
    rows.push({ instKrw: num(r.organPureBuyQuant) * close, frgnKrw: num(r.foreignerPureBuyQuant) * close, turnoverKrw: volume * close });
  }
  if (!rows.length) return null;
  const streak = (key) => { let n = 0; for (const r of rows) { if (r[key] > 0) n++; else break; } return n; };
  const w5 = rows.slice(0, 5);
  const frgn5d = w5.reduce((s, r) => s + r.frgnKrw, 0);
  const inst5d = w5.reduce((s, r) => s + r.instKrw, 0);
  const turnover5d = w5.reduce((s, r) => s + r.turnoverKrw, 0);
  return {
    foreignStreak: streak('frgnKrw'),
    instStreak: streak('instKrw'),
    foreignNet5dKrw: Math.round(frgn5d),
    instNet5dKrw: Math.round(inst5d),
    // 수급강도: 스마트머니(외인+기관) 5d 순매수가 5d 거래대금에서 차지하는 비중(%). 방향 부호 유지.
    intensityPct: turnover5d > 0 ? +(((frgn5d + inst5d) / turnover5d) * 100).toFixed(2) : null,
    days: w5.length,
  };
}

async function fetchOne(code, fetchImpl) {
  try {
    const res = await fetchImpl(`https://m.stock.naver.com/api/stock/${code}/trend?pageSize=10&page=1`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return flowFromTrend(await res.json());
  } catch { return null; }
}

/** codes: 6자리 코드 배열 (또는 .KS/.KQ 티커 — 자동 strip). Map(원본입력 → 수급강도) 반환. */
export async function fetchKrFlowIntensity(tickers, { fetchImpl = fetch } = {}) {
  const map = new Map();
  const jobs = tickers.map(async (t) => {
    const code = String(t).replace(/\.(KS|KQ)$/, '');
    if (!/^\d{6}$/.test(code)) return;
    const r = await fetchOne(code, fetchImpl);
    if (r) map.set(t, r);
  });
  await Promise.all(jobs);
  return map;
}
