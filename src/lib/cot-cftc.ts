/**
 * cot-cftc.ts — CFTC 공식 데이터 API(legacy futures-only, 데이터셋 6dca-aqww) 행 → COT 항목. 2026-10-16.
 * 근거는 scripts/lib/cot-cftc.test.mjs 머리말(옛 txt 403 · TFF 칸을 비상업으로 잘못 읽음).
 */
export interface CotEntry {
  id: string;
  label: string;
  reportDate: string;
  openInterest: number;
  noncommLong: number;
  noncommShort: number;
  netPosition: number;    // noncommLong - noncommShort
  netPctOI: number;       // netPosition / openInterest * 100, 1dp
  weeklyChange: number | null;
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

/** 시장 이름은 CFTC 표기 그대로 정확히 일치(10/16 실측 이름). */
export const COT_MARKETS: { id: string; label: string; name: string }[] = [
  { id: 'sp500', label: 'E-mini S&P 500', name: 'E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE' },
  { id: 'nasdaq', label: 'Nasdaq-100', name: 'NASDAQ MINI - CHICAGO MERCANTILE EXCHANGE' },
  { id: 'ust10y', label: '10Y T-Note', name: 'UST 10Y NOTE - CHICAGO BOARD OF TRADE' },
  { id: 'ust2y', label: '2Y T-Note', name: 'UST 2Y NOTE - CHICAGO BOARD OF TRADE' },
  { id: 'eurusd', label: 'EUR/USD', name: 'EURO FX - CHICAGO MERCANTILE EXCHANGE' },
  { id: 'jpyusd', label: 'Japanese Yen', name: 'JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE' },
  { id: 'vix', label: 'VIX', name: 'VIX FUTURES - CBOE FUTURES EXCHANGE' },
];

export const COT_API = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json';

function sentiment(netPctOI: number): CotEntry['sentiment'] {
  if (netPctOI > 15) return 'bullish';
  if (netPctOI < -15) return 'bearish';
  return 'neutral';
}

type Row = Record<string, string | undefined>;

/** 행들(여러 주 섞여도 됨) → 시장마다 가장 최근 주 하나. 없는 시장은 뺀다. */
export function rowsToEntries(rows: Row[]): CotEntry[] {
  const out: CotEntry[] = [];
  for (const m of COT_MARKETS) {
    const r = rows.filter((x) => x.market_and_exchange_names === m.name)
      .sort((a, b) => String(b.report_date_as_yyyy_mm_dd).localeCompare(String(a.report_date_as_yyyy_mm_dd)))[0];
    if (!r) continue;
    const oi = Number(r.open_interest_all), lng = Number(r.noncomm_positions_long_all), sht = Number(r.noncomm_positions_short_all);
    if (!(oi > 0) || !Number.isFinite(lng) || !Number.isFinite(sht)) continue;
    const net = lng - sht;
    const pct = Math.round((net / oi) * 1000) / 10;
    const cl = Number(r.change_in_noncomm_long_all), cs = Number(r.change_in_noncomm_short_all);
    const hasChg = r.change_in_noncomm_long_all != null && r.change_in_noncomm_short_all != null && Number.isFinite(cl) && Number.isFinite(cs);
    out.push({ id: m.id, label: m.label, reportDate: String(r.report_date_as_yyyy_mm_dd).slice(0, 10), openInterest: oi,
      noncommLong: lng, noncommShort: sht, netPosition: net, netPctOI: pct, weeklyChange: hasChg ? cl - cs : null, sentiment: sentiment(pct) });
  }
  return out;
}

/** 최근 3주치 대상 시장 행을 가져오는 쿼리 URL. */
export function cotQueryUrl(today = new Date()): string {
  const since = new Date(today.getTime() - 21 * 86400_000).toISOString().slice(0, 10);
  const names = COT_MARKETS.map((m) => `'${m.name.replace(/'/g, "''")}'`).join(',');
  const where = `report_date_as_yyyy_mm_dd >= '${since}' AND market_and_exchange_names in (${names})`;
  const select = 'market_and_exchange_names,report_date_as_yyyy_mm_dd,open_interest_all,noncomm_positions_long_all,noncomm_positions_short_all,change_in_noncomm_long_all,change_in_noncomm_short_all';
  return `${COT_API}?$select=${encodeURIComponent(select)}&$where=${encodeURIComponent(where)}&$limit=100`;
}
