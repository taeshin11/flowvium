/**
 * SEC EDGAR Financial Facts API — free, public, no auth required.
 * Fetches latest reported annual financials from official 10-K/10-Q filings.
 *
 *   Company Facts:  https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit}.json
 *   Ticker → CIK:   https://www.sec.gov/files/company_tickers.json
 */

import { logger } from './logger';

const SEC_HEADERS = {
  'User-Agent': 'Flowvium (taeshinkim11@gmail.com)',
  'Accept': 'application/json',
};

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Approximate KRW/USD for revenue conversion (used for cross-country comparison only)
const KRW_USD = 1 / 1450;

export interface AnnualFinancials {
  fy: number;
  periodEnd: string;
  revenueUSD: number | null;
  operatingIncomeUSD: number | null;
  netIncomeUSD: number | null;
  epsDiluted: number | null;
  totalAssetsUSD: number | null;
  totalLiabilitiesUSD: number | null;
  equityUSD: number | null;
  operatingCFUSD: number | null;
  investingCFUSD: number | null;
  financingCFUSD: number | null;
  rdExpenseUSD: number | null;
  capexUSD: number | null;
  buybacksUSD: number | null;
  dividendsUSD: number | null;
  // Derived
  operatingMarginPct: number | null;
  roePct: number | null;
  roaPct: number | null;
  debtRatioPct: number | null;
}

export interface QuarterlyRevenue {
  label: string;       // "Q1 FY2025"
  fy: number;
  fp: string;          // Q1 | Q2 | Q3 | Q4
  periodEnd: string;
  revenueUSD: number;
  yoyPct: number | null;
}

export interface LiveFinancials {
  ticker: string;
  cik: string;
  companyName: string;
  fiscalYear: number;
  fiscalPeriod: string;
  periodEnd: string;
  revenueUSD: number;
  revenueFormatted: string;
  source: string;
  fetchedAt: string;
  // Extended financials (last 5 FY)
  annuals: AnnualFinancials[];
  latestAnnual: AnnualFinancials | null;
  // Quarterly revenue with Y/Y growth (last 8 quarters)
  quarterlyRevenue: QuarterlyRevenue[];
}

type TickerMap = Record<string, { cik_str: number; ticker: string; title: string }>;

let cachedTickerMap: Map<string, { cik: string; title: string }> | null = null;

async function loadTickerMap(): Promise<Map<string, { cik: string; title: string }>> {
  if (cachedTickerMap) return cachedTickerMap;
  const start = Date.now();
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: SEC_HEADERS,
      signal: AbortSignal.timeout(15000),
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      logger.warn('sec.financials', 'ticker_map_http_error', { status: res.status, durationMs: Date.now() - start });
      return new Map();
    }
    const json = (await res.json()) as TickerMap;
    const map = new Map<string, { cik: string; title: string }>();
    for (const entry of Object.values(json)) {
      map.set(entry.ticker.toUpperCase(), {
        cik: String(entry.cik_str).padStart(10, '0'),
        title: entry.title,
      });
    }
    cachedTickerMap = map;
    logger.info('sec.financials', 'ticker_map_loaded', { tickers: map.size, durationMs: Date.now() - start });
    return map;
  } catch (err) {
    logger.error('sec.financials', 'ticker_map_error', { error: err, durationMs: Date.now() - start });
    return new Map();
  }
}

export function formatUsd(v: number | null | undefined): string {
  if (v == null) return '-';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

interface USDEntry { val: number; fy: number; fp: string; form: string; end: string; filed: string; }

// 2026-06-01: 외국 발행사(ADR) 지원 — TSM 등은 10-K/us-gaap 아닌 20-F/ifrs-full 로 보고.
//   us-gaap/10-K 로 revenue 못 찾으면 ifrs-full/20-F 로 fallback (기존 US 종목 경로는 불변).
interface FactCfg {
  ns: string;            // XBRL taxonomy namespace
  annualForm: string[];  // 연차보고서 form (US=10-K, 외국 발행사 ADR=20-F)
  quarterForm: string;   // 분기보고서 form
  concepts: {
    revenue: string[]; opIncome: string[]; netIncome: string[]; eps: string[];
    assets: string[]; liabilities: string[]; equity: string[];
    opCF: string[]; invCF: string[]; finCF: string[];
    rd: string[]; capex: string[]; buyback: string[]; dividends: string[];
  };
}

const GAAP_CFG: FactCfg = {
  ns: 'us-gaap', annualForm: ['10-K', '20-F', '40-F'], quarterForm: '10-Q',
  concepts: {
    // RevenuesNetOfInterestExpense covers banks (JPM, BAC, C, WFC) which don't
    // report under the standard Revenues concept for 10-Q quarterly filings.
    revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense'],
    opIncome: ['OperatingIncomeLoss'],
    netIncome: ['NetIncomeLoss'],
    eps: ['EarningsPerShareDiluted'],
    assets: ['Assets'],
    liabilities: ['Liabilities'],
    equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    opCF: ['NetCashProvidedByUsedInOperatingActivities'],
    invCF: ['NetCashProvidedByUsedInInvestingActivities'],
    finCF: ['NetCashProvidedByUsedInFinancingActivities'],
    rd: ['ResearchAndDevelopmentExpense'],
    capex: ['PaymentsToAcquirePropertyPlantAndEquipment'],
    buyback: ['PaymentsForRepurchaseOfCommonStock'],
    dividends: ['PaymentsOfDividends'],
  },
};

// IFRS concept 이름은 TSM(CIK 1046179) 20-F companyfacts 로 검증 (2026-06-01).
const IFRS_CFG: FactCfg = {
  ns: 'ifrs-full', annualForm: ['20-F', '40-F'], quarterForm: '6-K',
  concepts: {
    revenue: ['Revenue', 'RevenueFromContractsWithCustomers'],
    opIncome: ['ProfitLossFromOperatingActivities', 'OperatingProfitLoss'],
    netIncome: ['ProfitLoss'],
    eps: ['DilutedEarningsLossPerShare'],
    assets: ['Assets'],
    liabilities: ['Liabilities'],
    equity: ['EquityAttributableToOwnersOfParent', 'Equity'],
    opCF: ['CashFlowsFromUsedInOperatingActivities'],
    invCF: ['CashFlowsFromUsedInInvestingActivities'],
    finCF: ['CashFlowsFromUsedInFinancingActivities'],
    rd: ['ResearchAndDevelopmentExpense'],
    capex: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
    buyback: ['PaymentsForRepurchaseOfEntitysOwnSharesClassifiedAsFinancingActivities'],
    dividends: ['DividendsPaidClassifiedAsFinancingActivities'],
  },
};

// 2026-06-04: 외국 발행사(ADR)는 현지통화 보고(ASML=EUR, NVO=DKK, GSK=GBP 등). XBRL units 가
//   USD 아닌 EUR/GBP/DKK/JPY 등 → .units.USD 만 읽던 코드가 누락. cross-comparison USD 환산용
//   상수 FX (dart-financials 의 KRW_USD 와 동일 패턴 — 표시 근사값, native 값이 정확).
// 정적 fallback (FRED 실패 시만). 2026-06-04: 라이브 FRED 환율로 동적화 (getFxRates).
const FX_TO_USD: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, DKK: 0.145, JPY: 0.0064, CHF: 1.10,
  CAD: 0.73, AUD: 0.66, SEK: 0.095, NOK: 0.092, HKD: 0.128, CNY: 0.138, ILS: 0.27, SGD: 0.74,
};
// Yahoo Finance FX 페어 → USD/현지통화. invert=true 면 페어가 USD/현지 라 역수.
//   (FRED 는 이 환경서 도달 불가 → stock-price 와 동일 Yahoo 소스 사용, reachable + 실시간.)
const YAHOO_FX: Record<string, { sym: string; invert: boolean }> = {
  EUR: { sym: 'EURUSD=X', invert: false }, GBP: { sym: 'GBPUSD=X', invert: false },
  AUD: { sym: 'AUDUSD=X', invert: false }, JPY: { sym: 'USDJPY=X', invert: true },
  DKK: { sym: 'USDDKK=X', invert: true }, CHF: { sym: 'USDCHF=X', invert: true },
  CAD: { sym: 'USDCAD=X', invert: true }, CNY: { sym: 'USDCNY=X', invert: true },
  HKD: { sym: 'USDHKD=X', invert: true }, SEK: { sym: 'USDSEK=X', invert: true },
  NOK: { sym: 'USDNOK=X', invert: true }, SGD: { sym: 'USDSGD=X', invert: true },
};
let FX_CACHE: { rates: Record<string, number>; at: number; live: boolean } | null = null;
const FX_TTL = 12 * 60 * 60_000; // 12h
// 2026-06-04: 라이브 Yahoo FX (정적 상수 → 동적). 실패 시 FX_TO_USD fallback. source 추적용 live 플래그.
async function getFxRates(): Promise<{ rates: Record<string, number>; live: boolean }> {
  if (FX_CACHE && Date.now() - FX_CACHE.at < FX_TTL) return { rates: FX_CACHE.rates, live: FX_CACHE.live };
  const rates: Record<string, number> = { ...FX_TO_USD };
  let liveCount = 0;
  await Promise.all(Object.entries(YAHOO_FX).map(async ([cur, { sym, invert }]) => {
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const j = await res.json() as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> } };
      const v = j.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (Number.isFinite(v) && (v as number) > 0) { rates[cur] = invert ? 1 / (v as number) : (v as number); liveCount++; }
    } catch { /* keep static fallback for this currency */ }
  }));
  const live = liveCount > 0;
  FX_CACHE = { rates, at: Date.now(), live };
  return { rates, live };
}
export async function getFxStatus() { const r = await getFxRates(); return { live: r.live, eur: r.rates.EUR, gbp: r.rates.GBP }; }
// 보고 통화 감지 — revenue 개념의 units 키 중 첫 번째 알려진 통화.
function detectCurrency(facts: Record<string, unknown>, cfg: FactCfg): string {
  for (const name of cfg.concepts.revenue) {
    const units = (facts as Record<string, Record<string, Record<string, Record<string, unknown>>>>)
      ?.[cfg.ns]?.[name]?.units;
    if (units) {
      if (units.USD) return 'USD';
      for (const k of Object.keys(units)) if (FX_TO_USD[k] != null) return k;
    }
  }
  return 'USD';
}

/** Pick best entry for a concept across all possible names (default GAAP/10-K). */
function bestFYEntry(facts: Record<string, unknown>, names: string[], cfg: FactCfg = GAAP_CFG, unit: string = 'USD'): USDEntry | null {
  let best: USDEntry | null = null;
  for (const name of names) {
    const entries = (facts as Record<string, Record<string, Record<string, Record<string, USDEntry[]>>>>)
      ?.[cfg.ns]?.[name]?.units?.[unit];
    if (!Array.isArray(entries) || !entries.length) continue;
    const fyEntries = entries.filter(e => cfg.annualForm.includes(e.form) && e.fp === 'FY');
    if (!fyEntries.length) continue;
    fyEntries.sort((a, b) => b.fy - a.fy || b.end.localeCompare(a.end));
    const candidate = fyEntries[0];
    if (!best || candidate.fy > best.fy || (candidate.fy === best.fy && candidate.end > best.end)) {
      best = candidate;
    }
  }
  return best;
}

/** Collect last N fiscal years of annual entries for a concept (default GAAP/10-K). */
function lastNFYEntries(facts: Record<string, unknown>, names: string[], n: number, cfg: FactCfg = GAAP_CFG, unit: string = 'USD'): Map<number, USDEntry> {
  const byFY = new Map<number, USDEntry>();
  for (const name of names) {
    const entries = (facts as Record<string, Record<string, Record<string, Record<string, USDEntry[]>>>>)
      ?.[cfg.ns]?.[name]?.units?.[unit];
    if (!Array.isArray(entries)) continue;
    const fyEntries = entries.filter(e => cfg.annualForm.includes(e.form) && e.fp === 'FY');
    for (const e of fyEntries) {
      const existing = byFY.get(e.fy);
      if (!existing || e.end > existing.end) byFY.set(e.fy, e);
    }
  }
  // Return only the most recent N years
  const sorted = Array.from(byFY.entries()).sort((a, b) => b[0] - a[0]).slice(0, n);
  return new Map(sorted);
}

/** Build quarterly revenue series (last 8 quarters) with Y/Y growth from 10-Q filings.
 *
 *  SEC XBRL 10-Q entries report year-to-date (YTD) cumulative revenue, not single-quarter.
 *  True quarterly = YTD_Q - YTD_Q_prev  (e.g. Q2 = YTD_Q2 - YTD_Q1).
 *  Q4 is derived: Annual (10-K FY) - YTD_Q3.
 */
function buildQuarterlyRevenue(facts: Record<string, unknown>, names: string[], cfg: FactCfg = GAAP_CFG, unit: string = 'USD', fx: number = 1): QuarterlyRevenue[] {
  // key = `${fy}:${fp}` where fp ∈ Q1|Q2|Q3|FY
  const ytdMap = new Map<string, USDEntry>();

  for (const name of names) {
    const entries = (facts as Record<string, Record<string, Record<string, Record<string, USDEntry[]>>>>)
      ?.[cfg.ns]?.[name]?.units?.[unit];
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      const isQ = e.form === cfg.quarterForm && ['Q1', 'Q2', 'Q3'].includes(e.fp);
      const isFY = cfg.annualForm.includes(e.form) && e.fp === 'FY';
      if (!isQ && !isFY) continue;
      const key = `${e.fy}:${e.fp}`;
      const existing = ytdMap.get(key);
      // Prefer later end date; when equal (same fy:fp:end), prefer larger value so
      // we pick the YTD cumulative entry over the single-quarter entry.
      if (!existing || e.end > existing.end || (e.end === existing.end && e.val > existing.val)) {
        ytdMap.set(key, e);
      }
    }
  }

  // For each FY that has data, derive true quarterly values
  const fySet = Array.from(new Set(Array.from(ytdMap.keys()).map(k => parseInt(k.split(':')[0]))));

  // true quarterly map: key = `${fy}:Q1`|`Q2`|`Q3`|`Q4`
  const trueMap = new Map<string, { val: number; end: string; fy: number; fp: string }>();

  for (const fy of fySet) {
    const q1 = ytdMap.get(`${fy}:Q1`);
    const q2 = ytdMap.get(`${fy}:Q2`);
    const q3 = ytdMap.get(`${fy}:Q3`);
    const ann = ytdMap.get(`${fy}:FY`);
    if (q1) trueMap.set(`${fy}:Q1`, { val: q1.val, end: q1.end, fy, fp: 'Q1' });
    if (q2 && q1) trueMap.set(`${fy}:Q2`, { val: q2.val - q1.val, end: q2.end, fy, fp: 'Q2' });
    if (q3 && q2) trueMap.set(`${fy}:Q3`, { val: q3.val - q2.val, end: q3.end, fy, fp: 'Q3' });
    if (ann && q3) trueMap.set(`${fy}:Q4`, { val: ann.val - q3.val, end: ann.end, fy, fp: 'Q4' });
  }

  const fpOrder: Record<string, number> = { Q4: 4, Q3: 3, Q2: 2, Q1: 1 };
  const sorted = Array.from(trueMap.values())
    .filter(e => e.val > 0)
    .sort((a, b) => b.fy !== a.fy ? b.fy - a.fy : (fpOrder[b.fp] ?? 0) - (fpOrder[a.fp] ?? 0))
    .slice(0, 8);

  return sorted.map(e => {
    const prevKey = `${e.fy - 1}:${e.fp}`;
    const prev = trueMap.get(prevKey);
    const yoyPct = prev && prev.val > 0
      ? parseFloat(((e.val - prev.val) / prev.val * 100).toFixed(1))
      : null;
    return {
      label: `${e.fp} FY${e.fy}`,
      fy: e.fy,
      fp: e.fp,
      periodEnd: e.end,
      revenueUSD: e.val * fx,  // 현지통화 → USD
      yoyPct,
    };
  });
}

interface TsEntry { asOfDate: string; reportedValue?: { raw?: number } }

/**
 * Fetch Korean stock financials via Yahoo Finance fundamentals-timeseries API.
 * This endpoint does NOT require a crumb/session cookie, unlike v10/quoteSummary.
 */
async function fetchKoreanFinancials(ticker: string): Promise<LiveFinancials | null> {
  const start = Date.now();
  try {
    const PERIOD_START = 1451606400; // 2016-01-01 unix
    const PERIOD_END   = 1893456000; // 2030-01-01 unix
    const types = [
      'annualTotalRevenue', 'annualOperatingIncome', 'annualNetIncome',
      'quarterlyTotalRevenue', 'quarterlyOperatingIncome',
    ].join(',');
    const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}?type=${types}&period1=${PERIOD_START}&period2=${PERIOD_END}`;
    const res = await fetch(url, {
      headers: YAHOO_HEADERS,
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!res.ok) {
      logger.warn('yahoo.timeseries', 'http_error', { ticker, status: res.status });
      return null;
    }
    const json = await res.json();
    const results: { meta: { type: string[] }; [key: string]: unknown }[] = json.timeseries?.result ?? [];
    if (!results.length) return null;

    const byType = new Map<string, TsEntry[]>();
    for (const r of results) {
      const type = r.meta?.type?.[0];
      if (type) byType.set(type, (r[type] as TsEntry[] | undefined) ?? []);
    }

    const annualRev   = byType.get('annualTotalRevenue')    ?? [];
    const annualOpInc = byType.get('annualOperatingIncome') ?? [];
    const annualNet   = byType.get('annualNetIncome')       ?? [];
    const qtrRev      = byType.get('quarterlyTotalRevenue') ?? [];

    const toUSD = (v: number | null | undefined): number | null =>
      v == null ? null : parseFloat((v * KRW_USD).toFixed(2));

    // Build annual records (last 5 years, sorted desc by date)
    const annuals: AnnualFinancials[] = annualRev.slice().reverse().slice(0, 5).map((e) => {
      const fy = parseInt(e.asOfDate.slice(0, 4), 10);
      const rev = e.reportedValue?.raw ?? null;
      const opInc = annualOpInc.find(x => x.asOfDate === e.asOfDate)?.reportedValue?.raw ?? null;
      const netInc = annualNet.find(x => x.asOfDate === e.asOfDate)?.reportedValue?.raw ?? null;
      const opMargin = rev && opInc != null ? parseFloat(((opInc / rev) * 100).toFixed(1)) : null;
      return {
        fy,
        periodEnd: e.asOfDate,
        revenueUSD: toUSD(rev),
        operatingIncomeUSD: toUSD(opInc),
        netIncomeUSD: toUSD(netInc),
        epsDiluted: null,
        totalAssetsUSD: null, totalLiabilitiesUSD: null, equityUSD: null,
        operatingCFUSD: null, investingCFUSD: null, financingCFUSD: null,
        rdExpenseUSD: null, capexUSD: null, buybacksUSD: null, dividendsUSD: null,
        operatingMarginPct: opMargin,
        roePct: null, roaPct: null, debtRatioPct: null,
      };
    }).sort((a, b) => b.fy - a.fy);

    // Build quarterly revenue with YoY (last 8 quarters, sorted desc)
    const qtrSorted = qtrRev.slice().reverse().slice(0, 8);
    const quarterlyRevenue: QuarterlyRevenue[] = qtrSorted.map((e) => {
      const fy = parseInt(e.asOfDate.slice(0, 4), 10);
      const month = parseInt(e.asOfDate.slice(5, 7), 10);
      const fp = month <= 3 ? 'Q1' : month <= 6 ? 'Q2' : month <= 9 ? 'Q3' : 'Q4';
      const rev = e.reportedValue?.raw ?? null;
      const revUSD = toUSD(rev) ?? 0;
      // Find same quarter prior year
      const prevYear = `${fy - 1}${e.asOfDate.slice(4)}`;
      const prevE = qtrRev.find(x => x.asOfDate === prevYear);
      const prevRev = prevE?.reportedValue?.raw ?? null;
      const yoyPct = prevRev && rev ? parseFloat(((rev - prevRev) / prevRev * 100).toFixed(1)) : null;
      return { label: `${fp} FY${fy}`, fy, fp, periodEnd: e.asOfDate, revenueUSD: revUSD, yoyPct };
    }).filter(q => q.revenueUSD > 0).sort((a, b) => b.fy !== a.fy ? b.fy - a.fy : b.fp.localeCompare(a.fp));

    const latestAnnual = annuals[0] ?? null;

    logger.info('yahoo.timeseries', 'fetched', {
      ticker, fy: latestAnnual?.fy, annuals: annuals.length, quarters: quarterlyRevenue.length, durationMs: Date.now() - start,
    });

    return {
      ticker: ticker.toUpperCase(),
      cik: '',
      companyName: ticker,
      fiscalYear: latestAnnual?.fy ?? new Date().getFullYear(),
      fiscalPeriod: 'FY',
      periodEnd: latestAnnual?.periodEnd ?? '',
      revenueUSD: latestAnnual?.revenueUSD ?? 0,
      revenueFormatted: formatUsd(latestAnnual?.revenueUSD ?? null),
      source: 'Yahoo Finance timeseries',
      fetchedAt: new Date().toISOString(),
      annuals,
      latestAnnual,
      quarterlyRevenue,
    };
  } catch (err) {
    logger.error('yahoo.timeseries', 'fetch_failed', { ticker, error: err, durationMs: Date.now() - start });
    return null;
  }
}

/** Fetch latest fiscal-year financials for a given ticker (single XBRL call). */
export async function fetchLiveFinancials(ticker: string): Promise<LiveFinancials | null> {
  // Korean stocks (.KS) are not on SEC EDGAR — use Yahoo Finance quoteSummary instead
  if (ticker.toUpperCase().endsWith('.KS')) {
    return fetchKoreanFinancials(ticker);
  }
  const start = Date.now();
  try {
    const tm = await loadTickerMap();
    const rec = tm.get(ticker.toUpperCase());
    if (!rec) {
      logger.warn('sec.financials', 'ticker_not_found', { ticker });
      return null;
    }

    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${rec.cik}.json`;
    const res = await fetch(url, {
      headers: SEC_HEADERS,
      signal: AbortSignal.timeout(20000),
      next: { revalidate: 43200 },
    });
    if (!res.ok) {
      logger.warn('sec.financials', 'facts_http_error', { ticker, status: res.status, durationMs: Date.now() - start });
      return null;
    }
    const json = await res.json();
    const facts = json.facts ?? {};

    // Revenue — pick most recent across all concept variants.
    // 1차: us-gaap / 10-K (US 종목). 2차: ifrs-full / 20-F (외국 ADR, 예: TSM).
    let cfg = GAAP_CFG;
    let curr = detectCurrency(facts, cfg);  // USD(US) 또는 EUR/GBP/DKK(외국 us-gaap 발행사 ASML 등)
    let revFYs = lastNFYEntries(facts, cfg.concepts.revenue, 5, cfg, curr);
    let latestRevEntry = bestFYEntry(facts, cfg.concepts.revenue, cfg, curr);
    if (!latestRevEntry) {
      // foreign private issuer fallback — IFRS taxonomy + 20-F filings
      cfg = IFRS_CFG;
      curr = detectCurrency(facts, cfg);
      revFYs = lastNFYEntries(facts, cfg.concepts.revenue, 5, cfg, curr);
      latestRevEntry = bestFYEntry(facts, cfg.concepts.revenue, cfg, curr);
      if (latestRevEntry) logger.info('sec.financials', 'ifrs_fallback', { ticker, curr });
    }
    const { rates: fxRates } = curr !== 'USD' ? await getFxRates() : { rates: FX_TO_USD };
    const fx = fxRates[curr] ?? FX_TO_USD[curr] ?? 1;  // 라이브 FRED 환율(실패 시 정적 fallback)
    const quarterlyRevenue = buildQuarterlyRevenue(facts, cfg.concepts.revenue, cfg, curr, fx);

    if (!latestRevEntry) {
      logger.warn('sec.financials', 'no_revenue_entry', { ticker, durationMs: Date.now() - start });
      return null;
    }

    const C = cfg.concepts;
    // All other concepts — latest FY entry only (we'll align to revFYs below)
    const opIncEntry = bestFYEntry(facts, C.opIncome, cfg);
    const netIncEntry = bestFYEntry(facts, C.netIncome, cfg);
    const epsEntry = bestFYEntry(facts, C.eps, cfg, 'USD/shares');
    const assetsEntry = bestFYEntry(facts, C.assets, cfg);
    const liabEntry = bestFYEntry(facts, C.liabilities, cfg);
    const equityEntry = bestFYEntry(facts, C.equity, cfg);
    const opCFEntry = bestFYEntry(facts, C.opCF, cfg);
    const invCFEntry = bestFYEntry(facts, C.invCF, cfg);
    const finCFEntry = bestFYEntry(facts, C.finCF, cfg);
    const rdEntry = bestFYEntry(facts, C.rd, cfg);
    const capexEntry = bestFYEntry(facts, C.capex, cfg);
    const buybackEntry = bestFYEntry(facts, C.buyback, cfg);
    const divEntry = bestFYEntry(facts, C.dividends, cfg);

    // Build annual time series for last 5 years
    const targetFYs = Array.from(revFYs.keys()).sort((a, b) => b - a);

    // 2026-06-03: unit 파라미터 추가 — EPS 는 SEC XBRL 에서 'USD/shares' unit (USD 아님).
    //   이전엔 .units.USD 하드코딩이라 epsDiluted 항상 null → 모든 US 페이지 EPS '-' + P/E null.
    // unit 미지정 시 보고통화(curr)로 읽고 fx 로 USD 환산. EPS 는 `${curr}/shares` 명시.
    const getValForFY = (concepts: string[], fy: number, unitOverride?: string): number | null => {
      const unit = unitOverride ?? curr;
      for (const name of concepts) {
        const entries = (facts as Record<string, Record<string, Record<string, Record<string, USDEntry[]>>>>)
          ?.[cfg.ns]?.[name]?.units?.[unit];
        if (!Array.isArray(entries)) continue;
        const fyEntries = entries.filter(e => cfg.annualForm.includes(e.form) && e.fp === 'FY' && e.fy === fy);
        if (!fyEntries.length) continue;
        fyEntries.sort((a, b) => b.end.localeCompare(a.end));
        return fyEntries[0].val * fx;  // 현지통화 → USD
      }
      return null;
    };

    const annuals: AnnualFinancials[] = targetFYs.map(fy => {
      const rev = getValForFY(C.revenue, fy);
      const opInc = getValForFY(C.opIncome, fy);
      const netInc = getValForFY(C.netIncome, fy);
      const equity = getValForFY(C.equity, fy);
      const assets = getValForFY(C.assets, fy);
      const liab = getValForFY(C.liabilities, fy);
      const periodEnd = revFYs.get(fy)?.end ?? '';

      const opMargin = rev && opInc != null ? (opInc / rev) * 100 : null;
      const roe = equity && equity > 0 && netInc != null ? (netInc / equity) * 100 : null;
      const roa = assets && assets > 0 && netInc != null ? (netInc / assets) * 100 : null;
      const debtRatio = assets && assets > 0 && liab != null ? (liab / assets) * 100 : null;

      return {
        fy,
        periodEnd,
        revenueUSD: rev,
        operatingIncomeUSD: opInc,
        netIncomeUSD: netInc,
        epsDiluted: getValForFY(C.eps, fy, `${curr}/shares`),
        totalAssetsUSD: assets,
        totalLiabilitiesUSD: liab,
        equityUSD: equity,
        operatingCFUSD: getValForFY(C.opCF, fy),
        investingCFUSD: getValForFY(C.invCF, fy),
        financingCFUSD: getValForFY(C.finCF, fy),
        rdExpenseUSD: getValForFY(C.rd, fy),
        capexUSD: getValForFY(C.capex, fy),
        buybacksUSD: getValForFY(C.buyback, fy),
        dividendsUSD: getValForFY(C.dividends, fy),
        operatingMarginPct: opMargin != null ? parseFloat(opMargin.toFixed(1)) : null,
        roePct: roe != null ? parseFloat(roe.toFixed(1)) : null,
        roaPct: roa != null ? parseFloat(roa.toFixed(1)) : null,
        debtRatioPct: debtRatio != null ? parseFloat(debtRatio.toFixed(1)) : null,
      };
    });

    const latestAnnual = annuals[0] ?? null;
    const latestRev = latestRevEntry;

    // Supplement missing latest-only fields from their own bestFYEntry if the annual build missed them
    if (latestAnnual) {
      if (latestAnnual.epsDiluted == null && epsEntry) latestAnnual.epsDiluted = epsEntry.val;
      if (latestAnnual.operatingCFUSD == null && opCFEntry) latestAnnual.operatingCFUSD = opCFEntry.val;
      if (latestAnnual.investingCFUSD == null && invCFEntry) latestAnnual.investingCFUSD = invCFEntry.val;
      if (latestAnnual.financingCFUSD == null && finCFEntry) latestAnnual.financingCFUSD = finCFEntry.val;
      if (latestAnnual.rdExpenseUSD == null && rdEntry) latestAnnual.rdExpenseUSD = rdEntry.val;
      if (latestAnnual.capexUSD == null && capexEntry) latestAnnual.capexUSD = capexEntry.val;
      if (latestAnnual.buybacksUSD == null && buybackEntry) latestAnnual.buybacksUSD = buybackEntry.val;
      if (latestAnnual.dividendsUSD == null && divEntry) latestAnnual.dividendsUSD = divEntry.val;
    }

    logger.info('sec.financials', 'fetched', {
      ticker,
      fy: latestRev.fy,
      revenue: latestRev.val,
      annualYears: annuals.length,
      durationMs: Date.now() - start,
    });

    return {
      ticker: ticker.toUpperCase(),
      cik: rec.cik,
      companyName: rec.title,
      fiscalYear: latestRev.fy,
      fiscalPeriod: latestRev.fp,
      periodEnd: latestRev.end,
      revenueUSD: latestRev.val * fx,           // 현지통화 → USD
      revenueFormatted: formatUsd(latestRev.val * fx),
      source: `SEC EDGAR XBRL ${cfg.annualForm.join('/')}${curr !== 'USD' ? ` (${curr}→USD)` : ''}`,
      fetchedAt: new Date().toISOString(),
      annuals,
      latestAnnual,
      quarterlyRevenue,
    };
  } catch (err) {
    logger.error('sec.financials', 'fetch_failed', { ticker, error: err, durationMs: Date.now() - start });
    return null;
  }
}
