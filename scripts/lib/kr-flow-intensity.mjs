// scripts/lib/kr-flow-intensity.mjs — KR 종목별 수급강도 (2026-07-04 이연 이행)
//
// 이연 사유였던 "거래대금 데이터 파이프": frgn.naver 일별 테이블 *한 페이지*에 거래량+종가+외인/기관
// 순매매량이 전부 있어 별도 파이프 불필요(회고로 판명). korea-flow route 의 검증된 셀 레이아웃 재사용:
//   [0]날짜 [1]종가 [2]전일비 [3]등락률 [4]거래량 [5]기관 순매매량 [6]외국인 순매매량 [7]보유주수 [8]보유율
// 산출: 외인/기관 연속 순매수 streak(일), 5일 순매수 합(원), 수급강도 = |외인+기관 5d 순매수| / 5d 거래대금.
// 소비: buildBuyCandidates stage-3 (KR 후보 ≤15 → 요청 부담 미미) → 엔진 krFlowIntensity 룰.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function fetchOne(code) {
  try {
    const res = await fetch(`https://finance.naver.com/item/frgn.naver?code=${code}`, {
      headers: { 'User-Agent': UA, Referer: 'https://finance.naver.com/', 'Accept-Language': 'ko-KR,ko;q=0.9' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = new TextDecoder('euc-kr').decode(await res.arrayBuffer());
    const raw = Array.from(html.matchAll(/<span class="tah[^"]*">([\s\S]*?)<\/span>/g))
      .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/[,\s\n]/g, '').trim())
      .filter((v) => v.length > 0);
    const dateIdx = raw.findIndex((v) => /^\d{4}\.\d{2}\.\d{2}$/.test(v));
    if (dateIdx < 0) return null;

    const rows = [];
    for (let d = 0; d < 10; d++) {
      const off = dateIdx + d * 9;
      const row = raw.slice(off, off + 9);
      if (!row[0] || !/^\d{4}\.\d{2}\.\d{2}$/.test(row[0])) break;
      const close = Number(row[1]) || null;
      const volume = Number(row[4]) || 0;
      const inst = Number((row[5] ?? '0').replace('+', '')) || 0;      // 주수 (음수 = 순매도)
      const frgn = Number((row[6] ?? '0').replace('+', '')) || 0;
      rows.push({ close, volume, instKrw: close ? inst * close : 0, frgnKrw: close ? frgn * close : 0, turnoverKrw: close ? volume * close : 0 });
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
  } catch { return null; }
}

/** codes: 6자리 코드 배열 (또는 .KS/.KQ 티커 — 자동 strip). Map(원본입력 → 수급강도) 반환. */
export async function fetchKrFlowIntensity(tickers) {
  const map = new Map();
  const jobs = tickers.map(async (t) => {
    const code = String(t).replace(/\.(KS|KQ)$/, '');
    if (!/^\d{6}$/.test(code)) return;
    const r = await fetchOne(code);
    if (r) map.set(t, r);
  });
  await Promise.all(jobs);
  return map;
}
