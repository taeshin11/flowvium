/**
 * GET /api/company-filing/[ticker]
 *
 * 사업보고서 본문 섹션(DART 사업보고서 / SEC 10-K)을 DB(filings)에서 반환.
 *   ingest-filings.mjs 가 보고서 신규 발행 시 적재(사용자 "사업보고서 뜰때마다 db에 본문 저장").
 *   심판/매수/매도 심층챗 grounding + company page 가 사업의 내용·제품vs상품 매출·연구개발·전망 표시용.
 *   읽기전용 SQLite (cron checkout wipe 안전 — data/flowvium.db 는 untracked runtime).
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolve } from 'path';
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';

interface FilingRow {
  ticker: string; market: string; filing_id: string; form: string | null; report_nm: string | null;
  filed_date: string | null; overview: string | null; products: string | null; sales_mix: string | null;
  rnd: string | null; risk: string | null; mdna: string | null; resale_ratio: number | null;
  source: string; fetched_at: string;
}

function lookup(ticker: string): FilingRow | null {
  const t = ticker.toUpperCase();
  const cands = [t, t.replace(/\.(KS|KQ)$/, ''), `${t}.KS`, `${t}.KQ`];
  let db: Database.Database | null = null;
  try {
    db = new Database(resolve(process.cwd(), 'data/flowvium.db'), { readonly: true, fileMustExist: true });
    const stmt = db.prepare('SELECT * FROM filings WHERE ticker = ? ORDER BY filed_date DESC LIMIT 1');
    for (const c of cands) { const r = stmt.get(c) as FilingRow | undefined; if (r) return r; }
    return null;
  } catch { return null; }
  finally { try { db?.close(); } catch { /* */ } }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const r = lookup(ticker || '');
  if (!r) return NextResponse.json({ ticker, filing: null, source: 'none' });
  return NextResponse.json({
    ticker: r.ticker,
    filing: {
      form: r.form, reportNm: r.report_nm, filedDate: r.filed_date, market: r.market,
      overview: r.overview, products: r.products, salesMix: r.sales_mix, rnd: r.rnd,
      risk: r.risk, mdna: r.mdna, resaleRatio: r.resale_ratio, fetchedAt: r.fetched_at,
    },
    source: r.source,
  });
}
