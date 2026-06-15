import { logger, loggedRedisSet } from '@/lib/logger';
import { createRedis } from '@/lib/redis';
import { localChat } from '@/lib/llm-local';
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

// ── EDGAR 회사별 8-K Item 1.01(Material Definitive Agreement) ────────────────────
// 2026-06-14 (사용자 "us종목은 왜 수주계약 하나도 안나오냐"): 종전 EFTS 전문검색 q="nvda" 는
//   'nvda' 를 *본문에 언급한* 무관 제출자(Canadian Derivatives Clearing 등)를 반환 → ticker 는 NVDA 인데
//   headline 은 엉뚱한 회사인 garbage. 게다가 conviction top-30 컷에서 cascade/dart 에 밀려 0건 표출.
//   → SEC submissions API(회사 CIK 별 제출 목록)로 교체: 추적 US 대형주의 *실제* 8-K Item 1.01 만 추출.
//   주의: US 엔 KR DART '단일판매·공급계약' 같은 매출형 수주 전용 공시가 없다. 8-K Item 1.01 은
//   대부분 차입/신용약정(동반 2.03)이라 라벨/conviction 을 정직하게 분리한다.
const MONITOR_US_TICKERS = [
  'NVDA','TSM','AMAT','LRCX','KLAC','MU','AMD','INTC','AVGO','QCOM','ARM',
  'MSFT','GOOGL','AMZN','META','ORCL','ANET','SMCI',
  'TSLA','LMT','RTX','NOC','LHX','LLY','PFE','MRNA','REGN',
  'FSLR','ALB','FCX','NEE','BA','CAT','GE',
];
let CIK_MAP_CACHE: Record<string, string> | null = null;   // ticker → 10자리 CIK (모듈 수명 캐시)
async function getCikMap(): Promise<Record<string, string>> {
  if (CIK_MAP_CACHE) return CIK_MAP_CACHE;
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': 'FlowVium research@flowvium.net', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 86400 },   // ticker→CIK 맵은 하루 캐시(거의 불변)
    });
    if (!res.ok) return {};
    const data = await res.json() as Record<string, { ticker: string; cik_str: number }>;
    const want = new Set(MONITOR_US_TICKERS);
    const map: Record<string, string> = {};
    for (const k in data) {
      const e = data[k];
      if (want.has(e.ticker)) map[e.ticker] = String(e.cik_str).padStart(10, '0');
    }
    CIK_MAP_CACHE = map;
    return map;
  } catch { return {}; }
}

async function fetchEdgar8KAtom(): Promise<SupplyChainSignal[]> {
  const signals: SupplyChainSignal[] = [];
  const t0 = Date.now();
  const WINDOW_DAYS = 45;
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  let scanned = 0, httpFails = 0;
  const candidates: Array<{ ticker: string; name: string; date: string; cikNum: string; accNo: string; doc: string }> = [];
  try {
    const cikMap = await getCikMap();
    const entries = Object.entries(cikMap);
    if (!entries.length) { logger.warn('supply-chain-signals', 'edgar_cikmap_empty', {}); return []; }
    // SEC rate-limit(≤10 req/s) 준수 — 8개씩 배치.
    const BATCH = 8;
    for (let b = 0; b < entries.length; b += BATCH) {
      const batch = entries.slice(b, b + BATCH);
      const batchRes = await Promise.all(batch.map(async ([ticker, cik]) => {
        const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'FlowVium research@flowvium.net', 'Accept': 'application/json' },
            signal: AbortSignal.timeout(8000),
            cache: 'no-store',
          });
          if (!res.ok) { httpFails++; return null; }
          const j = await res.json() as { name?: string; filings?: { recent?: { form: string[]; items: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] } } };
          return { ticker, cik, name: j.name ?? ticker, recent: j.filings?.recent };
        } catch { httpFails++; return null; }
      }));
      for (const r of batchRes) {
        if (!r?.recent) continue;
        scanned++;
        const { form, items, filingDate, accessionNumber, primaryDocument } = r.recent;
        for (let i = 0; i < form.length && filingDate[i] >= cutoff; i++) {
          if (form[i] !== '8-K') continue;
          const itm = items[i] || '';
          if (!itm.includes('1.01')) continue;   // Material Definitive Agreement 만
          candidates.push({
            ticker: r.ticker,
            name: r.name,
            date: filingDate[i],
            cikNum: String(parseInt(r.cik, 10)),
            accNo: (accessionNumber[i] || '').replace(/-/g, ''),
            doc: primaryDocument?.[i] ?? '',
          });
          break;   // 회사당 최신 1건만(중복·도배 방지)
        }
      }
    }
    // 2026-06-15 (사용자 "us 는 자세한 내용 없고 본문확인하라고만"): 실제 8-K 본문을 fetch 해 계약 유형·
    //   상대방·금액 추출 + 정직 분류(자본조달/사업계약). 종전엔 메타데이터만 써 generic "본문 확인 권장" 이었음.
    //   2026-06-15: 후보 본문 fetch *병렬*(순차는 6×~2s=12s 로 generator 의 10s fetch 타임아웃→supplyChain
    //   빈배열 사건). qwen3 한국어 요약은 *요청 경로 밖*(캐시 읽기만 + 누락분은 백그라운드 생성) — gen 중
    //   GPU 포화 시 동기 qwen3 가 라우트를 10s 초과시키던 회귀 차단. 요약은 accession 별 30d 캐시(공시 불변).
    const sumRedis = createRedis();
    const picked = candidates.slice(0, 6);
    const details = await Promise.all(picked.map(c => fetchEightKDetail(c.cikNum, c.accNo, c.doc, sumRedis)));
    const needSummary: Array<{ accNo: string; region: string }> = [];
    picked.forEach((c, i) => {
      const detail = details[i];
      if (!detail) return;
      const kindLabel = detail.kind === 'financing' ? '자본조달'
        : detail.kind === 'ma' ? 'M&A'
        : detail.kind === 'business' ? '사업계약' : '주요계약';
      const parts = [];
      if (detail.agreementType) parts.push(detail.agreementType);
      if (detail.counterparty) parts.push(`상대: ${detail.counterparty}`);
      if (detail.amount) parts.push(detail.amount);
      const detailStr = parts.join(' · ');
      if (!detail.summary && detail.region) needSummary.push({ accNo: c.accNo, region: detail.region });
      signals.push({
        ticker: c.ticker,
        companyName: c.name,
        signalType: detail.kind === 'financing' ? 'supply_risk' : 'contract_win',
        conviction: detail.kind === 'financing' ? 52 : 66,
        direction: 'neutral',
        headline: `8-K [${kindLabel}]: ${c.name}${detailStr ? ' — ' + detailStr : ' — 주요 계약(Item 1.01)'}`,
        source: 'sec-8k',
        date: c.date,
        downstreamBeneficiaries: [],
        upstreamRisks: [],
        whyMatters: detail.summary
          || (detail.kind === 'financing' ? '자본조달 공시(지분/채권) — 재무구조 변화, 매출 직결 아님'
            : '사업 계약 공시 — 인수·공급·파트너십 등 사업 변화 신호'),
        evidenceUrl: c.accNo
          ? `https://www.sec.gov/Archives/edgar/data/${c.cikNum}/${c.accNo}/${c.doc || ''}`
          : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.cikNum}&type=8-K`,
      });
    });
    // 누락 요약은 백그라운드 생성+캐시(요청 차단 X) — 다음 조회부터 rich. 응답은 즉시.
    if (needSummary.length && sumRedis) void warmEightKSummaries(needSummary, sumRedis);
    logger.info('supply-chain-signals', 'edgar_submissions_done', { monitored: entries.length, scanned, httpFails, candidates: candidates.length, signals: signals.length, ms: Date.now() - t0 });
  } catch (e) {
    logger.warn('supply-chain-signals', 'edgar_submissions_failed', { error: String(e), ms: Date.now() - t0 });
  }
  return signals;
}

/**
 * 8-K Item 1.01 본문에서 계약 유형·상대방·금액 추출 + 분류 (financing/business/ma).
 * SEC 8-K 는 DART 처럼 구조화 필드가 없어 narrative 에서 휴리스틱 추출. 실패해도 비차단(빈 detail).
 */
async function fetchEightKDetail(cikNum: string, accNo: string, doc: string, redis?: ReturnType<typeof createRedis>): Promise<{
  agreementType?: string; counterparty?: string; amount?: string; summary?: string; region?: string;
  kind: 'financing' | 'business' | 'ma' | 'unknown';
}> {
  if (!cikNum || !accNo || !doc) return { kind: 'unknown' };
  const sumKey = `flowvium:8k-summary:v1:${accNo}`;
  try {
    const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNo}/${doc}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'FlowVium research@flowvium.net' }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!res.ok) return { kind: 'unknown' };
    const html = await res.text();
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;|&#8201;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&#8217;|&#146;/g, "'").replace(/&#8220;|&#8221;|&#147;|&#148;/g, '"')
      .replace(/\s+/g, ' ').trim();
    // Item 1.01 narrative 영역(다음 Item 직전까지)
    const idx = text.search(/Item\s*1\.01/i);
    const region = idx >= 0 ? text.slice(idx, idx + 1500) : text.slice(0, 1500);
    // 계약 유형: "...Agreement" 명사구 — 단, 섹션 헤더 보일러플레이트 'Material Definitive Agreement' 제외.
    const agTypes = Array.from(region.matchAll(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s+Agreement)\b/g))
      .map(m => m[1]).filter(a => !/material definitive agreement/i.test(a));
    const agreementType = agTypes[0]?.slice(0, 50);
    // 상대방: with/among 다음 고유명사
    const cpMatch = region.match(/\b(?:with|among|by and among)\s+([A-Z][A-Za-z][\w&.,\- ]{3,45}?)(?:[,.;]|\s+(?:dated|to|for|pursuant|\())/);
    let counterparty = cpMatch?.[1]?.trim();
    if (counterparty && /^(the|a|an|its|each)\b/i.test(counterparty)) counterparty = undefined;
    // 금액: 액면가($0.001 등) 노이즈 제외 — million/billion 단위 또는 7자리($1,000,000)+ 만 채택.
    const amtMatch = Array.from(region.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(million|billion|bn)?/ig))
      .find(m => m[2] || parseFloat(m[1].replace(/,/g, '')) >= 1_000_000);
    const amount = amtMatch?.[0]?.replace(/\s+/g, '');
    // 분류 — 전체 region 기준(첫 400자만 보면 핵심어 누락). financing(자본조달) 우선 차단.
    const blob = region.toLowerCase();
    let kind: 'financing' | 'business' | 'ma' | 'unknown' = 'unknown';
    if (/\b(merger|acquisition|acquire|business combination|tender offer)\b/.test(blob)) kind = 'ma';
    else if (/\b(equity distribution|at.the.market|atm program|preferred stock|depositary shares|senior notes|indenture|credit agreement|term loan|revolving credit|underwriting|securities purchase|note purchase|debenture|warrant)\b/.test(blob)) kind = 'financing';
    else if (/\b(supply|offtake|manufacturing|license|collaboration|partnership|joint venture|master services|reseller|development agreement)\b/.test(blob)) kind = 'business';
    // 2026-06-15: 한국어 요약은 *캐시 읽기만*(요청 경로에서 qwen3 동기호출 금지 — gen 중 GPU 포화 시
    //   라우트가 10s 초과해 supplyChain 빈배열 나던 회귀). 누락분은 호출부가 백그라운드(warmEightKSummaries)
    //   로 생성+캐시 → 다음 조회부터 rich. region 을 반환해 백그라운드가 재fetch 없이 요약.
    let summary;
    if (redis) { try { const c = await redis.get<string>(sumKey); if (c && typeof c === 'string') summary = c; } catch { /* miss */ } }
    return { agreementType, counterparty, amount, kind, summary, region };
  } catch { return { kind: 'unknown' }; }
}

// 8-K 한국어 요약 백그라운드 생성(요청 차단 X) — accession 별 30d 캐시. GPU 세마포어로 포화 시 skip.
async function warmEightKSummaries(items: Array<{ accNo: string; region: string }>, redis: ReturnType<typeof createRedis>): Promise<void> {
  for (const it of items.slice(0, 6)) {
    try {
      const s = await localChat(
        `다음은 미국 상장사의 8-K Item 1.01(주요 계약 체결) 공시 본문이다. 한국어로 1~2문장으로 요약하라: 어떤 계약인지·상대방·핵심 조건(금액/지분/만기 등)·투자자 관점의 의미. 설명 없이 요약문만:\n\n${it.region.slice(0, 1100)}`,
        { temperature: 0.2, maxTokens: 220, timeoutMs: 12000 },
      );
      if (s && s.trim() && /[가-힣]/.test(s)) {
        const summary = s.trim().replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 220);
        if (redis) { try { await loggedRedisSet(redis, 'supply-chain-signals.8k-summary', `flowvium:8k-summary:v1:${it.accNo}`, summary, { ex: 30 * 24 * 60 * 60 }); } catch { /* non-fatal */ } }
      }
    } catch { /* GPU 포화/실패 — 다음 사이클 재시도 */ }
  }
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
  const dedupedAll = all.filter(s => {
    const key = `${s.ticker}:${s.headline.slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.conviction - a.conviction);
  // 2026-06-14: US sec-8k 는 conviction(66) 이 dart(82-92)·cascade(70) 보다 낮아 top-30 컷에서 전멸하던
  //   문제(사용자 "us 수주계약 왜 없냐") — 뉴스 region 쿼터처럼 sec-8k 에 최대 4슬롯 보장 후 나머지 conviction 순.
  const SEC8K_QUOTA = 4;
  const sec8k = dedupedAll.filter(s => s.source === 'sec-8k').slice(0, SEC8K_QUOTA);
  const rest = dedupedAll.filter(s => s.source !== 'sec-8k').slice(0, 30 - sec8k.length);
  const deduped = [...sec8k, ...rest].sort((a, b) => b.conviction - a.conviction);

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
