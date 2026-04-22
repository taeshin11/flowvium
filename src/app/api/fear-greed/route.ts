import { logger, loggedRedisSet} from '@/lib/logger';
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

// 엣지 CDN 캐시 우회 — 실제 캐시는 Redis(4h)로 관리. 엣지 캐시가 stale 응답을
// 홀딩하면 v4 bump 같은 긴급 픽스가 즉시 반영되지 않음.
export const dynamic = 'force-dynamic';

const CACHE_TTL = 4 * 60 * 60; // 4 hours

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// ── CNN Fear & Greed (US only) ─────────────────────────────────────────────────
// CNN endpoint blocks minimal UA with HTTP 418 (since ~Q4 2025). Full browser
// headers (UA + Referer + Origin + Accept-Language) are required to get 200.
async function fetchCNNScore(): Promise<{ score: number; prevScore: number } | null> {
  const start = Date.now();
  try {
    const res = await fetch(
      'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://edition.cnn.com/markets/fear-and-greed',
          'Origin': 'https://edition.cnn.com',
        },
        signal: AbortSignal.timeout(6000),
        // CRITICAL: Next.js App Router 의 fetch 기본값은 force-cache — CNN 응답이
        // 무기한 cache 되어 stale previous_close 가 score 자리로 표시되는 실제 버그
        // 발생했음 (2026-04-22: 우리 표시 70 = CNN previous_close 69.94, 실 score 67.57).
        cache: 'no-store',
      }
    );
    if (!res.ok) {
      logger.warn('fear-greed', 'cnn_http_error', { status: res.status, durationMs: Date.now() - start });
      return null;
    }
    const data = await res.json();
    // CNN publishes fractional score (e.g. 69.94) — round at read time.
    const rawScore = data?.fear_and_greed?.score;
    if (rawScore == null) {
      logger.warn('fear-greed', 'cnn_score_missing', { durationMs: Date.now() - start });
      return null;
    }
    const score = Math.round(rawScore);
    // Previous score: prefer CNN's own previous_1_week field, fallback to historical scan.
    let prevScore: number;
    const prev1wk = data?.fear_and_greed?.previous_1_week;
    if (typeof prev1wk === 'number') {
      prevScore = Math.round(prev1wk);
    } else {
      const hist: Array<{ x: number; y: number }> =
        data?.fear_and_greed_historical?.data ?? [];
      const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weekAgoEntry = hist.find((d) => Math.abs(d.x - weekAgoMs) < 2 * 24 * 60 * 60 * 1000);
      prevScore = weekAgoEntry ? Math.round(weekAgoEntry.y) : score;
    }
    logger.info('fear-greed', 'cnn_ok', { score, prevScore, durationMs: Date.now() - start });
    return { score, prevScore };
  } catch (err) {
    logger.error('fear-greed', 'cnn_fetch_failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ── Yahoo Finance price data ───────────────────────────────────────────────────
// Vercel IP가 Yahoo에 블록되면 query1이 401/429로 실패 가능 — query2로 자동 폴백.
// 두 도메인 모두 실패하면 throw (상위에서 error 로깅 + composite fallback).
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
};

async function fetchPricesFromHost(host: 'query1' | 'query2', ticker: string): Promise<number[]> {
  const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=180d`;
  // cache: 'no-store' — Next.js App Router fetch 기본 force-cache 방지.
  // 가격 시계열이 stale 되면 전체 composite 가 오래된 값 반환.
  const res = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!res.ok) throw new Error(`Yahoo ${host} HTTP ${res.status}`);
  const data = await res.json();
  const closes: number[] = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  return closes.filter((v: number) => v != null && !isNaN(v));
}

async function fetchPrices(ticker: string): Promise<number[]> {
  const t0 = Date.now();
  let clean: number[] = [];
  let lastError: Error | null = null;
  for (const host of ['query1', 'query2'] as const) {
    try {
      clean = await fetchPricesFromHost(host, ticker);
      if (host === 'query2') {
        // query1 실패 후 query2로 복구한 경우 — warn으로 기록 (Vercel IP 차단 징후)
        logger.warn('fear-greed', 'yahoo_query1_failed_query2_ok', { ticker, durationMs: Date.now() - t0 });
      }
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  if (clean.length === 0) {
    logger.error('fear-greed', 'yahoo_all_hosts_failed', { ticker, error: lastError?.message, durationMs: Date.now() - t0 });
    throw lastError ?? new Error('Yahoo fetch failed');
  }
  if (clean.length < 125) {
    logger.warn('fear-greed', 'yahoo_insufficient_history', { ticker, length: clean.length });
  }
  return clean;
}

// ── 네이티브 지수 블렌딩 (방어적) ─────────────────────────────────────────────
// 국가 ETF(미국 상장, USD)만 쓰면 FX 노이즈가 섞임. 가능하면 현지 원지수도
// 함께 fetch해서 두 composite를 50/50 블렌드. 원지수 실패 시 ETF 단독.
async function fetchNativePrices(nativeTicker: string | null, etfTicker: string): Promise<{ etf: number[]; native: number[] | null }> {
  const etfP = await fetchPrices(etfTicker);
  if (!nativeTicker) return { etf: etfP, native: null };
  try {
    const nativeP = await fetchPrices(nativeTicker);
    return { etf: etfP, native: nativeP };
  } catch (err) {
    logger.warn('fear-greed', 'native_fetch_failed', { nativeTicker, error: err instanceof Error ? err.message : String(err) });
    return { etf: etfP, native: null };
  }
}

// ── CNN-style multi-factor score ──────────────────────────────────────────────
// 각 factor 함수는 {value, ok} 반환. ok=false면 데이터 부족으로 중립값(50)
// 폴백한 것이며 composite에 부분 가중치로 반영됨. buildEntry가 ok 개수로
// dataQuality 라벨링.
type Factor = { value: number; ok: boolean };

// Factor 1: RSI-14 (momentum proxy, 0-100) — 최소 15개 가격 필요
function rsi14(prices: number[]): Factor {
  if (prices.length < 15) return { value: 50, ok: false };
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  let ag = 0, al = 0;
  for (let i = 0; i < 14; i++) {
    if (changes[i] > 0) ag += changes[i];
    else al += Math.abs(changes[i]);
  }
  ag /= 14; al /= 14;
  for (let i = 14; i < changes.length; i++) {
    ag = (ag * 13 + Math.max(changes[i], 0)) / 14;
    al = (al * 13 + Math.max(-changes[i], 0)) / 14;
  }
  if (al === 0) return { value: 100, ok: true };
  return { value: Math.round(100 - 100 / (1 + ag / al)), ok: true };
}

// Factor 2: Price vs 125-day SMA momentum — 최소 125개 가격 필요.
// 정규화 밴드 ±20% (±15% → ±20% 완화: 강세장에서 100 클리핑 빈도 감소).
// 한국·대만·크립토 등이 SMA 대비 +30% 갈 때 차등 구분 가능.
function smaMomentum(prices: number[]): Factor {
  if (prices.length < 125) return { value: 50, ok: false };
  const last = prices[prices.length - 1];
  const sma125 = prices.slice(-125).reduce((a, b) => a + b, 0) / 125;
  const pct = (last - sma125) / sma125;
  return { value: Math.min(100, Math.max(0, Math.round(50 + (pct / 0.20) * 50))), ok: true };
}

// Factor 3: Volatility ratio — 최소 55개 가격 필요
function volatilityScore(prices: number[]): Factor {
  if (prices.length < 55) return { value: 50, ok: false };
  const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
  const recent20 = returns.slice(-20);
  const avg50 = returns.slice(-50);
  const vol20 = Math.sqrt(recent20.reduce((s, r) => s + r * r, 0) / 20);
  const vol50 = Math.sqrt(avg50.reduce((s, r) => s + r * r, 0) / 50);
  const ratio = vol50 > 0 ? vol20 / vol50 : 1;
  return { value: Math.min(100, Math.max(0, Math.round(50 * (2 - ratio)))), ok: true };
}

// Composite: 한 번만 계산해서 단일 score 반환 (prevScore 7일 전 값 계산용)
function compositeScore(prices: number[]): number {
  const r = rsi14(prices).value;
  const m = smaMomentum(prices).value;
  const v = volatilityScore(prices).value;
  return Math.round(r * 0.40 + m * 0.35 + v * 0.25);
}

interface CompositeResult {
  score: number;
  rsiScore: number;
  momentumScore: number;
  volatilityScore: number;
  dataQuality: 'full' | 'partial' | 'insufficient';
  degradedFactors: string[];  // e.g. ['sma'] — UI에 노출
}

function compositeWithFactors(prices: number[], ticker: string): CompositeResult {
  const r = rsi14(prices);
  const m = smaMomentum(prices);
  const v = volatilityScore(prices);
  const degraded: string[] = [];
  if (!r.ok) degraded.push('rsi');
  if (!m.ok) degraded.push('sma');
  if (!v.ok) degraded.push('vol');

  // 3개 모두 ok = full / 일부만 = partial / 전부 실패 = insufficient
  const okCount = [r.ok, m.ok, v.ok].filter(Boolean).length;
  const dataQuality: 'full' | 'partial' | 'insufficient' =
    okCount === 3 ? 'full' : okCount === 0 ? 'insufficient' : 'partial';

  if (dataQuality !== 'full') {
    logger.warn('fear-greed', 'composite_degraded', { ticker, quality: dataQuality, degradedFactors: degraded, priceLen: prices.length });
  }

  return {
    score: Math.round(r.value * 0.40 + m.value * 0.35 + v.value * 0.25),
    rsiScore: r.value,
    momentumScore: m.value,
    volatilityScore: v.value,
    dataQuality,
    degradedFactors: degraded,
  };
}

function getLevel(score: number): string {
  if (score <= 25) return 'extreme-fear';
  if (score <= 40) return 'fear';
  if (score <= 60) return 'neutral';
  if (score <= 75) return 'greed';
  return 'extreme-greed';
}

// ── Configs ───────────────────────────────────────────────────────────────────
// nativeTicker: 있으면 현지 원지수도 병렬 fetch → ETF composite와 50/50 블렌드.
// 원지수 실패 시 ETF 단독 (dataQuality='partial'로 마킹).
interface CountryETF { id: string; ticker: string; nativeTicker: string | null; flag: string; label: string; useCNN?: boolean; }
const COUNTRY_ETFS: CountryETF[] = [
  { id: 'us',        ticker: 'SPY',  nativeTicker: null,       flag: '🇺🇸', label: 'United States', useCNN: true },
  { id: 'korea',     ticker: 'EWY',  nativeTicker: '^KS11',    flag: '🇰🇷', label: '한국 (Korea)' },        // KOSPI
  { id: 'japan',     ticker: 'EWJ',  nativeTicker: '^N225',    flag: '🇯🇵', label: '日本 (Japan)' },        // Nikkei 225
  { id: 'china',     ticker: 'FXI',  nativeTicker: '000300.SS', flag: '🇨🇳', label: '中国 (China)' },        // CSI 300
  { id: 'europe',    ticker: 'VGK',  nativeTicker: '^STOXX50E', flag: '🇪🇺', label: 'Europe (EU)' },         // Euro Stoxx 50
  { id: 'uk',        ticker: 'EWU',  nativeTicker: '^FTSE',    flag: '🇬🇧', label: 'United Kingdom' },      // FTSE 100
  { id: 'india',     ticker: 'INDA', nativeTicker: '^BSESN',   flag: '🇮🇳', label: 'भारत (India)' },         // BSE Sensex
  { id: 'brazil',    ticker: 'EWZ',  nativeTicker: '^BVSP',    flag: '🇧🇷', label: 'Brasil' },               // Bovespa
  { id: 'taiwan',    ticker: 'EWT',  nativeTicker: '^TWII',    flag: '🇹🇼', label: '台灣 (Taiwan)' },        // TWSE Weighted
  { id: 'australia', ticker: 'EWA',  nativeTicker: '^AXJO',    flag: '🇦🇺', label: 'Australia' },            // ASX 200
];

const ASSET_ETFS = [
  { id: 'gold',        ticker: 'GLD',  flag: '🥇', label: 'Gold' },
  { id: 'defense',     ticker: 'ITA',  flag: '🛡️', label: 'Defense' },
  { id: 'tech',        ticker: 'QQQ',  flag: '💻', label: 'Tech / AI' },
  { id: 'bonds',       ticker: 'TLT',  flag: '📊', label: 'Bonds (20Y)' },
  { id: 'reits',       ticker: 'VNQ',  flag: '🏢', label: 'REITs' },
  { id: 'energy',      ticker: 'XLE',  flag: '⚡', label: 'Energy' },
  { id: 'biotech',     ticker: 'IBB',  flag: '🧬', label: 'Biotech' },
  { id: 'commodities', ticker: 'DJP',  flag: '🌾', label: 'Commodities' },
  { id: 'financials',  ticker: 'XLF',  flag: '🏦', label: 'Financials' },
  { id: 'crypto',      ticker: 'BITO', flag: '₿',  label: 'Crypto (BTC)' },
];

const driverMap: Record<string, string> = {
  SPY:  'S&P500 momentum · VIX · put/call ratio',
  EWY:  'KOSPI · KRW/USD · Samsung HBM',
  EWJ:  'Nikkei · BOJ policy · yen carry',
  FXI:  'CSI300 · PBOC stimulus · AI subsidy',
  VGK:  'Euro Stoxx · ECB · tariff retaliation',
  EWU:  'FTSE100 · BOE · stagflation risk',
  INDA: 'Nifty50 · FII inflows · INR',
  EWZ:  'Bovespa · Selic rate · commodity',
  EWT:  'TWSE · TSMC · strait risk',
  EWA:  'ASX200 · RBA · China trade',
  GLD:  'Gold spot · central bank buying · DXY',
  ITA:  'Defense contracts · NATO budget · M&A',
  QQQ:  'Nasdaq-100 · Mag7 earnings · AI capex',
  TLT:  '20Y Treasury · Fed rate path · duration',
  VNQ:  'REIT cap rates · office vacancy · refi',
  XLE:  'WTI/Brent · rig count · OPEC+',
  IBB:  'Biotech pipeline · FDA calendar · M&A',
  DJP:  'Bloomberg Commodity Index · supply chains',
  XLF:  'Bank earnings · NIM · yield curve',
  BITO: 'BTC price · funding rates · dominance',
};

// 요소별 상세 설명 — 실제 계산에 사용하는 기초자산을 정직하게 표기.
// ETF(USD)와 원지수(현지통화) 블렌드 = 더 균형잡힌 시그널.
const detailMap: Record<string, { factors: string[]; macro: string; risk: string }> = {
  SPY:  {
    factors: ['SPY RSI-14: 추세 모멘텀 (14일 상승/하락 강도)', 'SPY 125일 SMA 대비 현재가 위치 (추세 강도)', 'SPY 20일 변동성 / 50일 평균 (공포 강도)'],
    macro: 'FOMC 동결 지속·CPI 하락·NFP 강세로 혼재된 신호. 관세 불확실성에도 Mag7 AI 투자 지속으로 탐욕 유지.',
    risk: '고용 강세로 Fed 인하 지연 시 밸류에이션 부담',
  },
  EWY:  {
    factors: ['EWY(iShares 한국, USD) + ^KS11(KOSPI, KRW) 블렌드 RSI-14', 'EWY + KOSPI 125일 SMA 대비 위치 (±20% 정규화)', 'EWY + KOSPI 20일/50일 변동성 비율'],
    macro: 'HBM·AI 반도체 수요로 삼성전자·SK하이닉스 급등. 원/달러 안정화, 외국인 순매수 전환. 수출 회복세.',
    risk: '미중 관세 확전 시 수출 타격, 반도체 사이클 정점 우려',
  },
  EWJ:  {
    factors: ['EWJ(iShares 일본, USD) + ^N225(닛케이 225, JPY) 블렌드 RSI-14', 'EWJ + 닛케이 125일 SMA 대비 위치', 'EWJ + 닛케이 20일/50일 변동성 비율'],
    macro: 'BOJ 추가 금리 인상 신호에 엔 강세 전환. 수출기업 실적 우려 반면 내수 소비 회복. 엔 캐리 청산 리스크.',
    risk: 'BOJ 긴축 가속 시 엔 캐리 청산 → 글로벌 위험자산 동반 하락',
  },
  FXI:  {
    factors: ['FXI(iShares 중국, USD) + 000300.SS(CSI 300, CNY) 블렌드 RSI-14', 'FXI + CSI300 125일 SMA 대비 위치', 'FXI + CSI300 변동성 비율'],
    macro: 'PBOC AI·반도체 보조금 확대, 부동산 추가 부양책 기대. 그러나 미중 관세 140% 지속으로 수출 타격.',
    risk: '부동산 침체 지속, 미중 긴장 고조 시 외국인 자금 이탈',
  },
  VGK:  {
    factors: ['VGK(Vanguard FTSE Europe, USD) + ^STOXX50E(유로스톡스 50) 블렌드 RSI-14', 'VGK + 유로스톡스 125일 SMA 대비', 'VGK + 유로스톡스 변동성 비율'],
    macro: 'ECB 금리 인하 사이클 진입. 유럽 방산 지출 급증. 미국 관세 보복 우려에도 독일 재정 확대 발표.',
    risk: '러-우 지속, 에너지 가격 재상승 시 스태그플레이션',
  },
  EWU:  {
    factors: ['EWU(iShares 영국, USD) + ^FTSE(FTSE 100, GBP) 블렌드 RSI-14', 'EWU + FTSE100 125일 SMA 대비', 'EWU + FTSE 변동성 비율'],
    macro: 'BOE 인하 사이클이나 UK 인플레 재점화 우려. 브렉시트 여파 지속. 에너지·원자재 섹터 비중으로 상대 방어.',
    risk: '스태그플레이션 재현 가능성, 경상수지 적자 지속',
  },
  INDA: {
    factors: ['INDA(iShares 인도, USD) + ^BSESN(BSE Sensex, INR) 블렌드 RSI-14', 'INDA + Sensex 125일 SMA 대비', 'INDA + Sensex 변동성 비율'],
    macro: 'FII 순매수 전환, 인도 제조업 이전(중국+1) 수혜. Modi 정부 인프라 투자 지속. INR 안정.',
    risk: '고평가 밸류에이션, 원자재 수입 의존으로 달러 강세 취약',
  },
  EWZ:  {
    factors: ['EWZ(iShares 브라질, USD) + ^BVSP(Bovespa, BRL) 블렌드 RSI-14', 'EWZ + Bovespa 125일 SMA 대비', 'EWZ + Bovespa 변동성 비율'],
    macro: '상품 수출(철광석·대두) 가격 반등, Selic 고금리 유지. 재정 적자 우려에도 중국 수요 회복 기대.',
    risk: '재정 건전성 악화, 정치 불안, 달러 강세 시 헤알 급락',
  },
  EWT:  {
    factors: ['EWT(iShares 대만, USD) + ^TWII(TWSE 가중, TWD) 블렌드 RSI-14', 'EWT + TWII 125일 SMA 대비', 'EWT + TWII 변동성 비율 (TSMC 비중 높음)'],
    macro: 'TSMC AI 수혜 극대화, CoWoS 패키징 수요 폭발. 그러나 중국 군사훈련 재개 지정학 리스크.',
    risk: '양안 긴장 고조 시 외국인 자금 이탈 속도 빠름',
  },
  EWA:  {
    factors: ['EWA(iShares 호주, USD) + ^AXJO(ASX 200, AUD) 블렌드 RSI-14', 'EWA + ASX200 125일 SMA 대비', 'EWA + ASX200 변동성 비율'],
    macro: 'RBA 인하 기대, 중국 경기 부양으로 자원 수출 수혜. 부동산 시장 과열 우려 상존.',
    risk: '중국 성장 둔화 시 철광석 수출 직격, RBA 긴축 전환',
  },
  GLD:  {
    factors: ['GLD ETF RSI-14', 'GLD vs 125일 SMA', '금 현물 변동성'],
    macro: '중앙은행 금 매입 사상 최고, 달러 약세 기대, 지정학 헤지 수요. 실질금리 하락 기대 복합 작용.',
    risk: 'Fed 인하 지연 → 실질금리 상승 시 금 매력 감소',
  },
  QQQ:  {
    factors: ['Nasdaq-100 RSI-14', 'QQQ vs 125일 SMA', 'AI 테마주 변동성'],
    macro: 'Mag7 AI 투자 지속(MS·구글·아마존 데이터센터 capex 급증), NVDA 실적 기대. 금리 인하 기대에 성장주 멀티플 확장.',
    risk: 'AI 수익화 지연, 고금리 장기화 시 밸류에이션 조정',
  },
  TLT:  {
    factors: ['20Y 국채 ETF RSI-14', '국채 가격 vs 125일 SMA', '금리 변동성 (듀레이션 리스크)'],
    macro: 'FOMC 인하 기대에 장기 채권 매수. 그러나 재정 적자 우려로 장기 금리 하방 제한.',
    risk: '재정 적자 심화, CPI 재가속 시 장기 금리 급등',
  },
  ITA:  {
    factors: ['ITA 방산 ETF RSI-14', '방산 주가 vs 125일 SMA', '지정학 이벤트 변동성'],
    macro: 'NATO 국방비 2% GDP 목표 상향, 유럽 재무장 붐. LMT·RTX·NOC 신규 수주 급증.',
    risk: '지정학 완화 시 수주 감소, 정부 예산 삭감',
  },
  XLE:  {
    factors: ['에너지 섹터 RSI-14', 'XLE vs 125일 SMA', 'WTI/Brent 변동성'],
    macro: 'OPEC+ 감산 유지, 중동 공급 리스크. 중국 수요 회복 기대. 그러나 미국 셰일 생산 증가로 상단 제한.',
    risk: '글로벌 경기 침체 시 수요 급감, OPEC+ 결속 균열',
  },
  IBB:  {
    factors: ['바이오테크 ETF RSI-14', 'IBB vs 125일 SMA', 'FDA 승인 이벤트 변동성'],
    macro: 'GLP-1(비만치료제) 붐 지속, AI 신약 개발 가속. 금리 인하 기대로 무수익 바이오 밸류에이션 회복.',
    risk: 'FDA 임상 실패, Medicare 약가 협상 강화',
  },
  DJP:  {
    factors: ['블룸버그 원자재 지수 RSI-14', 'DJP vs 125일 SMA', '원자재 가격 변동성'],
    macro: '중국 부양책으로 구리·철광석 수요 기대. 에너지 전환으로 구리·리튬 구조적 수요 증가.',
    risk: '달러 강세, 중국 성장 실망 시 원자재 동반 하락',
  },
  VNQ:  {
    factors: ['REIT ETF RSI-14', 'VNQ vs 125일 SMA', '모기지 금리 변동성'],
    macro: 'Fed 인하 기대로 모기지 금리 하락, REIT 배당 매력 회복. 물류·데이터센터 REIT 강세.',
    risk: '금리 인하 지연, 오피스 공실률 상승',
  },
  XLF:  {
    factors: ['금융 섹터 RSI-14', 'XLF vs 125일 SMA', '수익률 곡선 변동성'],
    macro: '은행 NIM 고점 유지, 신용카드 연체율 상승 모니터링. 수익률 곡선 정상화로 마진 회복 기대.',
    risk: '경기침체 시 신용 손실 급증, 상업용 부동산 익스포저',
  },
  BITO: {
    factors: ['비트코인 현물 ETF RSI-14', 'BTC 가격 vs 125일 SMA', '암호화폐 펀딩레이트 변동성'],
    macro: '현물 ETF 승인 후 기관 자금 유입, 반감기 효과. 위험선호 지표로 주식시장과 동조화.',
    risk: '규제 리스크, 거래소 해킹, 리스크오프 시 가장 먼저 매도',
  },
};

/** ETF composite와 원지수 composite를 50/50 블렌드. 원지수 없으면 ETF 단독. */
function blendComposite(etfRes: CompositeResult, nativeRes: CompositeResult | null): CompositeResult {
  if (!nativeRes) {
    return { ...etfRes, degradedFactors: [...etfRes.degradedFactors, 'no_native_index'], dataQuality: etfRes.dataQuality === 'full' ? 'partial' : etfRes.dataQuality };
  }
  const avg = (a: number, b: number) => Math.round((a + b) / 2);
  const merged: CompositeResult = {
    score: avg(etfRes.score, nativeRes.score),
    rsiScore: avg(etfRes.rsiScore, nativeRes.rsiScore),
    momentumScore: avg(etfRes.momentumScore, nativeRes.momentumScore),
    volatilityScore: avg(etfRes.volatilityScore, nativeRes.volatilityScore),
    dataQuality: etfRes.dataQuality === 'full' && nativeRes.dataQuality === 'full' ? 'full' :
                 etfRes.dataQuality === 'insufficient' && nativeRes.dataQuality === 'insufficient' ? 'insufficient' :
                 'partial',
    degradedFactors: Array.from(new Set([...etfRes.degradedFactors, ...nativeRes.degradedFactors])),
  };
  return merged;
}

async function buildEntry(
  id: string, ticker: string, nativeTicker: string | null, flag: string, label: string,
  redis: Redis | null, useCNN = false,
) {
  // v5: ±20% 정규화 + 원지수 블렌딩 + query1/2 fallback (v4는 US만 CNN 정확, 나머지는 ETF 단독)
  const cacheKey = `flowvium:fg:v5:${ticker}`;
  if (redis) {
    try {
      const cached = await redis.get<object>(cacheKey);
      if (cached) return cached;
    } catch { /* non-fatal */ }
  }

  let score: number, prevScore: number;
  let rsiScore = 50, momentumScore = 50, volScore = 50;
  let source: 'cnn' | 'composite' = 'composite';
  let dataQuality: 'full' | 'partial' | 'insufficient' = 'full';
  let degradedFactors: string[] = [];

  if (useCNN) {
    const cnn = await fetchCNNScore();
    if (cnn) {
      score = cnn.score;
      prevScore = cnn.prevScore;
      source = 'cnn';
      try {
        const prices = await fetchPrices(ticker);
        const f = compositeWithFactors(prices, ticker);
        rsiScore = f.rsiScore; momentumScore = f.momentumScore; volScore = f.volatilityScore;
        dataQuality = f.dataQuality; degradedFactors = f.degradedFactors;
      } catch {
        dataQuality = 'partial';
        degradedFactors = ['yahoo_factors'];
      }
    } else {
      logger.error('fear-greed', 'cnn_expected_fallback_to_composite', { ticker });
      const prices = await fetchPrices(ticker);
      const f = compositeWithFactors(prices, ticker);
      score = f.score; prevScore = compositeScore(prices.slice(0, -7));
      rsiScore = f.rsiScore; momentumScore = f.momentumScore; volScore = f.volatilityScore;
      dataQuality = f.dataQuality; degradedFactors = f.degradedFactors;
    }
  } else {
    // ETF + 원지수 블렌딩
    const { etf, native } = await fetchNativePrices(nativeTicker, ticker);
    const etfComp = compositeWithFactors(etf, ticker);
    const nativeComp = native ? compositeWithFactors(native, nativeTicker!) : null;
    const blend = blendComposite(etfComp, nativeComp);
    score = blend.score;
    // 이전 스코어는 ETF의 1주 전 가격으로만 계산 (원지수 Yahoo 중복 호출 방지)
    prevScore = compositeScore(etf.slice(0, -7));
    rsiScore = blend.rsiScore; momentumScore = blend.momentumScore; volScore = blend.volatilityScore;
    dataQuality = blend.dataQuality; degradedFactors = blend.degradedFactors;
  }

  const delta = score - prevScore;
  const detail = detailMap[ticker];
  const entry = {
    id, flag, label, score, prevScore,
    trend: delta > 2 ? 'up' : delta < -2 ? 'down' : 'neutral',
    driver: driverMap[ticker] ?? ticker,
    level: getLevel(score),
    source,
    // 데이터 품질 — UI가 'partial'/'insufficient' 시 경고 뱃지 노출
    dataQuality,
    degradedFactors,
    factors: {
      rsi: rsiScore,
      momentum: momentumScore,
      volatility: volScore,
    },
    detail: detail ?? null,
  };

  if (redis) {
    await loggedRedisSet(redis, 'api.fear-greed', cacheKey, entry, { ex: CACHE_TTL })
  }
  return entry;
}

export async function GET() {
  const redis = createRedis();

  const [byCountry, byAsset] = await Promise.all([
    Promise.all(
      COUNTRY_ETFS.map(({ id, ticker, nativeTicker, flag, label, useCNN }) =>
        buildEntry(id, ticker, nativeTicker, flag, label, redis, useCNN ?? false).catch((err) => {
          logger.error('fear-greed', 'build_entry_failed', { id, ticker, error: err instanceof Error ? err.message : String(err) });
          return null;
        })
      )
    ),
    Promise.all(
      ASSET_ETFS.map(({ id, ticker, flag, label }) =>
        // 자산 ETF는 네이티브 지수 매핑 없음 (ETF 단독 composite)
        buildEntry(id, ticker, null, flag, label, redis, false).catch((err) => {
          logger.error('fear-greed', 'build_entry_failed', { id, ticker, error: err instanceof Error ? err.message : String(err) });
          return null;
        })
      )
    ),
  ]);

  return NextResponse.json({
    byCountry: byCountry.filter(Boolean),
    byAsset: byAsset.filter(Boolean),
    updatedAt: new Date().toISOString(),
  });
}
