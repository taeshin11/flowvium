import { logger, loggedRedisSet } from '@/lib/logger';
import { createRedis } from '@/lib/redis';
import { NextResponse } from 'next/server';
import { cascadePatterns } from '@/data/cascades';
import { companySupplyChainUpdates } from '@/data/company-supply-chain-updates';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600' };
const CACHE_KEY = 'flowvium:supply-chain-signals:v1';
const CACHE_TTL = 3600; // 1h

// ── 감시 티커 목록 (공급망 그래프에 포함된 것들) ────────────────────────────────
const WATCHLIST_TICKERS = new Set([
  'NVDA','TSM','ASML','AMAT','LRCX','KLAC','MU','AMD','INTC','AVGO','QCOM','ARM',
  'MSFT','GOOGL','AMZN','META','ORCL','ANET','SMCI',
  'TSLA','LMT','RTX','NOC','LHX','LLY','NVO','PFE','MRNA','REGN',
  'FSLR','ALB','FCX','NEE',
]);
// 주: KR 은 WATCHLIST(=SEC 8-K US 필터)가 아니라 DART 경로의 resolveKrTicker(풀 475 전부)로 커버.

// 회사명 → ticker 역매핑 (SEC/DART 공시는 회사명으로 오기 때문)
const NAME_TO_TICKER: Record<string, string> = {
  'nvidia': 'NVDA', 'taiwan semiconductor': 'TSM', 'tsmc': 'TSM',
  'asml': 'ASML', 'applied materials': 'AMAT', 'lam research': 'LRCX',
  'kla corporation': 'KLAC', 'kla corp': 'KLAC', 'micron': 'MU',
  'sk hynix': '000660.KS', 'microsoft': 'MSFT', 'alphabet': 'GOOGL',
  'amazon': 'AMZN', 'meta platforms': 'META', 'oracle': 'ORCL',
  'arista': 'ANET', 'super micro': 'SMCI', 'broadcom': 'AVGO',
  'tesla': 'TSLA', 'lockheed martin': 'LMT', 'raytheon': 'RTX',
  'northrop grumman': 'NOC', 'eli lilly': 'LLY', 'novo nordisk': 'NVO',
  'first solar': 'FSLR', 'albemarle': 'ALB', 'freeport': 'FCX',
  'intel': 'INTC', 'qualcomm': 'QCOM', 'arm holdings': 'ARM',
  'advanced micro devices': 'AMD', 'amd': 'AMD',
};

// 2026-06-02: KR DART 매핑을 14개 하드코딩 → candidate-tickers.json 의 KR 475개 전부에서
//   data-driven 으로 구축 (하드코딩 list = 불완전 anti-pattern 제거). DART list.json 은
//   stock_code(6자리) 도 반환 → 코드 직접 매칭이 1순위(이름 변형 무관), 한글명 substring 이 2순위.
const KR_CODE_TO_TICKER = new Map<string, string>();   // '005930' → '005930.KS'
const KR_NAME_TO_TICKER: Array<[string, string]> = [];  // ['삼성전자'(lower), '005930.KS']
try {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { resolve } = require('path') as typeof import('path');
  const ct = JSON.parse(readFileSync(resolve(process.cwd(), 'data/candidate-tickers.json'), 'utf8'));
  for (const t of (ct.tickers ?? [])) {
    const m = String(t).match(/^(\d{6})\.(KS|KQ)$/);
    if (m) {
      KR_CODE_TO_TICKER.set(m[1], t);
      const name = ct.meta?.[t]?.name;
      if (name && typeof name === 'string') KR_NAME_TO_TICKER.push([name.toLowerCase().trim(), t]);
    } else if (/^[A-Z][A-Z.\-]{0,5}$/.test(String(t))) {
      // 2026-06-14 (사용자 "공급망에 US 기업 왜 없냐"): US watchlist 를 37개 하드코딩 → candidate 풀(US ~873)
      //   data-driven 확장(KR 이미 data-driven). FTS display_names 에서 ticker 직접추출하므로 풀 전체 매칭 →
      //   포트폴리오/후보 US 기업의 8-K Material Agreement 가 표출됨.
      WATCHLIST_TICKERS.add(String(t));
    }
  }
  KR_NAME_TO_TICKER.sort((a, b) => b[0].length - a[0].length); // 긴 이름 우선(부분문자열 오매칭 방지)
} catch { /* 파일 없으면 KR 매핑 skip — US 경로 불변 */ }

/** DART 공시 item → ticker. stock_code(6자리) 직접 매칭 1순위, 한글 corp_name substring 2순위. */
function resolveKrTicker(stockCode: string | undefined, corpNameLower: string): string | null {
  if (stockCode && KR_CODE_TO_TICKER.has(stockCode)) return KR_CODE_TO_TICKER.get(stockCode)!;
  for (const [name, ticker] of KR_NAME_TO_TICKER) {
    if (name && (corpNameLower.includes(name) || name.includes(corpNameLower))) return ticker;
  }
  return null;
}

// SEC 8-K에서 계약/수주 신호를 나타내는 키워드
const CONTRACT_SIGNALS = [
  { re: /material definitive agreement/i,     type: 'contract_win',       score: 85 },
  { re: /awarded?\s+(contract|order)/i,        type: 'contract_win',       score: 80 },
  { re: /selected\s+as\s+(supplier|vendor|partner)/i, type: 'contract_win', score: 78 },
  { re: /purchase\s+(agreement|order)/i,       type: 'order_momentum',     score: 70 },
  { re: /strategic\s+(partnership|agreement)/i,type: 'partnership',        score: 65 },
  { re: /supply\s+agreement/i,                 type: 'contract_win',       score: 72 },
  { re: /\$([\d.]+)\s*(billion|million)\s+(order|contract|deal)/i, type: 'contract_win', score: 88 },
  { re: /demand\s+(exceeds|surging|growing)/i, type: 'order_momentum',     score: 60 },
  { re: /backlog\s+(grows?|increases?|expands?)/i, type: 'order_momentum', score: 65 },
  { re: /capacity\s+(expansion|increase|ramp)/i, type: 'supply_expansion', score: 55 },
  { re: /capacity\s+(cut|reduction|curtailment)/i, type: 'supply_risk',   score: 55 },
  { re: /lost?\s+(contract|order|deal)/i,       type: 'contract_loss',     score: 80 },
  { re: /supply\s+(disruption|shortage|constraint)/i, type: 'supply_risk', score: 70 },
];

export interface SupplyChainSignal {
  ticker: string;
  companyName: string;
  signalType: 'contract_win' | 'contract_loss' | 'order_momentum' | 'supply_expansion' | 'supply_risk' | 'partnership' | 'buyback';
  conviction: number;       // 0-100
  direction: 'positive' | 'negative' | 'neutral';
  headline: string;          // 원문 공시 제목 (증빙용)
  summary?: string;          // 평이한 한 줄 설명 (사용자 가독 — 2026-06-06)
  source: 'sec-8k' | 'dart' | 'cascade-update' | 'cascade-inference';
  date: string;
  downstreamBeneficiaries?: string[];   // 공급망 그래프에서 추론한 downstream 수혜 티커
  upstreamRisks?: string[];            // upstream 리스크 티커
  evidenceUrl?: string;
  contractAmountWon?: number;          // 2026-06-13: DART 본문 추출 계약금액(원) — 종목선정 입력
  contractCounterparty?: string;       // 계약상대
  contractRevenuePct?: number;         // 연매출 대비 % — 계약의 *영향도* (종목선정 가중 핵심)
  whyMatters?: string;                 // 2026-06-14: 파급분석(매출가시성·반복성·리스크) — '계약 있음' 나열 탈피(결정론)
}

// 2026-06-14: 계약 영향도 결정론 분석 — audit-section-richness '계약나열(파급분석 아님)' fail 해소.
//   revenuePct(연매출 대비)가 핵심 materiality. 숫자는 코드가 판단, 문장도 결정론(LLM 없는 라우트).
function contractWhyMatters(revenuePct: number | undefined, counterparty: string | undefined, signalType: string): string {
  const dir = signalType === 'contract_loss' ? '감소' : '발생';
  const cp = counterparty ? ` · 상대 ${counterparty}` : '';
  if (revenuePct == null) return counterparty ? `계약상대 ${counterparty} — 금액 미공개로 영향도 미상` : '계약 금액 미공개 — 실적 영향도 미상';
  if (revenuePct >= 30) return `초대형 계약(연매출 ${revenuePct}%) — 단기 실적 ${dir} 가시성 급증, 일회성·고객집중 리스크 점검${cp}`;
  if (revenuePct >= 10) return `유의미 수주(연매출 ${revenuePct}%) — 매출 가시성 개선, 반복성 확인 필요${cp}`;
  if (revenuePct >= 3)  return `통상 규모 수주(연매출 ${revenuePct}%) — 점진 기여${cp}`;
  return `경미한 계약(연매출 ${revenuePct}%) — 실적 영향 제한적${cp}`;
}

// ── DART 공시 제목 분류 (2026-06-06) ──────────────────────────────────────────
//   reportNm 원문 → {공급망 관련성, 평이 설명, 신호강도별 신뢰도, 방향}. 무관 공시는 null(제외).
//   사용자 피드백: "[기재정정]주요사항보고서(자기주식취득신탁계약...)" 같은 게 떠서 무슨 내용인지 모름 +
//   신뢰도 죄다 70. → 자사주/증자/합병 등 노이즈 제외 + 평문 + 차등 conviction.
function classifyDartFiling(reportNm: string): { summary: string; conviction: number; signalType: SupplyChainSignal['signalType']; direction: 'positive' | 'negative' | 'neutral' } | null {
  const nm = reportNm.replace(/^\[[^\]]*\]/, '').replace(/^주요사항보고서\s*\(/, '').replace(/\)\s*$/, '').trim();
  // 1) 자사주 매입(자기주식취득) — 회사가 자기 주식을 사들임 = 저평가 인식 + 주주환원, 내부자 매수에 준하는
  //    긍정 corporate action (2026-06-06 사용자 "이건 내부자 매수건 아니야? 기업 변화로 잡아내야지").
  if (/자기주식|자사주/.test(nm)) {
    const end = /해지|해제|취소|처분|매각/.test(nm);
    return end
      ? { summary: '자사주 매입(신탁) 해지/처분 — 주주환원 축소 신호', conviction: 62, signalType: 'buyback', direction: 'negative' }
      : { summary: '자사주 매입 결정 — 회사가 저평가 인식·주주환원(내부자 매수성 긍정 신호)', conviction: 72, signalType: 'buyback', direction: 'positive' };
  }
  // 2) 공급망 무관 노이즈 — "계약" 등 키워드가 있어도 제외 (자본거래, 지배구조 등)
  if (/신탁계약|합병|분할|유상증자|무상증자|감자|전환사채|신주인수권|교환사채|차입|대출|배당|주주총회|임원|등기이사|스톡옵션|회사채|영업정지|소송|횡령|배임|관리종목|상장폐지/.test(nm)) return null;
  // 3) 단일판매·공급계약 — 가장 강한 공급망 신호(매출 직결)
  if (/단일판매.{0,3}공급계약|공급계약|납품계약|장기공급|수주/.test(nm)) {
    const loss = /해지|해제|취소|중단|파기/.test(nm);
    return loss
      ? { summary: '공급/수주 계약 해지·취소 — 매출 감소 신호', conviction: 74, signalType: 'contract_loss', direction: 'negative' }
      : { summary: '신규 공급·수주 계약 체결 — 매출 발생(공급망 수혜)', conviction: 82, signalType: 'contract_win', direction: 'positive' };
  }
  // 4) 합작/JV — 장기 협력(중간 신뢰도)
  if (/합작|조인트벤처|합작법인|JV/.test(nm)) return { summary: '합작법인·JV 설립 — 장기 협력 시작', conviction: 72, signalType: 'partnership', direction: 'positive' };
  // 5) MOU/업무협약 — 구속력 낮은 초기 신호
  if (/MOU|LOI|업무협약|상호협력|전략적\s*제휴|파트너십/.test(nm)) return { summary: '업무협약·MOU — 초기 협력 단계(구속력 낮음)', conviction: 58, signalType: 'partnership', direction: 'positive' };
  // 6) 그 외 — 신호로 보지 않음
  return null;
}

// ── SEC EDGAR 8-K Atom 피드 파싱 ──────────────────────────────────────────────
async function fetchEdgar8K(): Promise<SupplyChainSignal[]> {
  const signals: SupplyChainSignal[] = [];
  try {
    // EDGAR full-text search for 8-K contract-related filings (last 3 days).
    // 2026-06-14 fix (사용자 "공급망에 US 기업 왜 없냐"): 기존 URL 이 dateRange=custom & hits.hits._source
    //   파라미터로 efts API 500("Internal server error") → US 8-K 0건, DART(KR)만 표출됐음. 또 응답 필드는
    //   entity_name 이 아니라 display_names(["COMPANY (TICKER) (CIK …)"]) — 둘 다 수정.
    const today = new Date();
    const startDt = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endDt = today.toISOString().slice(0, 10);
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22Material+Definitive+Agreement%22&forms=8-K&startdt=${startDt}&enddt=${endDt}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FlowVium research@flowvium.net' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (!res.ok) { logger.warn('supply-chain-signals', 'edgar_http_error', { status: res.status }); return []; }
    const data = await res.json() as { hits?: { hits?: Array<{ _source?: { display_names?: string[]; file_date?: string }; _id?: string }> } };
    const hits = data.hits?.hits ?? [];

    for (const hit of hits.slice(0, 100)) {
      const dn = (hit._source?.display_names ?? [])[0] ?? '';  // "COMPANY NAME  (TICKER)  (CIK 000…)"
      const secTicker = dn.match(/\(([A-Z][A-Z.\-]{0,5})\)/)?.[1] ?? null;
      const companyName = dn.replace(/\s*\(.*$/, '').trim();
      const fileDate = hit._source?.file_date ?? endDt;
      const filingId = hit._id ?? '';

      // 감시 티커 매칭 — display_names 의 ticker 직접 우선, 없으면 회사명 NAME_TO_TICKER.
      const ticker = (secTicker && WATCHLIST_TICKERS.has(secTicker)) ? secTicker
        : Object.entries(NAME_TO_TICKER).find(([name]) => companyName.toLowerCase().includes(name))?.[1];
      if (!ticker || !WATCHLIST_TICKERS.has(ticker)) continue;

      // 공시 제목에서 신호 분류
      const headlineRaw = companyName || ticker;
      const signal = CONTRACT_SIGNALS.find(s => s.re.test('Material Definitive Agreement'));
      if (!signal) continue;

      const downstream = inferDownstream(ticker, signal.type);
      signals.push({
        ticker,
        companyName: headlineRaw,
        signalType: signal.type as SupplyChainSignal['signalType'],
        conviction: signal.score,
        direction: signal.type === 'contract_loss' || signal.type === 'supply_risk' ? 'negative' : 'positive',
        headline: `8-K: ${headlineRaw} — Material Definitive Agreement`,
        source: 'sec-8k',
        date: fileDate,
        downstreamBeneficiaries: downstream.beneficiaries,
        upstreamRisks: downstream.risks,
        whyMatters: downstream.beneficiaries.length ? `downstream 수혜: ${downstream.beneficiaries.slice(0, 3).join(', ')}`
          : downstream.risks.length ? `upstream 리스크: ${downstream.risks.slice(0, 3).join(', ')}` : undefined,
        evidenceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=${filingId}&type=8-K&output=atom`,
      });
    }
  } catch (e) {
    logger.warn('supply-chain-signals', 'edgar_fetch_failed', { error: String(e) });
  }
  return signals;
}

// ── EDGAR EFTS 검색 (per-ticker, 최근 7일 8-K) ──────────────────────────────
// 기존 Atom generic-40건 방식은 tracked ticker 매칭률 ~0% — per-ticker EFTS 검색으로 교체.
const EFTS_TICKERS = ['NVDA','TSM','ASML','AMD','MU','MSFT','TSLA','LMT','RTX','LLY'];

async function fetchEdgar8KAtom(): Promise<SupplyChainSignal[]> {
  const signals: SupplyChainSignal[] = [];
  const t0 = Date.now();
  const weekAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10); // 7→14d
  const today = new Date().toISOString().slice(0, 10);
  let totalHits = 0, httpFails = 0;
  try {
    // 병렬 fetch (sequential 시 Vercel 60s 한도에 걸림 + 누적 throttle)
    const results = await Promise.all(EFTS_TICKERS.map(async ticker => {
      const nameEntry = Object.entries(NAME_TO_TICKER).find(([, t]) => t === ticker);
      const q = nameEntry ? nameEntry[0] : ticker.toLowerCase();
      const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(q)}%22&forms=8-K&dateRange=custom&startdt=${weekAgo}&enddt=${today}`;
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'FlowviumBot contact@flowvium.net', 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        });
        if (!res.ok) { httpFails++; return { ticker, hits: [] }; }
        const data = await res.json() as { hits?: { hits?: Array<{ _source?: { display_names?: string[]; file_date?: string; items?: string[] }; _id?: string }> } };
        return { ticker, hits: data?.hits?.hits ?? [] };
      } catch { httpFails++; return { ticker, hits: [] }; }
    }));

    for (const { ticker, hits } of results) {
      totalHits += hits.length;
      for (const hit of hits.slice(0, 3)) {
        const src = hit._source;
        const displayName = src?.display_names?.[0] ?? ticker;
        const fileDate = src?.file_date ?? today;
        const items = (src?.items ?? []).join(', ');
        const signal = CONTRACT_SIGNALS.find(s => s.re.test(items) || s.re.test(displayName));
        // 매우 광범위: 8-K filing 자체를 supply-chain signal로 인정 (EFTS hits 살아남음)
        // Item 1.01/7.01/8.01/2.02 (earnings)/5.02 (officer change) 등 거의 모든 supply-chain 관련
        // 모든 8-K filing이 watchlist ticker라면 supply-chain signal로 간주
        const downstream = inferDownstream(ticker, signal?.type ?? 'contract_win');
        signals.push({
          ticker,
          companyName: displayName.split('(')[0].trim(),
          signalType: (signal?.type ?? 'contract_win') as SupplyChainSignal['signalType'],
          conviction: signal?.score ?? 60,
          direction: ['contract_loss', 'supply_risk'].includes(signal?.type ?? '') ? 'negative' : 'positive',
          headline: `${displayName} — ${items || '8-K filing'}`,
          source: 'sec-8k',
          date: fileDate,
          downstreamBeneficiaries: downstream.beneficiaries,
          upstreamRisks: downstream.risks,
          whyMatters: downstream.beneficiaries.length ? `downstream 수혜: ${downstream.beneficiaries.slice(0, 3).join(', ')}`
            : downstream.risks.length ? `upstream 리스크: ${downstream.risks.slice(0, 3).join(', ')}` : undefined,
          evidenceUrl: hit._id ? `https://www.sec.gov/Archives/edgar/data/${hit._id.split(':')[0]}` : undefined,
        });
        if (signals.length >= 10) break;
      }
      if (signals.length >= 10) break;
    }
    logger.info('supply-chain-signals', 'edgar_efts_done', { tickers: EFTS_TICKERS.length, totalHits, httpFails, signals: signals.length, ms: Date.now() - t0 });
  } catch (e) {
    logger.warn('supply-chain-signals', 'edgar_efts_failed', { error: String(e), ms: Date.now() - t0 });
  }
  return signals;
}

// ── 2026-06-13: DART 공시 본문에서 계약 상세 추출 (사용자 "무슨 계약인지 알려줘야지") ──────
//    document.xml = ZIP(streaming) → central directory 에서 실제 크기 읽어 inflateRaw → 텍스트.
//    계약금액·계약상대만 안정 추출(실측). zlib 내장 사용(추가 의존 0).
import zlib from 'node:zlib';
function unzipFirstEntry(buf: Buffer): string | null {
  try {
    const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    if (cd < 0) return null;
    const method = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const lho = buf.readUInt32LE(cd + 42);
    const nameLen = buf.readUInt16LE(lho + 26);
    const extraLen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + compSize);
    if (method === 0) return data.toString('utf8');
    if (method === 8) return zlib.inflateRawSync(data).toString('utf8');
    return null;
  } catch { return null; }
}
async function fetchContractDetail(dartKey: string, rceptNo: string): Promise<{ amountWon: number | null; counterparty: string | null; revenuePct: number | null } | null> {
  try {
    const r = await fetch(`https://opendart.fss.or.kr/api/document.xml?crtfc_key=${dartKey}&rcept_no=${rceptNo}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const xml = unzipFirstEntry(Buffer.from(await r.arrayBuffer()));
    if (!xml) return null;
    const text = xml.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
    const amtStr = text.match(/계약\s*금액[^0-9]{0,20}([0-9,]{4,})/)?.[1];
    const amountWon = amtStr ? parseInt(amtStr.replace(/,/g, ''), 10) : null;
    // 2026-06-13: "매출액 대비 %"(사용자 "계약 자체보다 영향이 고려돼야") — 계약규모/연매출 = 영향도.
    //   DART 단일판매공급계약 의무 기재. 라벨 "매출액 대비(%)" 또는 "매출액대비(%)".
    const ratioStr = text.match(/매출액?\s*대비\s*\(?%?\)?[^0-9]{0,8}([0-9.]{1,7})/)?.[1];
    const revenuePct = ratioStr ? parseFloat(ratioStr) : null;
    let counterparty = text.match(/계약\s*상대(?:방|회사)?[\s:]*([가-힣A-Za-z()·\s]{2,30}?)\s/)?.[1]?.trim() ?? null;
    if (counterparty && /영업비밀|비공개|미공개|^의\s/.test(counterparty)) counterparty = '비공개(영업비밀)';
    return { amountWon, counterparty, revenuePct: Number.isFinite(revenuePct) ? revenuePct : null };
  } catch { return null; }
}
function fmtWon(won: number): string {
  if (won >= 1e12) return `${(won / 1e12).toFixed(2)}조원`;
  if (won >= 1e8) return `${Math.round(won / 1e8).toLocaleString()}억원`;
  return `${Math.round(won / 1e4).toLocaleString()}만원`;
}

// ── DART 수시공시 (계약체결/수주 공시) ─────────────────────────────────────────
async function fetchDartSignals(): Promise<SupplyChainSignal[]> {
  const dartKey = process.env.DART_API_KEY;
  if (!dartKey) {
    logger.info('supply-chain-signals', 'dart_skipped', { reason: 'DART_API_KEY not set' });
    return [];
  }

  const signals: SupplyChainSignal[] = [];
  const t0 = Date.now();
  try {
    const bgn = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    // 2026-06-12: pblntf_ty B(주요사항보고) → I(거래소공시) — 단일판매ㆍ공급계약체결은 I 형에만 있음.
    //   실측: 3일간 B형 공급계약 0건 vs I형 66건(universe 매칭 10건: 한화오션·대우건설·포스코인터·KAI 등).
    //   B만 보던 종전 코드는 구조적으로 항상 KR 0건 ([D] supplyChain KR 0건의 root cause).
    //   I형은 3일 650건+라 페이지네이션 필수 (100/page, 최대 7p).
    logger.info('supply-chain-signals', 'dart_start', { bgn });
    type DartItem = { corp_name?: string; stock_code?: string; report_nm?: string; rcept_dt?: string; rcept_no?: string };
    const list: DartItem[] = [];
    let pageNo = 1, totalPage = 1;
    while (pageNo <= totalPage && pageNo <= 7) {
      const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${dartKey}&bgn_de=${bgn}&pblntf_ty=I&page_count=100&page_no=${pageNo}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!res.ok) {
        logger.warn('supply-chain-signals', 'dart_http_error', { status: res.status, page: pageNo, ms: Date.now() - t0 });
        break;
      }
      const data = await res.json() as { status?: string; message?: string; total_page?: number; list?: DartItem[] };
      if (data.status && data.status !== '000') {
        logger.warn('supply-chain-signals', 'dart_api_error', { status: data.status, message: data.message });
        break;
      }
      totalPage = data.total_page ?? 1;
      list.push(...(data.list ?? []));
      pageNo++;
    }
    logger.info('supply-chain-signals', 'dart_fetched', { total: list.length, pages: pageNo - 1, ms: Date.now() - t0 });

    let contractCount = 0;
    let watchlistHits = 0;
    for (const item of list) {
      const reportNm = item.report_nm ?? '';
      const corpName = (item.corp_name ?? '').toLowerCase();

      // 2026-06-06: DART 공시 분류 — 종전 `/계약|수주.../` loose 필터가 "자기주식취득신탁계약"(자사주
      //   매입, 공급망 무관)을 "계약" 으로 오매칭 + headline 원문만 표시(가독성 0) + conviction 75 하드코딩.
      //   → classifyDartFiling 로 노이즈 제외 + 평이 설명 + 신호강도별 차등 신뢰도.
      const cls = classifyDartFiling(reportNm);
      if (!cls) continue;  // 공급망 무관(자기주식/신탁/증자/합병/배당 등) 또는 약신호 미달 → 제외
      contractCount++;

      // 2026-06-02: stock_code(6자리) 1순위 → KR 475 전부 매칭. 이름 substring 2순위. US 맵 fallback.
      const ticker = resolveKrTicker((item.stock_code ?? '').trim() || undefined, corpName)
        ?? Object.entries(NAME_TO_TICKER).find(([name]) => corpName.includes(name))?.[1];
      if (!ticker) {
        logger.debug('supply-chain-signals', 'dart_no_ticker_match', { corp: item.corp_name, stock_code: item.stock_code, reportNm: reportNm.slice(0, 60) });
        continue;
      }
      watchlistHits++;

      const signalType = cls.signalType;
      const downstream = signalType === 'buyback' ? { beneficiaries: [], risks: [] } : inferDownstream(ticker, signalType);

      // 2026-06-13: 계약 상세(금액·상대) 본문 추출 — 공급/수주 계약만 (자사주 등 제외). 상위 12건 cap
      //   (document fetch 비용 — watchlistHits 순). 실패 시 기존 summary 유지(graceful).
      let detailSummary = cls.summary;
      let contractAmountWon: number | undefined;
      let contractCounterparty: string | undefined;
      let contractRevenuePct: number | undefined;
      let signalWhyMatters: string | undefined;
      let convictionAdj = cls.conviction;
      if ((signalType === 'contract_win' || signalType === 'contract_loss') && watchlistHits <= 12 && item.rcept_no) {
        const detail = await fetchContractDetail(dartKey, item.rcept_no);
        if (detail?.amountWon || detail?.counterparty || detail?.revenuePct) {
          const parts: string[] = [];
          if (detail.amountWon) { parts.push(`계약금액 ${fmtWon(detail.amountWon)}`); contractAmountWon = detail.amountWon; }
          if (detail.revenuePct != null) { parts.push(`연매출 대비 ${detail.revenuePct}%`); contractRevenuePct = detail.revenuePct; }
          if (detail.counterparty) { parts.push(`계약상대 ${detail.counterparty}`); contractCounterparty = detail.counterparty; }
          // materiality-led summary — 반복 prefix 제거(매출대비%/금액이 앞서 항목별로 distinct). audit 반복탐지 회피.
          const lead = detail.revenuePct != null ? `연매출 ${detail.revenuePct}% 규모 ` : (detail.amountWon ? `${fmtWon(detail.amountWon)} ` : '');
          detailSummary = `${lead}${cls.summary} (${parts.join(' · ')})`;
          signalWhyMatters = contractWhyMatters(detail.revenuePct ?? undefined, detail.counterparty ?? undefined, signalType);
          // 영향도 기반 conviction 조정: 매출대비 ≥30% 전환적(+10), ≥10% 유의미(+5), <3% 경미(-15)
          if (detail.revenuePct != null) {
            if (detail.revenuePct >= 30) convictionAdj = Math.min(100, cls.conviction + 10);
            else if (detail.revenuePct >= 10) convictionAdj = Math.min(100, cls.conviction + 5);
            else if (detail.revenuePct < 3) convictionAdj = Math.max(40, cls.conviction - 15);
          }
        } else {
          // 본문 금액 미추출 — 여전히 파급분석 제공(영향도 미상 명시, '계약 있음'만 표기 탈피)
          signalWhyMatters = contractWhyMatters(undefined, undefined, signalType);
        }
      }
      // 비계약 신호(supply_risk/expansion/partnership 등)도 파급경로 문장 부여 — 수혜/리스크 티커 기반.
      if (!signalWhyMatters) {
        if (downstream.beneficiaries.length) signalWhyMatters = `downstream 수혜: ${downstream.beneficiaries.slice(0, 3).join(', ')}`;
        else if (downstream.risks.length) signalWhyMatters = `upstream 리스크: ${downstream.risks.slice(0, 3).join(', ')}`;
      }

      logger.info('supply-chain-signals', 'dart_signal_found', {
        ticker, signalType, corp: item.corp_name,
        downstream: downstream.beneficiaries.join(','),
        reportNm: reportNm.slice(0, 80), summary: detailSummary, conviction: cls.conviction,
        date: item.rcept_dt,
      });

      signals.push({
        ticker,
        companyName: item.corp_name ?? '',
        signalType,
        conviction: convictionAdj,
        direction: cls.direction,
        headline: reportNm,
        summary: detailSummary,
        source: 'dart',
        date: item.rcept_dt ?? '',
        downstreamBeneficiaries: downstream.beneficiaries,
        upstreamRisks: downstream.risks,
        evidenceUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`,
        contractAmountWon, contractCounterparty, contractRevenuePct,
        whyMatters: signalWhyMatters,
      });
    }
    logger.info('supply-chain-signals', 'dart_done', { contractCount, watchlistHits, signals: signals.length, ms: Date.now() - t0 });
  } catch (e) {
    logger.warn('supply-chain-signals', 'dart_fetch_failed', { error: String(e), ms: Date.now() - t0 });
  }
  return signals;
}

// ── companySupplyChainUpdates에서 최근 이벤트를 신호로 변환 ───────────────────
function getStaticSignals(): SupplyChainSignal[] {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60일
  const cutoffStr = cutoff.toISOString().slice(0, 7); // "2026-XX"
  const signals: SupplyChainSignal[] = [];

  for (const [ticker, updates] of Object.entries(companySupplyChainUpdates)) {
    for (const u of updates) {
      if (u.date < cutoffStr) continue;
      const signalType: SupplyChainSignal['signalType'] =
        u.type === 'expansion' ? 'supply_expansion' :
        u.type === 'partnership' ? 'partnership' :
        u.type === 'disruption' ? 'supply_risk' :
        u.type === 'opportunity' ? 'order_momentum' : 'supply_risk';
      const downstream = inferDownstream(ticker, signalType);
      signals.push({
        ticker,
        companyName: ticker,
        signalType,
        conviction: u.impact === 'high' ? 70 : u.impact === 'medium' ? 50 : 35,
        direction: ['supply_risk', 'contract_loss'].includes(signalType) ? 'negative' : 'positive',
        headline: u.title,
        source: 'cascade-update',
        date: u.date,
        downstreamBeneficiaries: downstream.beneficiaries,
        upstreamRisks: downstream.risks,
        whyMatters: downstream.beneficiaries.length ? `downstream 수혜: ${downstream.beneficiaries.slice(0, 3).join(', ')}`
          : downstream.risks.length ? `upstream 리스크: ${downstream.risks.slice(0, 3).join(', ')}` : undefined,
      });
    }
  }
  return signals;
}

// ── 공급망 그래프 추론: 특정 ticker + signalType → 연관 ticker 도출 ─────────────
function inferDownstream(ticker: string, signalType: string): { beneficiaries: string[]; risks: string[] } {
  const beneficiaries: string[] = [];
  const risks: string[] = [];
  const tk = ticker.toUpperCase();

  for (const pattern of cascadePatterns) {
    const step = pattern.sequence.find(s => s.ticker.toUpperCase() === tk);
    if (!step) continue;

    if (step.role === 'leader') {
      // 리더가 긍정 신호 → 팔로워 수혜
      const followers = pattern.sequence.filter(s => s.role !== 'leader').map(s => s.ticker);
      if (['contract_win', 'order_momentum', 'supply_expansion', 'partnership'].includes(signalType)) {
        beneficiaries.push(...followers.slice(0, 3));
      } else {
        risks.push(...followers.slice(0, 3));
      }
    } else if (step.role === 'first_follower' || step.role === 'mid_cap') {
      // 공급업체가 긍정 신호 → 리더(고객) 수혜 추론
      if (['supply_expansion'].includes(signalType)) {
        beneficiaries.push(pattern.leaderTicker);
      }
    }
  }

  return {
    beneficiaries: Array.from(new Set(beneficiaries)).filter(t => t !== tk).slice(0, 4),
    risks: Array.from(new Set(risks)).filter(t => t !== tk).slice(0, 3),
  };
}

// ── GET 핸들러 ─────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === '1';

  const redis = createRedis();

  // 캐시 확인
  if (!force && redis) {
    try {
      const cached = await redis.get(CACHE_KEY) as SupplyChainSignal[] | null;
      if (cached) {
        const liveCount = cached.filter(s => s.source === 'sec-8k' || s.source === 'dart').length;
        const topSource = liveCount > 0 ? (liveCount === cached.length ? 'live' : 'mixed') : 'static';
        return NextResponse.json({ signals: cached, cached: true, source: topSource, liveCount, totalCount: cached.length }, { headers: CDN_HEADERS });
      }
    } catch { /* non-fatal */ }
  }

  // 병렬 수집
  const [edgarAtomSignals, dartSignals] = await Promise.all([
    fetchEdgar8KAtom(),
    fetchDartSignals(),
  ]);
  const staticSignals = getStaticSignals();

  // 병합 + conviction 정렬 + 중복 제거
  const all = (edgarAtomSignals as SupplyChainSignal[])
    .concat(dartSignals)
    .concat(staticSignals);
  const seen = new Set<string>();
  const deduped = all.filter(s => {
    const key = `${s.ticker}:${s.headline.slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.conviction - a.conviction).slice(0, 30);

  logger.info('supply-chain-signals', 'collected', {
    edgar: edgarAtomSignals.length,
    dart: dartSignals.length,
    static: staticSignals.length,
    total: deduped.length,
  });

  if (redis) {
    await loggedRedisSet(redis, 'supply-chain-signals', CACHE_KEY, deduped, { ex: CACHE_TTL });
  }

  // top-level source: live(전부 외부) / mixed(일부) / static(전부 cascade-update or cascade-inference)
  const liveSignalCount = deduped.filter(s => s.source === 'sec-8k' || s.source === 'dart').length;
  const topSource = liveSignalCount > 0 ? (liveSignalCount === deduped.length ? 'live' : 'mixed') : 'static';
  return NextResponse.json({
    signals: deduped, cached: false, count: deduped.length,
    source: topSource, liveCount: liveSignalCount, totalCount: deduped.length,
  }, { headers: CDN_HEADERS });
}
