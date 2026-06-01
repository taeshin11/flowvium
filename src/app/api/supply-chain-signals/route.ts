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
  // 2026-06-02: KR 주요 종목 — DART 수시공시 supply-chain 신호 대상 (이전엔 KR 미감시).
  '005930.KS','000660.KS','005380.KS','000270.KS','035420.KS','035720.KS',
  '005490.KS','051910.KS','006400.KS','373220.KS','068270.KS','207940.KS','012330.KS','066570.KS',
]);

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
  // 2026-06-02: KR — DART corp_name 은 한글(소문자 무관) → 한글/혼합 substring 키 추가.
  //   이전엔 영어 키('sk hynix')만 있어 한글 공시명("삼성전자")이 매칭 안 돼 전량 드롭.
  '삼성전자': '005930.KS', '하이닉스': '000660.KS', '현대차': '005380.KS', '현대자동차': '005380.KS',
  '기아': '000270.KS', '네이버': '035420.KS', 'naver': '035420.KS', '카카오': '035720.KS',
  'posco': '005490.KS', '포스코': '005490.KS', 'lg화학': '051910.KS', '삼성sdi': '006400.KS',
  'lg에너지솔루션': '373220.KS', 'lg엔솔': '373220.KS', '셀트리온': '068270.KS',
  '삼성바이오': '207940.KS', '현대모비스': '012330.KS', 'lg전자': '066570.KS',
};

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
  signalType: 'contract_win' | 'contract_loss' | 'order_momentum' | 'supply_expansion' | 'supply_risk' | 'partnership';
  conviction: number;       // 0-100
  direction: 'positive' | 'negative' | 'neutral';
  headline: string;
  source: 'sec-8k' | 'dart' | 'cascade-update' | 'cascade-inference' | 'satellite';
  date: string;
  downstreamBeneficiaries?: string[];   // 공급망 그래프에서 추론한 downstream 수혜 티커
  upstreamRisks?: string[];            // upstream 리스크 티커
  evidenceUrl?: string;
}

// ── SEC EDGAR 8-K Atom 피드 파싱 ──────────────────────────────────────────────
async function fetchEdgar8K(): Promise<SupplyChainSignal[]> {
  const signals: SupplyChainSignal[] = [];
  try {
    // EDGAR full-text search for 8-K contract-related filings (last 3 days)
    const today = new Date();
    const startDt = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22Material+Definitive+Agreement%22&dateRange=custom&startdt=${startDt}&forms=8-K&hits.hits._source=file_date,entity_name,file_num,period_of_report`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FlowviumBot contact@flowvium.net' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) { logger.warn('supply-chain-signals', 'edgar_http_error', { status: res.status }); return []; }
    const data = await res.json() as { hits?: { hits?: Array<{ _source?: { entity_name?: string; file_date?: string; period_of_report?: string }; _id?: string }> } };
    const hits = data.hits?.hits ?? [];

    for (const hit of hits.slice(0, 20)) {
      const entityName = hit._source?.entity_name?.toLowerCase() ?? '';
      const fileDate = hit._source?.file_date ?? today.toISOString().slice(0, 10);
      const filingId = hit._id ?? '';

      // 감시 티커와 매칭
      const ticker = Object.entries(NAME_TO_TICKER).find(([name]) => entityName.includes(name))?.[1];
      if (!ticker || !WATCHLIST_TICKERS.has(ticker)) continue;

      // 공시 제목에서 신호 분류
      const headlineRaw = hit._source?.entity_name ?? entityName;
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
    const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${dartKey}&bgn_de=${bgn}&pblntf_ty=B&page_count=40`;
    logger.info('supply-chain-signals', 'dart_start', { bgn });
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!res.ok) {
      logger.warn('supply-chain-signals', 'dart_http_error', { status: res.status, ms: Date.now() - t0 });
      return [];
    }
    const data = await res.json() as { status?: string; message?: string; list?: Array<{ corp_name?: string; report_nm?: string; rcept_dt?: string; rcept_no?: string }> };

    if (data.status && data.status !== '000') {
      logger.warn('supply-chain-signals', 'dart_api_error', { status: data.status, message: data.message });
      return [];
    }

    const list = data.list ?? [];
    logger.info('supply-chain-signals', 'dart_fetched', { total: list.length, ms: Date.now() - t0 });

    let contractCount = 0;
    let watchlistHits = 0;
    for (const item of list.slice(0, 30)) {
      const reportNm = item.report_nm ?? '';
      const corpName = (item.corp_name ?? '').toLowerCase();

      if (!/계약|수주|공급|협약|협력|MOU|LOI|합작/i.test(reportNm)) continue;
      contractCount++;

      const ticker = Object.entries(NAME_TO_TICKER).find(([name]) => corpName.includes(name))?.[1];
      if (!ticker) {
        logger.debug('supply-chain-signals', 'dart_no_ticker_match', { corp: item.corp_name, reportNm: reportNm.slice(0, 60) });
        continue;
      }
      watchlistHits++;

      const signalType: SupplyChainSignal['signalType'] = /해제|취소|손실/i.test(reportNm) ? 'contract_loss' : 'contract_win';
      const downstream = inferDownstream(ticker, signalType);
      logger.info('supply-chain-signals', 'dart_signal_found', {
        ticker, signalType, corp: item.corp_name,
        downstream: downstream.beneficiaries.join(','),
        reportNm: reportNm.slice(0, 80),
        date: item.rcept_dt,
      });

      signals.push({
        ticker,
        companyName: item.corp_name ?? '',
        signalType,
        conviction: 75,
        direction: signalType === 'contract_loss' ? 'negative' : 'positive',
        headline: reportNm,
        source: 'dart',
        date: item.rcept_dt ?? '',
        downstreamBeneficiaries: downstream.beneficiaries,
        evidenceUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`,
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

// ── 위성 활동 신호 → SupplyChainSignal 변환 ─────────────────────────────────
interface SatelliteResult {
  id: string; ticker: string; name: string; country: string; tags: string[];
  significance: string; activityScore: number | null; confidence: string | null;
  deltaFromBaseline: number | null; baselineScore: number | null; trend: string | null;
  constructionVisible: boolean | null; loadingActivity: string | null; summary: string | null;
  imageDate: string | null;
}

async function fetchSatelliteSignals(redis: ReturnType<typeof createRedis>): Promise<SupplyChainSignal[]> {
  const signals: SupplyChainSignal[] = [];
  try {
    // 최근 5일 데이터 탐색
    for (let d = 0; d <= 5; d++) {
      const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
      const key = `flowvium:satellite:v1:${date}`;
      const raw = await redis?.get<string>(key);
      if (!raw) continue;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const results: SatelliteResult[] = parsed.results ?? [];

      for (const r of results) {
        if (r.activityScore == null || r.confidence === 'low') continue;

        // 방법 1: delta baseline (히스토리 충분할 때)
        const absDelta = Math.abs(r.deltaFromBaseline ?? 0);
        if (r.deltaFromBaseline != null && absDelta >= 15) {
          const isPositive = r.deltaFromBaseline > 0;
          const downstream = inferDownstream(r.ticker, isPositive ? 'supply_expansion' : 'supply_risk');
          signals.push({
            ticker: r.ticker,
            companyName: r.name,
            signalType: isPositive ? 'supply_expansion' : 'supply_risk',
            conviction: Math.min(85, 45 + absDelta),
            direction: isPositive ? 'positive' : 'negative',
            headline: `[위성] ${r.name} 활동지수 ${r.deltaFromBaseline > 0 ? '+' : ''}${r.deltaFromBaseline}p vs 4주 평균 (현재 ${r.activityScore}/100)`,
            source: 'satellite',
            date: r.imageDate ?? date,
            downstreamBeneficiaries: downstream.beneficiaries,
            upstreamRisks: downstream.risks,
            evidenceUrl: '/satellite',
          });
          continue;
        }

        // 방법 2: 절대 점수 기준 (히스토리 없을 때)
        if (r.activityScore >= 80 && r.significance === 'critical') {
          const downstream = inferDownstream(r.ticker, 'supply_expansion');
          signals.push({
            ticker: r.ticker,
            companyName: r.name,
            signalType: 'supply_expansion',
            conviction: 55,
            direction: 'positive',
            headline: `[위성] ${r.name} 고활동 감지 (${r.activityScore}/100${r.constructionVisible ? ', 신규공사 확인' : ''})`,
            source: 'satellite',
            date: r.imageDate ?? date,
            downstreamBeneficiaries: downstream.beneficiaries,
            upstreamRisks: downstream.risks,
            evidenceUrl: '/satellite',
          });
        } else if (r.activityScore <= 20 && r.significance === 'critical') {
          const downstream = inferDownstream(r.ticker, 'supply_risk');
          signals.push({
            ticker: r.ticker,
            companyName: r.name,
            signalType: 'supply_risk',
            conviction: 50,
            direction: 'negative',
            headline: `[위성] ${r.name} 저활동 감지 (${r.activityScore}/100) — 생산 둔화 가능성`,
            source: 'satellite',
            date: r.imageDate ?? date,
            downstreamBeneficiaries: downstream.beneficiaries,
            upstreamRisks: downstream.risks,
            evidenceUrl: '/satellite',
          });
        }
      }
      break; // 최신 날짜 데이터 찾으면 종료
    }
  } catch (e) {
    logger.warn('supply-chain-signals', 'satellite_fetch_failed', { error: String(e) });
  }
  return signals;
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
        const liveCount = cached.filter(s => s.source === 'sec-8k' || s.source === 'dart' || s.source === 'satellite').length;
        const topSource = liveCount > 0 ? (liveCount === cached.length ? 'live' : 'mixed') : 'static';
        return NextResponse.json({ signals: cached, cached: true, source: topSource, liveCount, totalCount: cached.length }, { headers: CDN_HEADERS });
      }
    } catch { /* non-fatal */ }
  }

  // 병렬 수집 (위성 신호 포함)
  const [edgarAtomSignals, dartSignals, satelliteSignals] = await Promise.all([
    fetchEdgar8KAtom(),
    fetchDartSignals(),
    fetchSatelliteSignals(redis),
  ]);
  const staticSignals = getStaticSignals();

  // 병합 + conviction 정렬 + 중복 제거
  const all = (edgarAtomSignals as SupplyChainSignal[])
    .concat(dartSignals)
    .concat(satelliteSignals)  // 위성 신호
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
    satellite: satelliteSignals.length,
    static: staticSignals.length,
    total: deduped.length,
  });

  if (redis) {
    await loggedRedisSet(redis, 'supply-chain-signals', CACHE_KEY, deduped, { ex: CACHE_TTL });
  }

  // top-level source: live(전부 외부) / mixed(일부) / static(전부 cascade-update or cascade-inference)
  const liveSignalCount = deduped.filter(s => s.source === 'sec-8k' || s.source === 'dart' || s.source === 'satellite').length;
  const topSource = liveSignalCount > 0 ? (liveSignalCount === deduped.length ? 'live' : 'mixed') : 'static';
  return NextResponse.json({
    signals: deduped, cached: false, count: deduped.length,
    source: topSource, liveCount: liveSignalCount, totalCount: deduped.length,
  }, { headers: CDN_HEADERS });
}
