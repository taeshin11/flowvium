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
import { execFile } from 'child_process';
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';

// 미적재 종목 on-demand 적재 — 심층챗이 커서순회 전의 종목을 물어도 본문이 비지 않게(2026-06-18 기아 사건).
//   같은 ticker 중복 spawn 방지(in-flight). ingest-filings.mjs 가 DART/SEC 받아 filings DB 에 저장.
const inflight = new Map<string, Promise<void>>();
function ingestNow(ticker: string): Promise<void> {
  const key = ticker.toUpperCase();
  const ex = inflight.get(key);
  if (ex) return ex;
  const p = new Promise<void>((res) => {
    execFile(process.execPath, ['scripts/ingest-filings.mjs', `--tickers=${ticker}`],
      { cwd: process.cwd(), timeout: 30000, windowsHide: true },
      () => res());
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

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

export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  let r = lookup(ticker || '');
  // DB miss + ondemand=1(심층챗) → 즉시 적재 후 재조회. 일반 호출은 적재 트리거 안 함(가벼운 호출 보호).
  if (!r && new URL(req.url).searchParams.get('ondemand') === '1' && /^[A-Za-z0-9.]{1,10}$/.test(ticker || '')) {
    try { await ingestNow(ticker); r = lookup(ticker); } catch { /* 적재 실패 시 null 반환 */ }
  }
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
