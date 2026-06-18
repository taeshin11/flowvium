#!/usr/bin/env node
// ingest-filings.mjs — 사업보고서 본문을 DB(filings)에 적재 (2026-06-18 사용자 "사업보고서 뜰때마다 db에 본문 저장").
//   KR(.KS/.KQ) → DART 사업/분기보고서 document.xml,  US → SEC 10-K/10-Q primary doc.
//   새 filing_id 만 다운로드(이미 저장분 skip) → 본문 4개 섹션 파싱 → saveFiling.
//   사용:
//     node scripts/ingest-filings.mjs --tickers=080220.KQ,NVDA   # 지정 종목(온디맨드)
//     node scripts/ingest-filings.mjs --limit=40                 # 후보풀 순회(커서 회전)
//     node scripts/ingest-filings.mjs --portfolio                # 최신 보고서 portfolio 우선
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveFiling, hasFiling, openDb } from './lib/db.mjs';
import {
  dartLatestReport, dartDocumentXml, parseDartReport, computeResaleRatio,
  secLatestFiling, parseSecFiling,
} from './lib/filing-parse.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CURSOR = resolve(ROOT, 'logs/filings-cursor.json');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isKr = (t) => /\.(KS|KQ)$/i.test(t);

const corpMap = JSON.parse(readFileSync(resolve(ROOT, 'data/dart-corp-codes.json'), 'utf8')).map;
function corpCodeFor(t) { return corpMap[t.replace(/\.(KS|KQ)$/i, '').trim()]?.corpCode ?? null; }

function candidateTickers() {
  try {
    const j = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'));
    return Array.isArray(j) ? j : (j.tickers ?? Object.keys(j.meta ?? {}));
  } catch { return []; }
}

async function ingestOne(ticker) {
  try {
    if (isKr(ticker)) {
      const corp = corpCodeFor(ticker);
      if (!corp) return { ticker, status: 'no_corp' };
      const meta = await dartLatestReport(corp);
      if (!meta) return { ticker, status: 'no_report' };
      if (hasFiling(ticker, meta.rceptNo)) return { ticker, status: 'cached', filingId: meta.rceptNo };
      const xml = await dartDocumentXml(meta.rceptNo);
      if (!xml) return { ticker, status: 'no_doc' };
      const p = parseDartReport(xml);
      const resaleRatio = computeResaleRatio(p.salesMix);
      saveFiling({ ticker, market: 'kr', filingId: meta.rceptNo, form: meta.reportNm, reportNm: meta.reportNm,
        filedDate: meta.rceptDt, ...p, resaleRatio, source: 'dart' });
      return { ticker, status: 'saved', filingId: meta.rceptNo, resaleRatio };
    }
    // US
    const f = await secLatestFiling(ticker);
    if (!f) return { ticker, status: 'no_report' };
    if (hasFiling(ticker, f.filingId)) return { ticker, status: 'cached', filingId: f.filingId };
    const p = parseSecFiling(f.html);
    saveFiling({ ticker, market: 'us', filingId: f.filingId, form: f.form, reportNm: f.reportNm,
      filedDate: f.filedDate, ...p, resaleRatio: null, source: 'sec' });
    return { ticker, status: 'saved', filingId: f.filingId };
  } catch (e) { return { ticker, status: 'error', error: String(e?.message ?? e).slice(0, 80) }; }
}

async function main() {
  openDb();
  let tickers;
  if (args.tickers) tickers = String(args.tickers).split(',').map((s) => s.trim()).filter(Boolean);
  else {
    const all = candidateTickers();
    const limit = Number(args.limit ?? 40);
    let cursor = 0;
    if (existsSync(CURSOR)) { try { cursor = JSON.parse(readFileSync(CURSOR, 'utf8')).cursor ?? 0; } catch { /* */ } }
    tickers = [];
    for (let i = 0; i < limit && i < all.length; i++) tickers.push(all[(cursor + i) % all.length]);
    const next = (cursor + limit) % Math.max(1, all.length);
    writeFileSync(CURSOR, JSON.stringify({ cursor: next, total: all.length, updatedAt: new Date().toISOString() }));
  }

  const counts = { saved: 0, cached: 0, no_corp: 0, no_report: 0, no_doc: 0, error: 0 };
  for (const t of tickers) {
    const r = await ingestOne(t);
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (r.status === 'saved') console.log(`✓ ${t} ← ${r.filingId}${r.resaleRatio != null ? ` (되팔기 ${Math.round(r.resaleRatio * 100)}%)` : ''}`);
    else if (r.status === 'error') console.log(`✗ ${t}: ${r.error}`);
    await sleep(isKr(t) ? 350 : 250); // DART/SEC rate-limit 예의
  }
  console.log('[ingest-filings] 요약:', JSON.stringify(counts), `(${tickers.length} 처리)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[FATAL]', e?.stack ?? e); process.exit(1); });
