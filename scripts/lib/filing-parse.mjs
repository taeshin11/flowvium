// filing-parse.mjs — DART(KR 사업보고서) · SEC(US 10-K/10-Q) 본문에서 사업·매출구성·연구개발·리스크
//   섹션을 추출하는 파서. 보고서가 새로 뜰 때마다 ingest-filings.mjs 가 호출해 DB(filings)에 저장.
//   목적: 재무 숫자만이 아니라 "무슨 사업·자체생산 vs 되팔기·R&D 강도·전망" 까지 매수선정/심층챗 근거로.
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const UA = 'FlowVium/1.0 (research; contact taeshinkim11@gmail.com)';

// ── 공통 텍스트 유틸 ──────────────────────────────────────────────────────────
const ENT = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
export function cleanText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|tr|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x?[0-9a-f]+;/gi, ' ')
    .replace(/&[a-z]+;/gi, (m) => ENT[m] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}
function trunc(s, n) { s = (s || '').trim(); return s.length > n ? s.slice(0, n).trim() + ' …' : s; }

// HTML/XML 테이블 → 'a | b | c' 행으로. 빈 행 제거.
function tableToText(tableHtml, maxRows = 18) {
  const rows = [...tableHtml.matchAll(/<TR[^>]*>([\s\S]*?)<\/TR>/gi)].map((tr) => {
    const cells = [...tr[1].matchAll(/<(?:TD|TH)[^>]*>([\s\S]*?)<\/(?:TD|TH)>/gi)]
      .map((c) => cleanText(c[1]).replace(/\n/g, ' ').trim());
    return cells.filter((c) => c !== '').length ? cells.join(' | ') : '';
  }).filter(Boolean);
  return rows.slice(0, maxRows).join('\n');
}

// ── DART (KR) ─────────────────────────────────────────────────────────────────
function dartKey() {
  let k = process.env.DART_API_KEY?.trim();
  if (!k) { try { const e = readFileSync(resolve(ROOT, '.env.local'), 'utf8'); const m = e.match(/DART_API_KEY\s*=\s*(.+)/); if (m) k = m[1].trim().replace(/^["']|["']$/g, ''); } catch { /* */ } }
  if (!k) throw new Error('DART_API_KEY 미설정');
  return k;
}

/** 최신 정기보고서(사업/반기/분기) 메타 1건. corpCode 필요. */
export async function dartLatestReport(corpCode, bgnDe = '20240101') {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${dartKey()}&corp_code=${corpCode}&bgn_de=${bgnDe}&end_de=${today}&pblntf_ty=A&page_count=10`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  const j = await r.json();
  if (j.status !== '000' || !j.list?.length) return null;
  // 정기보고서만(사업/반기/분기). 가장 최근(list 는 최신순).
  const rep = j.list.find((x) => /사업보고서|반기보고서|분기보고서/.test(x.report_nm));
  if (!rep) return null;
  return { rceptNo: rep.rcept_no, reportNm: rep.report_nm.trim(), rceptDt: rep.rcept_dt };
}

/** rcept_no → document.xml ZIP → 메인 XML 문자열. */
export async function dartDocumentXml(rceptNo) {
  const url = `https://opendart.fss.or.kr/api/document.xml?crtfc_key=${dartKey()}&rcept_no=${rceptNo}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!r.ok) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return null; // not a ZIP
  const files = unzipSync(buf);
  // 메인 문서 = 가장 큰 .xml (부속 _NNNNN.xml 은 재무제표 첨부)
  let best = null, bestLen = 0;
  for (const [name, data] of Object.entries(files)) {
    if (!/\.xml$/i.test(name)) continue;
    if (data.length > bestLen) { best = data; bestLen = data.length; }
  }
  return best ? strFromU8(best) : null;
}

// XML 을 <TITLE> 경계로 섹션 분할 → {title, body} 배열.
function dartSections(xml) {
  const out = [];
  const re = /<TITLE[^>]*>([\s\S]*?)<\/TITLE>/gi;
  const marks = [];
  let m;
  while ((m = re.exec(xml))) marks.push({ title: cleanText(m[1]).replace(/\n/g, ' ').trim(), start: m.index + m[0].length });
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start - 0 : xml.length;
    out.push({ title: marks[i].title, body: xml.slice(marks[i].start, end) });
  }
  return out;
}

/** DART 사업보고서 XML → 구조화 섹션. */
export function parseDartReport(xml) {
  const secs = dartSections(xml);
  const find = (re) => secs.find((s) => re.test(s.title));
  const narr = (sec, n) => sec ? trunc(cleanText(sec.body), n) : '';
  const tbls = (sec, n) => {
    if (!sec) return '';
    const tables = [...sec.body.matchAll(/<TABLE[^>]*>[\s\S]*?<\/TABLE>/gi)].map((t) => tableToText(t[0]));
    return trunc(tables.filter(Boolean).join('\n\n'), n);
  };
  const overviewSec = find(/사업의\s*개요/);
  const productsSec = find(/주요\s*제품|제품\s*및\s*서비스/);
  const salesSec = find(/매출\s*및\s*수주|매출\s*실적|매출\s*및\s*수주상황/);
  const rndSec = find(/연구개발|주요계약\s*및\s*연구개발/);
  const overview = narr(overviewSec, 1400);
  const products = trunc([narr(productsSec, 700), tbls(productsSec, 700)].filter(Boolean).join('\n'), 1400);
  // 매출구성: 서술(제품/상품 정의) + 표(제품·상품 금액)
  const salesMix = trunc([narr(salesSec, 600), tbls(salesSec, 1200)].filter(Boolean).join('\n'), 1800);
  const rnd = trunc([narr(rndSec, 700), tbls(rndSec, 600)].filter(Boolean).join('\n'), 1400);
  return { overview, products, salesMix, rnd, source: 'dart' };
}

/** salesMix 텍스트에서 제품(자체생산) vs 상품(되팔기) 합계 → 되팔기 비중. 파싱 실패 시 null. */
export function computeResaleRatio(salesMix) {
  if (!salesMix || !/상품/.test(salesMix) || !/제품/.test(salesMix)) return null;
  const lines = salesMix.split('\n');
  const sumAfter = (label) => {
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`(^|\\|)\\s*${label}\\s*(\\||$)`).test(lines[i]) || new RegExp(`^${label}매출`).test(lines[i].trim())) {
        // 이 라벨 행부터 다음 라벨 전까지 '합 계' 행의 첫 숫자
        for (let j = i; j < Math.min(i + 6, lines.length); j++) {
          if (/합\s*계/.test(lines[j])) {
            const nums = (lines[j].match(/[\d,]{4,}/g) || []).map((s) => Number(s.replace(/,/g, ''))).filter((n) => n > 0);
            if (nums.length) return nums[0];
          }
        }
      }
    }
    return null;
  };
  const prod = sumAfter('제품'), good = sumAfter('상품');
  if (prod == null || good == null || prod + good === 0) return null;
  return Math.round((good / (prod + good)) * 1000) / 1000;
}

// ── SEC (US) 10-K/10-Q ─────────────────────────────────────────────────────────
let TICKER_CIK = null;
function loadCikMap() {
  if (TICKER_CIK) return TICKER_CIK;
  TICKER_CIK = new Map();
  try {
    const j = JSON.parse(readFileSync(resolve(ROOT, 'data/sec-tickers.json'), 'utf8'));
    for (const e of Object.values(j)) TICKER_CIK.set(String(e.ticker).toUpperCase(), String(e.cik_str).padStart(10, '0'));
  } catch { /* 파일 없으면 런타임 fetch */ }
  return TICKER_CIK;
}
async function cikFor(ticker) {
  const t = ticker.toUpperCase();
  const map = loadCikMap();
  if (map.has(t)) return map.get(t);
  try {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (r.ok) { const j = await r.json(); for (const e of Object.values(j)) { if (String(e.ticker).toUpperCase() === t) return String(e.cik_str).padStart(10, '0'); } }
  } catch { /* */ }
  return null;
}

/** 최신 10-K/10-Q 메타 + primary doc HTML. */
export async function secLatestFiling(ticker) {
  const cik = await cikFor(ticker);
  if (!cik) return null;
  const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  const j = await r.json();
  const f = j.filings?.recent;
  if (!f) return null;
  // 사업의 내용(Item 1 Business)·Risk·MD&A 는 연차보고서(10-K/20-F/40-F)에만 있다 → 연차만 수집.
  //   (10-Q 는 Business 섹션이 없어 본문 grounding 가치가 없고, 분기 재무는 XBRL/company-financials 가 담당.)
  const idx = f.form.findIndex((x) => x === '10-K' || x === '20-F' || x === '40-F');
  if (idx < 0) return null;
  const accession = f.accessionNumber[idx].replace(/-/g, '');
  const primaryDoc = f.primaryDocument[idx];
  const docUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${primaryDoc}`;
  const dr = await fetch(docUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
  if (!dr.ok) return null;
  const html = await dr.text();
  return { filingId: f.accessionNumber[idx], form: f.form[idx], filedDate: f.filingDate[idx], reportNm: `${f.form[idx]} (${f.reportDate[idx]})`, html };
}

/** 10-K HTML → Item 1 Business / 1A Risk / 7 MD&A 추출. */
export function parseSecFiling(html) {
  const text = cleanText(html);
  // 목차(TOC)에 같은 "Item N." 헤더가 먼저 나오므로 *마지막* 출현(실제 본문)부터 다음 헤더 전까지 잘라낸다.
  //   본문 섹션은 길고 TOC 항목은 짧음 → 마지막 매치가 실제 섹션 시작.
  const lastIndex = (re) => { let last = -1, m; const g = new RegExp(re.source, 'gi'); while ((m = g.exec(text))) last = m.index; return last; };
  const grab = (startRe, endRes, n) => {
    const s = lastIndex(startRe);
    if (s < 0) return '';
    let end = text.length;
    for (const er of endRes) { const g = new RegExp(er.source, 'gi'); g.lastIndex = s + 30; const m = g.exec(text); if (m && m.index < end) end = m.index; }
    return trunc(text.slice(s, end), n);
  };
  const business = grab(/Item\s*1\.?\s*Business/i, [/Item\s*1A\.?\s*Risk/i], 1800);
  const risk = grab(/Item\s*1A\.?\s*Risk\s*Factors/i, [/Item\s*1B\b/i, /Item\s*2\.?\s*Propert/i], 1400);
  const mdna = grab(/Item\s*7\.?\s*Management.{0,3}s?.{0,3}Discussion/i, [/Item\s*7A\b/i, /Item\s*8\.?\s*Financial/i], 1800);
  return { overview: business, products: '', salesMix: '', rnd: '', risk, mdna, source: 'sec' };
}
