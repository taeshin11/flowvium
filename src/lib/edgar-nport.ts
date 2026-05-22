/**
 * src/lib/edgar-nport.ts
 *
 * Form N-PORT-P — mutual fund monthly portfolio holdings. Funds must file
 * within 60 days of month-end, so N-PORT is ~3× faster than 13F (quarterly,
 * 45-day delay). Each filing lists every security the fund holds with share
 * count, USD value, and percent of NAV.
 *
 * Usage pattern: walk the public getcurrent RSS for recent NPORT-P filings,
 * parse each fund's primary_doc.xml, filter to our tracked CUSIPs, and surface
 * which mutual funds are holding / adding to our tickers with the freshest
 * possible lag.
 *
 * Notes:
 *   - N-PORT XML uses namespaced elements (xmlns="...nport"). Regex parsing
 *     ignores namespaces since we only match element names.
 *   - A single filing can have 500+ invstOrSec entries. We keep only those
 *     whose CUSIP maps to our tracked tickers to cap response size.
 */

import { EDGAR_UA, CUSIP_TO_TICKER } from './edgar-13f';
import { logger } from './logger';

const EDGAR_BASE = 'https://www.sec.gov';
const EDGAR_HEADERS = { 'User-Agent': EDGAR_UA, 'Accept': 'application/xml,text/html' };

async function pacedFetch(url: string, timeoutMs = 10000): Promise<Response> {
  return fetch(url, { headers: EDGAR_HEADERS, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
}

function m1(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

export interface NPortHolding {
  ticker: string;
  cusip: string;
  securityName: string;
  shares: number | null;
  valueUsd: number | null;
  pctOfNav: number | null;
}

export interface NPortFundSnapshot {
  accession: string;
  filedAt: string;           // ISO
  reportPeriodEnd: string;   // YYYY-MM-DD (repPdDate)
  seriesName: string;        // "Fidelity Contrafund"
  regName: string;           // registrant (fund family, e.g. "Fidelity")
  totalNetAssets: number | null;
  holdings: NPortHolding[];  // only tracked-CUSIP holdings
  filingUrl: string;
}

interface AtomEntry {
  link: string;
  accession: string;
  accessionPath: string;
  cik: string;
  filedDate: string;
}

function parseAtomFeed(xml: string): AtomEntry[] {
  const entries: AtomEntry[] = [];
  for (const p of xml.split(/<entry>/g).slice(1)) {
    const block = p.split(/<\/entry>/)[0];
    const link = m1(block, /<link[^>]+href="([^"]+)"/) ?? '';
    const accMatch = block.match(/accession-number=([0-9-]+)/);
    const filedMatch = block.match(/Filed:<\/b>\s*([0-9-]+)/);
    const cikMatch = link.match(/\/data\/(\d+)\//);
    if (!accMatch || !link) continue;
    entries.push({
      link,
      accession: accMatch[1],
      accessionPath: accMatch[1].replace(/-/g, ''),
      cik: cikMatch ? cikMatch[1] : '',
      filedDate: filedMatch ? filedMatch[1] : '',
    });
  }
  return entries;
}

function parseNPortXml(xml: string, meta: { accession: string; filingUrl: string; filedAt: string }): NPortFundSnapshot {
  const seriesName = m1(xml, /<seriesName>([^<]+)<\/seriesName>/) ?? '';
  const regName = m1(xml, /<regName>([^<]+)<\/regName>/) ?? '';
  const reportPeriodEnd = m1(xml, /<repPdDate>([^<]+)<\/repPdDate>/) ?? '';
  const totNet = Number(m1(xml, /<netAssets>([0-9.]+)<\/netAssets>/) ?? '');

  const holdings: NPortHolding[] = [];
  // Stream-parse invstOrSec blocks. Regex is ok because N-PORT XML blocks
  // don't nest within themselves.
  const matches = Array.from(xml.matchAll(/<invstOrSec>([\s\S]*?)<\/invstOrSec>/g));
  for (const m of matches) {
    const b = m[1];
    const cusip = m1(b, /<cusip>([^<]+)<\/cusip>/) ?? '';
    const ticker = CUSIP_TO_TICKER[cusip];
    if (!ticker) continue;   // skip non-tracked securities
    const name = m1(b, /<name>([^<]+)<\/name>/) ?? '';
    const balance = Number(m1(b, /<balance>([0-9.-]+)<\/balance>/) ?? '');
    const valueUsd = Number(m1(b, /<valUSD>([0-9.-]+)<\/valUSD>/) ?? '');
    const pct = Number(m1(b, /<pctVal>([0-9.-]+)<\/pctVal>/) ?? '');
    holdings.push({
      ticker,
      cusip,
      securityName: name,
      shares: Number.isFinite(balance) ? balance : null,
      valueUsd: Number.isFinite(valueUsd) ? valueUsd : null,
      pctOfNav: Number.isFinite(pct) ? pct : null,
    });
  }

  return {
    accession: meta.accession,
    filedAt: meta.filedAt,
    reportPeriodEnd,
    seriesName,
    regName,
    totalNetAssets: Number.isFinite(totNet) ? totNet : null,
    holdings,
    filingUrl: meta.filingUrl,
  };
}

/**
 * Fetch and parse N most recent NPORT-P filings, return each fund's snapshot
 * filtered to our tracked tickers. Funds with zero tracked holdings are omitted.
 *
 * feedCount: number of RSS entries to walk (default 20 — each ~100-500KB XML).
 */
export async function fetchRecentNPORT(opts: { feedCount?: number } = {}): Promise<NPortFundSnapshot[]> {
  const feedCount = opts.feedCount ?? 20;
  const runStart = Date.now();
  try {
    // 1) getcurrent (최근 10분) — N-PORT 분기 filing이라 자주 empty
    const rssRes = await pacedFetch(
      `${EDGAR_BASE}/cgi-bin/browse-edgar?action=getcurrent&type=NPORT-P&count=${feedCount}&output=atom`
    );
    let entries: AtomEntry[] = [];
    if (rssRes.ok) entries = parseAtomFeed(await rssRes.text());

    // 2) Fallback: EFTS search (최근 14일) — N-PORT 분기 filing이라 윈도우 길게
    if (!entries.length) {
      const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      try {
        const efts = await pacedFetch(`https://efts.sec.gov/LATEST/search-index?forms=NPORT-P&dateRange=custom&startdt=${twoWeeksAgo}&enddt=${today}`, 10000);
        if (efts.ok) {
          const data = await efts.json() as { hits?: { hits?: Array<{ _source?: { display_names?: string[]; file_date?: string; ciks?: string[] }; _id?: string }> } };
          const hits = data?.hits?.hits ?? [];
          entries = hits.slice(0, feedCount).map(hit => {
            const src = hit._source;
            const accession = hit._id?.split(':')[0] ?? '';
            const cik = src?.ciks?.[0] ?? '';
            const accessionPath = accession.replace(/-/g, '');
            return {
              title: src?.display_names?.[0] ?? '',
              link: `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionPath}/${accession}-index.htm`,
              accession, accessionPath, cik,
              updatedAt: src?.file_date ?? today, filedDate: src?.file_date ?? today,
            };
          }).filter(e => e.accession && e.cik);
          logger.info('edgar.nport', 'efts_fallback', { entries: entries.length });
        }
      } catch (e) { logger.warn('edgar.nport', 'efts_fallback_failed', { error: String(e).slice(0, 100) }); }
    }

    if (!entries.length) {
      logger.warn('edgar.nport', 'empty_feed');
      return [];
    }

    // Dedupe accessions (RSS duplicates Filer entries)
    const seen = new Set<string>();
    const unique = entries.filter(e => {
      if (seen.has(e.accession)) return false;
      seen.add(e.accession);
      return true;
    });

    // Fetch primary_doc.xml for each in batches of 4 (XML can be large)
    const snapshots: NPortFundSnapshot[] = [];
    const BATCH = 4;
    let failedCount = 0;
    let emptyCount = 0;
    for (let i = 0; i < unique.length; i += BATCH) {
      const slice = unique.slice(i, i + BATCH);
      const parsed = await Promise.allSettled(slice.map(async e => {
        const xmlUrl = `${EDGAR_BASE}/Archives/edgar/data/${e.cik}/${e.accessionPath}/primary_doc.xml`;
        const res = await pacedFetch(xmlUrl, 12000);
        if (!res.ok) {
          logger.warn('edgar.nport', 'xml_http_error', { accession: e.accession, status: res.status });
          return null;
        }
        const xml = await res.text();
        const filedAt = e.filedDate ? new Date(e.filedDate).toISOString() : new Date().toISOString();
        try {
          return parseNPortXml(xml, { accession: e.accession, filingUrl: e.link, filedAt });
        } catch (err) {
          logger.error('edgar.nport', 'parse_exception', { accession: e.accession, error: err });
          return null;
        }
      }));
      for (const r of parsed) {
        if (r.status === 'rejected') { failedCount++; continue; }
        if (r.value && r.value.holdings.length > 0) snapshots.push(r.value);
        else if (r.value) emptyCount++;
      }
    }

    logger.info('edgar.nport', 'run_complete', {
      durationMs: Date.now() - runStart,
      feedEntries: entries.length,
      uniqueFilings: unique.length,
      snapshotsWithTracked: snapshots.length,
      snapshotsEmpty: emptyCount,
      failedFilings: failedCount,
    });

    // Sort newest first
    return snapshots.sort((a, b) => (b.filedAt || '').localeCompare(a.filedAt || ''));
  } catch (err) {
    logger.error('edgar.nport', 'run_exception', { error: err, durationMs: Date.now() - runStart });
    return [];
  }
}

/**
 * Aggregate: for each tracked ticker, list the mutual funds currently holding
 * it across recent N-PORT filings. Useful for showing "who owns NVDA right now
 * according to the freshest mutual-fund disclosures."
 */
export interface NPortTickerAggregate {
  ticker: string;
  totalValueUsd: number;
  totalShares: number;
  funds: Array<{
    fund: string;            // seriesName
    family: string;          // regName
    valueUsd: number | null;
    shares: number | null;
    pctOfNav: number | null;
    reportPeriodEnd: string;
    filingUrl: string;
  }>;
}

export function aggregateByTicker(snapshots: NPortFundSnapshot[]): NPortTickerAggregate[] {
  const byTicker = new Map<string, NPortTickerAggregate>();
  for (const snap of snapshots) {
    for (const h of snap.holdings) {
      const ent = byTicker.get(h.ticker) ?? {
        ticker: h.ticker,
        totalValueUsd: 0,
        totalShares: 0,
        funds: [],
      };
      ent.totalValueUsd += h.valueUsd ?? 0;
      ent.totalShares += h.shares ?? 0;
      ent.funds.push({
        fund: snap.seriesName,
        family: snap.regName,
        valueUsd: h.valueUsd,
        shares: h.shares,
        pctOfNav: h.pctOfNav,
        reportPeriodEnd: snap.reportPeriodEnd,
        filingUrl: snap.filingUrl,
      });
      byTicker.set(h.ticker, ent);
    }
  }
  // Sort each ticker's funds by value desc, and entries by total value desc
  const arr = Array.from(byTicker.values());
  arr.forEach(a => a.funds.sort((x, y) => (y.valueUsd ?? 0) - (x.valueUsd ?? 0)));
  arr.sort((a, b) => b.totalValueUsd - a.totalValueUsd);
  return arr;
}
