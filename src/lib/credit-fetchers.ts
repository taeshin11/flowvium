/**
 * Country-specific live credit balance / margin debt fetchers.
 * Each returns null on failure — the caller falls back to static data.
 *
 * Data sources:
 *   US  — FRED BOGZ1FL663067003Q (quarterly margin loans, reliable)
 *   TW  — TWSE MI_MARGN CSV (daily, public)
 *   JP  — JPX weekly margin balance (HTML scrape)
 *   KR  — KRX 신용거래융자 (complex, best effort)
 *   CN  — SSE/SZSE 融资融券 (Chinese, best effort)
 *   IN  — NSE margin data (often blocked)
 *   EU  — ESMA/ECB (quarterly, best effort)
 */

export interface LiveCreditData {
  balance: number;         // billions USD
  balanceLocal: string;    // display string e.g. "$893B"
  period: string;          // data period e.g. "2026-01"
  source: string;
  fetchedAt: string;       // ISO timestamp when we fetched
}

import { logger } from './logger';

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** ── US: FRED quarterly margin loans via official API ─────────── */
export async function fetchUS(): Promise<LiveCreditData | null> {
  // Try FRED API JSON (fast, lightweight) if key is set
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (apiKey) {
    const start = Date.now();
    try {
      logger.info('credit.us', 'fred_api_start');
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=BOGZ1FL663067003Q&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: COMMON_HEADERS, cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        const obs = json.observations?.[0];
        if (obs && obs.value !== '.') {
          const value = parseFloat(obs.value);
          const FINRA_CALIBRATION = 1.30;
          const zRawBillions = value / 1000;
          const balance = parseFloat((zRawBillions * FINRA_CALIBRATION).toFixed(1));
          const d = new Date(obs.date);
          const quarter = `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
          logger.info('credit.us', 'fred_api_ok', { balance, quarter, durationMs: Date.now() - start });
          return {
            balance,
            balanceLocal: `$${balance}B`,
            period: quarter,
            source: 'FRED Z.1 (FINRA-calibrated)',
            fetchedAt: new Date().toISOString(),
          };
        }
      } else {
        logger.warn('credit.us', 'fred_api_http_error', { status: res.status, durationMs: Date.now() - start });
      }
    } catch (e) { logger.error('credit.us', 'fred_api_error', { error: e }); }
  }

  // Fallback: FRED fredgraph CSV
  const start = Date.now();
  try {
    logger.info('credit.us', 'fred_csv_start');
    const res = await fetch(
      'https://fred.stlouisfed.org/graph/fredgraph.csv?id=BOGZ1FL663067003Q&cosd=2024-01-01',
      { signal: AbortSignal.timeout(20000), headers: COMMON_HEADERS, cache: 'no-store' }
    );
    if (!res.ok) {
      logger.warn('credit.us', 'fred_csv_http_error', { status: res.status, durationMs: Date.now() - start });
      return null;
    }
    const text = await res.text();
    const rows = text.trim().split('\n').slice(1)
      .map(line => {
        const [date, val] = line.split(',');
        const value = parseFloat(val);
        return (!date || isNaN(value)) ? null : { date: date.trim(), value };
      })
      .filter((x): x is { date: string; value: number } => x !== null);

    const last = rows[rows.length - 1];
    if (!last) { logger.warn('credit.us', 'fred_csv_no_data'); return null; }

    const balance = parseFloat((last.value / 1000).toFixed(1));
    const d = new Date(last.date);
    const quarter = `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
    logger.info('credit.us', 'fred_csv_ok', { balance, quarter, durationMs: Date.now() - start });

    return {
      balance,
      balanceLocal: `$${balance}B`,
      period: quarter,
      source: 'FRED BOGZ1FL663067003Q',
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) { logger.error('credit.us', 'fred_csv_error', { error: e, durationMs: Date.now() - start }); return null; }
}

/** ── Taiwan: TWSE daily margin statistics ──────────────────────── */
export async function fetchTW(): Promise<LiveCreditData | null> {
  const start = Date.now();
  try {
    logger.info('credit.tw', 'twse_start');
    // Try recent weekdays backward (markets closed on weekends/holidays)
    const now = new Date();
    for (let offset = 1; offset <= 7; offset++) {
      const d = new Date(now);
      d.setDate(d.getDate() - offset);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue; // skip weekends

      const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${yyyymmdd}&selectType=MS&response=json`;

      const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: COMMON_HEADERS, cache: 'no-store' });
      if (!res.ok) { logger.warn('credit.tw', 'http_error', { status: res.status, date: yyyymmdd }); continue; }
      const json = await res.json();
      if (json.stat !== 'OK') { logger.warn('credit.tw', 'bad_stat', { stat: json.stat, date: yyyymmdd }); continue; }

      // Response structure:
      // { tables: [{ fields, data: [[label, buy, sell, return, prevBal, todayBal], ...] }] }
      // Find the "融資金額(仟元)" row — it's total margin balance in NT$ thousands
      const tables = json.tables as Array<{ data?: string[][] }> | undefined;
      if (!tables?.length) continue;

      let row: string[] | undefined;
      for (const t of tables) {
        row = t.data?.find(r => r[0]?.includes('融資金額'));
        if (row) break;
      }
      if (!row) continue;

      // 今日餘額 (today's balance) at index 5 — in NT$ 仟元 (thousands)
      const todayThousands = parseFloat((row[5] ?? '').replace(/,/g, ''));
      if (!todayThousands || isNaN(todayThousands)) continue;

      // Convert: 仟元 → USD billions (1 仟元 = 1000 NT$)
      const twdTotal = todayThousands * 1000;  // total NT$
      const usdBillions = parseFloat((twdTotal / 32 / 1_000_000_000).toFixed(2));
      const ntBillions = Math.round(twdTotal / 1_000_000_000);

      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      logger.info('credit.tw', 'twse_ok', { balance: usdBillions, period, durationMs: Date.now() - start });
      return {
        balance: usdBillions,
        balanceLocal: `NT$${ntBillions}B`,
        period,
        source: 'TWSE MI_MARGN',
        fetchedAt: new Date().toISOString(),
      };
    }
    logger.warn('credit.tw', 'no_data', { message: 'no valid data across 7 days' });
    return null;
  } catch (e) { logger.error('credit.tw', 'twse_error', { error: e, durationMs: Date.now() - start }); return null; }
}

/** ── Japan: JPX weekly margin balance (best-effort HTML scrape) ── */
export async function fetchJP(): Promise<LiveCreditData | null> {
  try {
    // JPX provides weekly data at:
    // https://www.jpx.co.jp/markets/statistics-equities/margin/02.html
    // Simplest approach: use FRED series for Japan if available, otherwise null
    // FRED does not have a JP margin debt series
    // Alternative: scrape JPX CSV download URL
    // Example: https://www.jpx.co.jp/markets/statistics-equities/margin/tvdivq0000008fmb-att/tokuyaku_{yyyymmdd}.xls

    // For now: return null (fall back to static). JPX files are .xls which needs special parsing.
    return null;
  } catch { return null; }
}

/** ── Korea: KRX 신용거래융자 / BOK ECOS fallback ─────────────────
 *
 * Fetch strategy (in order):
 *  1. KRX JSON endpoint (no auth needed) — OTP-based but accessible via POST
 *  2. BOK ECOS API (requires KOREA_BOK_API_KEY, free via https://ecos.bok.or.kr → 회원가입 → API 키 발급)
 *  3. If both fail, returns static-estimated value tagged source:'static-estimated'
 *     so the route does NOT silently serve stale data.
 *
 * How to obtain BOK ECOS API key:
 *   1. Go to https://ecos.bok.or.kr/api/#/
 *   2. Register/login → 마이페이지 → API 키 발급
 *   3. Set KOREA_BOK_API_KEY in .env.local and Vercel environment variables
 */
export async function fetchKR(): Promise<LiveCreditData | null> {
  const start = Date.now();

  // ── Attempt 1: KRX OTP-based JSON endpoint (no API key needed) ──────────
  try {
    logger.info('credit.kr', 'krx_start');
    // Step 1: get OTP token
    const otpRes = await fetch('https://data.krx.co.kr/comm/util/SearchEngineApi/getSearchEngineData.cmd', {
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://data.krx.co.kr',
      },
      body: 'bld=dbms/MDC/STAT/standard/MDCSTAT03701&locale=ko_KR&searchText=신용융자',
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });

    if (otpRes.ok) {
      const otpJson = await otpRes.json();
      const otp = otpJson.result?.output?.[0]?.otp ?? otpJson.output?.[0]?.otp;
      if (otp) {
        const dataRes = await fetch('https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd', {
          method: 'POST',
          headers: {
            ...COMMON_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': 'https://data.krx.co.kr',
          },
          body: `bld=dbms/MDC/STAT/standard/MDCSTAT03701&otp=${otp}&locale=ko_KR`,
          signal: AbortSignal.timeout(10000),
          cache: 'no-store',
        });

        if (dataRes.ok) {
          const dataJson = await dataRes.json();
          const rows = dataJson.OutBlock_1 ?? dataJson.output;
          if (Array.isArray(rows) && rows.length > 0) {
            // Rows have 신용융자잔고(억원) as ISU_ABBRV or CREDIT_RMNDR_AMT
            const last = rows[rows.length - 1];
            const rawAmt = last.CREDIT_RMNDR_AMT ?? last.IND_CREDIT_RMNDR_AMT ?? last.AMT;
            if (rawAmt) {
              const krwAuk = parseFloat(String(rawAmt).replace(/,/g, ''));  // 억원
              if (!isNaN(krwAuk) && krwAuk > 0) {
                const krwBillions = krwAuk / 10000;  // 억원 → 조원
                const usdBillions = parseFloat((krwBillions * 1000 / 1450).toFixed(2));  // 조원 → B USD
                const period = (last.BAS_DD ?? last.TRD_DD ?? '').replace(/(d{4})(d{2})(d{2})/, '$1-$2-$3');
                logger.info('credit.kr', 'krx_ok', { balance: usdBillions, period, durationMs: Date.now() - start });
                return {
                  balance: usdBillions,
                  balanceLocal: `₩${krwBillions.toFixed(1)}조`,
                  period: period || new Date().toISOString().slice(0, 7),
                  source: 'KRX MDCSTAT03701',
                  fetchedAt: new Date().toISOString(),
                };
              }
            }
          }
        }
      }
    }
    logger.warn('credit.kr', 'krx_failed', { durationMs: Date.now() - start });
  } catch (e) {
    logger.warn('credit.kr', 'krx_error', { error: e, durationMs: Date.now() - start });
  }

  // ── Attempt 2: BOK ECOS API (requires KOREA_BOK_API_KEY) ─────────────────
  const apiKey = process.env.KOREA_BOK_API_KEY?.trim();
  if (apiKey) {
    try {
      logger.info('credit.kr', 'bok_start');
      const now = new Date();
      const endYm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const startDate = new Date(now); startDate.setMonth(startDate.getMonth() - 3);
      const startYm = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, '0')}`;

      // BOK ECOS: 신용거래융자 잔액 (통계코드 901Y001, 항목코드 0060000)
      const url = `https://ecos.bok.or.kr/api/StatisticSearch/${apiKey}/json/kr/1/10/901Y001/M/${startYm}/${endYm}/0060000`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: COMMON_HEADERS, cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        const rows = json.StatisticSearch?.row;
        if (Array.isArray(rows) && rows.length > 0) {
          const last = rows[rows.length - 1];
          const krwAuk = parseFloat(last.DATA_VALUE ?? '0');  // 억원
          if (!isNaN(krwAuk) && krwAuk > 0) {
            const krwBillions = krwAuk / 10000;  // 억원 → 조원
            const usdBillions = parseFloat((krwBillions * 1000 / 1450).toFixed(2));
            const period = `${last.TIME.slice(0, 4)}-${last.TIME.slice(4, 6)}`;
            logger.info('credit.kr', 'bok_ok', { balance: usdBillions, period, durationMs: Date.now() - start });
            return {
              balance: usdBillions,
              balanceLocal: `₩${krwBillions.toFixed(1)}조`,
              period,
              source: 'BOK ECOS 901Y001',
              fetchedAt: new Date().toISOString(),
            };
          }
        }
      }
      logger.warn('credit.kr', 'bok_failed', { durationMs: Date.now() - start });
    } catch (e) {
      logger.warn('credit.kr', 'bok_error', { error: e, durationMs: Date.now() - start });
    }
  }

  // ── Attempt 3: static-estimated fallback (2026-Q1 known value) ───────────
  // Returns tagged source so verify-metrics can detect static state.
  logger.warn('credit.kr', 'using_static_estimate', { reason: 'all live fetches failed' });
  return {
    balance: 21.4,
    balanceLocal: '₩31조',
    period: '2026-03',
    source: 'static-estimated',
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchCN(): Promise<LiveCreditData | null> {
  try {
    // 東方財富(eastmoney) 沪深两市 融资融券 历史 — 시장 전체(SSE+SZSE) 집계 일별 시계열.
    //   기존 query.sse.com.cn 엔드포인트는 응답구조 변경(result=null)으로 사멸 → eastmoney 로 교체.
    //   RZYE = 融资余额(margin financing balance, 전체시장 CNY) — US FINRA margin debt 와 동일 개념(차입매수).
    const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_RZRQ_LSHJ&columns=DIM_DATE,RZYE&sortColumns=dim_date&sortTypes=-1&pageSize=1&pageNumber=1';
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
      headers: {
        ...COMMON_HEADERS,
        'Referer': 'https://data.eastmoney.com/',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const row = json?.result?.data?.[0];
    const rzyeCny = Number(row?.RZYE);   // 융자余额 (전체시장, CNY)
    if (!rzyeCny || !isFinite(rzyeCny)) return null;

    const usdBillions = parseFloat((rzyeCny / 7.25 / 1_000_000_000).toFixed(1));
    const date = (row.DIM_DATE ?? '').toString().slice(0, 10);   // "2026-06-03 00:00:00" → "2026-06-03"

    return {
      balance: usdBillions,
      balanceLocal: `¥${(rzyeCny / 1_000_000_000_000).toFixed(2)}조위안`,
      period: date || 'latest',
      source: 'Eastmoney 沪深两市 融资余额',
      fetchedAt: new Date().toISOString(),
    };
  } catch { return null; }
}

/** ── India: NSE (blocks without cookies, usually fails) ────────── */
export async function fetchIN(): Promise<LiveCreditData | null> {
  // NSE blocks server-side requests. No reliable free source.
  return null;
}

/** ── EU: ESMA (quarterly, best effort) ─────────────────────────── */
export async function fetchEU(): Promise<LiveCreditData | null> {
  // ESMA doesn't publish a single aggregate margin figure.
  // ECB SDW has some data but not directly margin loans.
  return null;
}

/** ── Main orchestrator ─────────────────────────────────────────── */
export async function fetchAllCreditData(): Promise<Record<string, LiveCreditData | null>> {
  const [us, tw, jp, kr, cn, ind, eu] = await Promise.all([
    fetchUS().catch(() => null),
    fetchTW().catch(() => null),
    fetchJP().catch(() => null),
    fetchKR().catch(() => null),
    fetchCN().catch(() => null),
    fetchIN().catch(() => null),
    fetchEU().catch(() => null),
  ]);
  return { us, tw, jp, kr, cn, in: ind, eu };
}
