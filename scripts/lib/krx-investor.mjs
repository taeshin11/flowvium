/**
 * scripts/lib/krx-investor.mjs
 *
 * KRX 투자자별 매매동향 — 순수 ESM JS (Redis 없음, scripts 전용)
 * POST https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd
 */

const ENDPOINT = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';

function toYYYYMMDD(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function parseKrxNum(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

/**
 * @param {string} stockCode 6자리 종목코드
 * @param {number} days 조회 일수 (기본 5)
 * @returns {Promise<Array<{date:string,instNetBuy:number,frgnNetBuy:number,indvNetBuy:number}>>}
 */
export async function fetchKrxInvestorFlow(stockCode, days = 5) {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (days + 4)); // 주말 포함 여유
  const endDd = toYYYYMMDD(today);
  const strtDd = toYYYYMMDD(startDate);

  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT02301',
    tboxisuCd_finder_stkisu0_0: stockCode,
    isuCd: stockCode,
    isuCd2: stockCode,
    strtDd,
    endDd,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://data.krx.co.kr/',
        'Origin': 'https://data.krx.co.kr',
      },
      body: body.toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[KRX] HTTP ${res.status} for ${stockCode}`);
      return [];
    }

    const json = await res.json();

    // 응답 구조 확인 (개발용)
    console.log(`[KRX] ${stockCode} sample:`, JSON.stringify(json?.OutBlock_1?.[0])?.slice(0, 200));

    const rows = json?.OutBlock_1 ?? [];
    return rows.slice(0, days).map(row => ({
      date: String(row.TRD_DD ?? row.trd_dd ?? '').replace(/\//g, '-'),
      instNetBuy: parseKrxNum(row.INST_NETBUY ?? row.inst_netbuy),
      frgnNetBuy: parseKrxNum(row.FRGN_NETBUY ?? row.frgn_netbuy),
      indvNetBuy: parseKrxNum(row.INDV_NETBUY ?? row.indv_netbuy),
    }));
  } catch (err) {
    clearTimeout(timer);
    console.error('[KRX] fetchKrxInvestorFlow error:', err?.message ?? err);
    return [];
  }
}
