#!/usr/bin/env node
/**
 * scripts/build-evidence-claims.mjs — evidence warehouse 적재기 (Task28 D7 step2).
 *
 * "숫자는 DB 가 쓰고 LLM 은 evidenceId 만 고른다" 원칙의 데이터 적재. 권위 소스 → evidence_claims:
 *   ① financials.json (SEC XBRL + OpenDART 파생, 989종) → revenueYoYPct/opMarginPct/roePct
 *   ② /api/insider-trades (Form4, edgar-insider 가 P/S/A/M/F 분류) → insiderBuyCount30d/insiderSellCount30d
 *      + insider_transactions point-in-time 적재.
 * 이후 catalyst/fundamentalBasis 렌더러(step3)가 getEvidenceClaims 로 value_num 읽어 문장 생성 → LLM 숫자 제거.
 *
 * 사용: node scripts/build-evidence-claims.mjs   (주기 실행 권장 — point-in-time 누적)
 * 비-GPU 독립 스크립트 (cron 충돌 무관).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { saveEvidenceClaim, openDb } from './lib/db.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const now = new Date().toISOString();
const SITE = process.env.SITE_URL || 'http://localhost:3000';

// 2026-06-14: source_ref(provenance) + evidence_hash(변경감지) 적재 — 종전 미설정으로 3컬럼 100% NULL
//   (audit-coverage 가 잡던 결함). source_ref=구조화 출처, evidence_hash=값/기간/소스 sha1 12자.
const base = (t) => t.replace(/\.(KS|KQ)$/, '');
const evHash = (...parts) => createHash('sha1').update(parts.map(String).join('|')).digest('hex').slice(0, 12);
// value_text = 렌더러용 표시문자열(value_num 의 사람이 읽는 형태). 종전 NULL → audit 가 잡던 폴리모픽 컬럼.
const fmtVal = (v, unit) => unit === '%' ? `${(+v).toFixed(1)}%`
  : unit === 'USD' ? (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v)}`)
  : unit === 'count' ? `${v}건` : String(v);
const finRef = (src, t, period) => src === 'sec-xbrl'
  ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${base(t)}&type=10-K`   // EDGAR(ticker→CIK 리다이렉트)
  : `opendart:${base(t)}:${period ?? 'latest'}`;                                            // KR DART (corp_code 기반, 구조화)

// ── ① 펀더멘털 (financials.json) ──────────────────────────────────────────────
let fin = {};
try { fin = JSON.parse(readFileSync(resolve(ROOT, 'data/financials.json'), 'utf8')); } catch (e) { console.error('financials.json 로드 실패:', e.message); }
let finN = 0;
for (const [ticker, f] of Object.entries(fin)) {
  const period = f.fy ? `FY${f.fy}` : null;
  const src = /\.(KS|KQ)$/.test(ticker) ? 'opendart' : 'sec-xbrl';  // financials.json 의 실제 1차 소스
  const claims = [
    ['revenueYoYPct', f.revYoYPct, '%'],
    ['opMarginPct', f.opMarginPct, '%'],
    ['roePct', f.roePct, '%'],
    ['revenueUsd', f.revUsd, 'USD'],
  ];
  for (const [claimId, v, unit] of claims) {
    if (v == null || !Number.isFinite(v)) continue;
    saveEvidenceClaim({ ticker, claimId, valueNum: v, valueText: fmtVal(v, unit), unit, period, asOf: period, source: src,
      sourceRef: finRef(src, ticker, period), evidenceHash: evHash(ticker, claimId, v, period, src),
      confidence: 'confirmed', fetchedAt: now });
    finN++;
  }
}
console.log(`[evidence] 펀더멘털 ${finN} claims (${Object.keys(fin).length} 종 financials.json)`);

// ── ② 내부자 (Form4, /api/insider-trades) ────────────────────────────────────
let insN = 0, txN = 0;
try {
  const res = await fetch(`${SITE}/api/insider-trades`, { signal: AbortSignal.timeout(10000) });
  const items = (await res.json())?.items ?? [];
  const db = openDb();
  const insertTx = db.prepare(`INSERT INTO insider_transactions (ticker, filed_at, transaction_date, insider_name, transaction_code, direction, shares, price, value_usd, source_accession, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(ticker, source_accession, transaction_date, transaction_code, shares) DO NOTHING`);
  const agg = new Map();  // ticker → {buys, sells, buyUsd, sellUsd, dates}
  for (const it of items) {
    const t = (it.ticker || '').toUpperCase(); if (!t) continue;
    insertTx.run(t, it.filedAt ?? null, it.transactionDate ?? null, it.insiderName ?? null, it.transactionCode ?? null, it.direction ?? null, it.shares ?? null, it.pricePerShare ?? null, it.transactionValueUsd ?? null, (it.id || '').split('-').slice(0, 3).join('-') || null, now);
    txN++;
    const e = agg.get(t) ?? { buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, acc: null, accDate: '' };
    if (it.direction === 'buy') { e.buys++; e.buyUsd += it.transactionValueUsd || 0; }
    else if (it.direction === 'sell') { e.sells++; e.sellUsd += it.transactionValueUsd || 0; }
    const acc = (it.id || '').split('-').slice(0, 3).join('-');                 // accession (실제 Form4 출처)
    if (acc && (it.filedAt ?? '') >= e.accDate) { e.acc = acc; e.accDate = it.filedAt ?? ''; }  // 최신 filing
    agg.set(t, e);
  }
  for (const [t, e] of agg) {
    // source_ref = 최신 Form4 accession EDGAR 링크(실 provenance), 없으면 구조화 태그
    const ref = e.acc ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=${e.acc}` : `edgar-form4:${base(t)}:30d`;
    const ins = (claimId, v, unit) => saveEvidenceClaim({ ticker: t, claimId, valueNum: v, valueText: fmtVal(v, unit), unit, period: '30d', source: 'edgar-form4', sourceRef: ref, evidenceHash: evHash(t, claimId, v, '30d', 'edgar-form4'), confidence: 'confirmed', fetchedAt: now });
    ins('insiderBuyCount30d', e.buys, 'count');
    ins('insiderSellCount30d', e.sells, 'count');
    if (e.buyUsd) ins('insiderBuyUsd30d', e.buyUsd, 'USD');
    if (e.sellUsd) ins('insiderSellUsd30d', e.sellUsd, 'USD');
    insN += 2;
  }
} catch (e) { console.warn('[evidence] insider 적재 skip:', e.message); }
console.log(`[evidence] 내부자 ${insN} claims + ${txN} transactions`);

const db = openDb();
const total = db.prepare('SELECT COUNT(*) c FROM evidence_claims').get().c;
const tickers = db.prepare('SELECT COUNT(DISTINCT ticker) c FROM evidence_claims').get().c;
console.log(`✅ evidence_claims 총 ${total} (${tickers} 종) | insider_transactions ${db.prepare('SELECT COUNT(*) c FROM insider_transactions').get().c}`);
