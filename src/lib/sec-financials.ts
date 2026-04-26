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

/** Pick best entry for a concept across all possible GAAP names.
 *  Collects latest FY 10-K entry from each candidate name and returns the most recent. */
function bestFYEntry(facts: Record<string, unknown>, names: string[]): USDEntry | null {
  let best: USDEntry | null = null;
  for (const name of names) {
    const entries = (facts as Record<string, Record<string, Record<string, Record<string, USDEntry[]>>>>)
      ?.['us-gaap']?.[name]?.units?.USD;
    if (!Array.isArray(entries) || !entries.length) continue;
    const fyEntries = entries.filter(e => e.form === '10-K' && e.fp === 'FY');
    if (!fyEntries.length) continue;
    fyEntries.sort((a, b) => b.fy - a.fy || b.end.localeCompare(a.end));
    const candidate = fyEntries[0];
    if (!best || candidate.fy > best.fy || (candidate.fy === best.fy && candidate.end > best.end)) {
      best = candidate;
    }
  }
  return best;
}

/** Collect last N fiscal years of annual 10-K entries for a concept. */
function lastNFYEntries(facts: Record<string, unknown>, names: string[], n: number): Map<number, USDEntry> {
  const byFY = new Map<number, USDEntry>();
  for (const name of names) {
    const entries = (facts as Record<string, Record<string, Record<string, Record<string, USDEntry[]>>>>)
      ?.['us-gaap']?.[name]?.units?.USD;
    if (!Array.isArray(entries)) continue;
    const fyEntries = entries.filter(e => e.form === '10-K' && e.fp === 'FY');
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
function buildQuarterlyRevenue(facts: Record<string, unknown>, names: string[]): QuarterlyRevenue[] {
  // key = `${fy}:${fp}` where fp ∈ Q1|Q2|Q3|FY
  const ytdMap = new Map<string, USDEntry>();

  for (const name of names) {
    const entries = (facts as Record<string, Record<string, Record<string, Record<string, USDEntry[]>>>>)
      ?.['us-gaap']?.[name]?.units?.USD;
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      const isQ = e.form === '10-Q' && ['Q1', 'Q2', 'Q3'].includes(e.fp);
      const isFY = e.form === '10-K' && e.fp === 'FY';
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
      revenueUSD: e.val,
      yoyPct,
    };
  });
}

/** Fetch latest fiscal-year financials for a given ticker (single XBRL call). */
export async function fetchLiveFinancials(ticker: string): Promise<LiveFinancials | null> {
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
    // RevenuesNetOfInterestExpense covers banks (JPM, BAC, C, WFC) which don't
    // report under the standard Revenues concept for 10-Q quarterly filings.
    const REV_CONCEPTS = [
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'SalesRevenueNet',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'RevenuesNetOfInterestExpense',
    ];
    const revFYs = lastNFYEntries(facts, REV_CONCEPTS, 5);
    const latestRevEntry = bestFYEntry(facts, REV_CONCEPTS);
    const quarterlyRevenue = buildQuarterlyRevenue(facts, REV_CONCEPTS);

    if (!latestRevEntry) {
      logger.warn('sec.financials', 'no_revenue_entry', { ticker, durationMs: Date.now() - start });
      return null;
    }

    // All other concepts — latest FY entry only (we'll align to revFYs below)
    const opIncEntry = bestFYEntry(facts, ['OperatingIncomeLoss']);
    const netIncEntry = bestFYEntry(facts, ['NetIncomeLoss']);
    const epsEntry = bestFYEntry(facts, ['EarningsPerShareDiluted']);
    const assetsEntry = bestFYEntry(facts, ['Assets']);
    const liabEntry = bestFYEntry(facts, ['Liabilities']);
    const equityEntry = bestFYEntry(facts, [
      'StockholdersEquity',
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    ]);
    const opCFEntry = bestFYEntry(facts, ['NetCashProvidedByUsedInOperatingActivities']);
    const invCFEntry = bestFYEntry(facts, ['NetCashProvidedByUsedInInvestingActivities']);
    const finCFEntry = bestFYEntry(facts, ['NetCashProvidedByUsedInFinancingActivities']);
    const rdEntry = bestFYEntry(facts, ['ResearchAndDevelopmentExpense']);
    const capexEntry = bestFYEntry(facts, ['PaymentsToAcquirePropertyPlantAndEquipment']);
    const buybackEntry = bestFYEntry(facts, ['PaymentsForRepurchaseOfCommonStock']);
    const divEntry = bestFYEntry(facts, ['PaymentsOfDividends']);

    // Build annual time series for last 5 years
    const targetFYs = Array.from(revFYs.keys()).sort((a, b) => b - a);

    const getValForFY = (concepts: string[], fy: number): number | null => {
      for (const name of concepts) {
        const entries = (facts as Record<string, Record<string, Record<string, Record<string, USDEntry[]>>>>)
          ?.['us-gaap']?.[name]?.units?.USD;
        if (!Array.isArray(entries)) continue;
        const fyEntries = entries.filter(e => e.form === '10-K' && e.fp === 'FY' && e.fy === fy);
        if (!fyEntries.length) continue;
        fyEntries.sort((a, b) => b.end.localeCompare(a.end));
        return fyEntries[0].val;
      }
      return null;
    };

    const annuals: AnnualFinancials[] = targetFYs.map(fy => {
      const rev = getValForFY(REV_CONCEPTS, fy);
      const opInc = getValForFY(['OperatingIncomeLoss'], fy);
      const netInc = getValForFY(['NetIncomeLoss'], fy);
      const equity = getValForFY(['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'], fy);
      const assets = getValForFY(['Assets'], fy);
      const liab = getValForFY(['Liabilities'], fy);
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
        epsDiluted: getValForFY(['EarningsPerShareDiluted'], fy),
        totalAssetsUSD: assets,
        totalLiabilitiesUSD: liab,
        equityUSD: equity,
        operatingCFUSD: getValForFY(['NetCashProvidedByUsedInOperatingActivities'], fy),
        investingCFUSD: getValForFY(['NetCashProvidedByUsedInInvestingActivities'], fy),
        financingCFUSD: getValForFY(['NetCashProvidedByUsedInFinancingActivities'], fy),
        rdExpenseUSD: getValForFY(['ResearchAndDevelopmentExpense'], fy),
        capexUSD: getValForFY(['PaymentsToAcquirePropertyPlantAndEquipment'], fy),
        buybacksUSD: getValForFY(['PaymentsForRepurchaseOfCommonStock'], fy),
        dividendsUSD: getValForFY(['PaymentsOfDividends'], fy),
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
      revenueUSD: latestRev.val,
      revenueFormatted: formatUsd(latestRev.val),
      source: 'SEC EDGAR XBRL 10-K',
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
