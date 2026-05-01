import { logger, loggedRedisSet} from '@/lib/logger';
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';

// 엣지 CDN 캐시 우회 — 실제 캐시는 Redis(4h)로 관리. 엣지 캐시가 stale 응답을
// 홀딩하면 v4 bump 같은 긴급 픽스가 즉시 반영되지 않음.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL = 4 * 60 * 60; // 4 hours
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };

// Module-level memory cache — without Redis, every request fetches CNN + computes composite scores.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let FG_MEMORY_CACHE: { data: any; expiresAt: number } | null = null;
const FG_MEMORY_TTL_MS = 4 * 60 * 60 * 1000;

// ── CNN Fear & Greed (US only) ─────────────────────────────────────────────────
// CNN endpoint blocks minimal UA with HTTP 418 (since ~Q4 2025). Full browser
// headers (UA + Referer + Origin + Accept-Language) are required to get 200.
async function fetchCNNScore(): Promise<{ score: number; prevScore: number; history: Array<{date: string; score: number}> } | null> {
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
    const fullHist: Array<{ x: number; y: number }> = data?.fear_and_greed_historical?.data ?? [];
    // Previous score: prefer CNN's own previous_1_week field, fallback to historical scan.
    let prevScore: number;
    const prev1wk = data?.fear_and_greed?.previous_1_week;
    if (typeof prev1wk === 'number') {
      prevScore = Math.round(prev1wk);
    } else {
      const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weekAgoEntry = fullHist.find((d) => Math.abs(d.x - weekAgoMs) < 2 * 24 * 60 * 60 * 1000);
      prevScore = weekAgoEntry ? Math.round(weekAgoEntry.y) : score;
    }
    // Last 30 daily data points for sparkline — CNN timestamps are ms epoch
    const history = fullHist.slice(-30).map((d) => ({
      date: new Date(d.x).toISOString().slice(0, 10),
      score: Math.round(d.y),
    }));
    logger.info('fear-greed', 'cnn_ok', { score, prevScore, histLen: history.length, durationMs: Date.now() - start });
    return { score, prevScore, history };
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

// Factor 4 (US only): VIX level → inverse sentiment.
// High VIX = fear; low VIX = greed. Thresholds calibrated to CNN F&G historical mapping.
function vixLevelScore(vix: number): Factor {
  if (vix < 12) return { value: 92, ok: true };
  if (vix < 15) return { value: 75, ok: true };
  if (vix < 20) return { value: 50, ok: true };
  if (vix < 25) return { value: 28, ok: true };
  if (vix < 30) return { value: 15, ok: true };
  return { value: 5, ok: true };
}

// Composite: 한 번만 계산해서 단일 score 반환 (prevScore 7일 전 값 계산용)
// vixValue 제공 시 RSI(35%)+SMA(30%)+VIX(20%)+vol(15%), 없으면 기존 3-factor
function compositeScore(prices: number[], vixValue?: number): number {
  const r = rsi14(prices).value;
  const m = smaMomentum(prices).value;
  const v = volatilityScore(prices).value;
  if (vixValue != null) {
    const vx = vixLevelScore(vixValue).value;
    return Math.round(r * 0.35 + m * 0.30 + vx * 0.20 + v * 0.15);
  }
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

// vixValue 제공 시 4-factor 가중치 적용 (US composite fallback 전용)
function compositeWithFactors(prices: number[], ticker: string, vixValue?: number): CompositeResult {
  const r = rsi14(prices);
  const m = smaMomentum(prices);
  const v = volatilityScore(prices);
  const degraded: string[] = [];
  if (!r.ok) degraded.push('rsi');
  if (!m.ok) degraded.push('sma');
  if (!v.ok) degraded.push('vol');

  // 3개 모두 ok = full / 일부만 = partial / 전부 실패 = insufficient (VIX는 보조 factor)
  const okCount = [r.ok, m.ok, v.ok].filter(Boolean).length;
  const dataQuality: 'full' | 'partial' | 'insufficient' =
    okCount === 3 ? 'full' : okCount === 0 ? 'insufficient' : 'partial';

  if (dataQuality !== 'full') {
    logger.warn('fear-greed', 'composite_degraded', { ticker, quality: dataQuality, degradedFactors: degraded, priceLen: prices.length });
  }

  let score: number;
  if (vixValue != null) {
    const vx = vixLevelScore(vixValue).value;
    score = Math.round(r.value * 0.35 + m.value * 0.30 + vx * 0.20 + v.value * 0.15);
  } else {
    score = Math.round(r.value * 0.40 + m.value * 0.35 + v.value * 0.25);
  }

  return {
    score,
    rsiScore: r.value,
    momentumScore: m.value,
    volatilityScore: v.value,
    dataQuality,
    degradedFactors: degraded,
  };
}

import { FG } from '@/lib/thresholds';
import { moneyFlowSectors } from '@/data/fear-greed';

function getLevel(score: number): string {
  if (score <= FG.EXTREME_FEAR) return 'extreme-fear';
  if (score <= FG.FEAR)         return 'fear';
  if (score >= FG.EXTREME_GREED) return 'extreme-greed';
  if (score >= FG.GREED)        return 'greed';
  return 'neutral';
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
    factors: ['SPY RSI-14: trend momentum (14-day gain/loss strength)', 'SPY price vs 125-day SMA (trend strength)', 'SPY 20-day vol / 50-day avg (fear intensity)'],
    macro: 'Fed hold continues, CPI declining, NFP strong — mixed signals. Tariff uncertainty offset by Mag7 AI capex; greed sustained.',
    risk: 'Strong employment delays Fed cuts → valuation pressure',
  },
  EWY:  {
    factors: ['EWY(iShares Korea, USD) + ^KS11(KOSPI, KRW) blend RSI-14', 'EWY + KOSPI vs 125-day SMA (±20% normalized)', 'EWY + KOSPI 20d/50d vol ratio'],
    macro: 'Samsung/SK Hynix surge on HBM/AI chip demand. KRW stabilizing, foreign net buying turning positive. Export recovery underway.',
    risk: 'US-China tariff escalation threatens exports, semiconductor cycle peak concern',
  },
  EWJ:  {
    factors: ['EWJ(iShares Japan, USD) + ^N225(Nikkei 225, JPY) blend RSI-14', 'EWJ + Nikkei vs 125-day SMA', 'EWJ + Nikkei 20d/50d vol ratio'],
    macro: 'BOJ additional rate hike signals drive yen strength. Export earnings concern vs domestic consumption recovery. Yen carry unwind risk.',
    risk: 'BOJ tightening acceleration → yen carry unwind → global risk-off',
  },
  FXI:  {
    factors: ['FXI(iShares China, USD) + 000300.SS(CSI 300, CNY) blend RSI-14', 'FXI + CSI300 vs 125-day SMA', 'FXI + CSI300 vol ratio'],
    macro: 'PBOC expands AI/semiconductor subsidies, additional property stimulus expected. However US-China 140% tariffs continue to hit exports.',
    risk: 'Property downturn continues, US-China tensions drive foreign capital flight',
  },
  VGK:  {
    factors: ['VGK(Vanguard FTSE Europe, USD) + ^STOXX50E(Euro Stoxx 50) blend RSI-14', 'VGK + Euro Stoxx 50 vs 125-day SMA', 'VGK + Euro Stoxx vol ratio'],
    macro: 'ECB rate cut cycle underway. European defense spending surge. German fiscal expansion despite US tariff retaliation risk.',
    risk: 'Russia-Ukraine conflict continuing, energy price re-surge stagflation risk',
  },
  EWU:  {
    factors: ['EWU(iShares UK, USD) + ^FTSE(FTSE 100, GBP) blend RSI-14', 'EWU + FTSE100 vs 125-day SMA', 'EWU + FTSE vol ratio'],
    macro: 'BOE cut cycle but UK inflation re-ignition concern. Brexit effects persist. Energy/commodity sector weight provides relative defense.',
    risk: 'Stagflation re-emergence risk, current account deficit continuing',
  },
  INDA: {
    factors: ['INDA(iShares India, USD) + ^BSESN(BSE Sensex, INR) blend RSI-14', 'INDA + Sensex vs 125-day SMA', 'INDA + Sensex vol ratio'],
    macro: 'FII net buying turning positive, India manufacturing relocation (China+1) beneficiary. Modi infrastructure investment continues. INR stable.',
    risk: 'High valuation, commodity import dependence — vulnerable to dollar strength',
  },
  EWZ:  {
    factors: ['EWZ(iShares Brazil, USD) + ^BVSP(Bovespa, BRL) blend RSI-14', 'EWZ + Bovespa vs 125-day SMA', 'EWZ + Bovespa vol ratio'],
    macro: 'Commodity exports (iron ore, soy) price rebound, Selic high rate maintained. China demand recovery expected despite fiscal deficit concern.',
    risk: 'Fiscal deterioration, political instability, BRL collapse on dollar strength',
  },
  EWT:  {
    factors: ['EWT(iShares Taiwan, USD) + ^TWII(TWSE weighted, TWD) blend RSI-14', 'EWT + TWII vs 125-day SMA', 'EWT + TWII vol ratio (high TSMC weight)'],
    macro: 'TSMC maximizing AI benefits, CoWoS packaging demand explosion. China military exercises resuming — geopolitical risk elevated.',
    risk: 'Cross-strait tension spike → rapid foreign capital flight',
  },
  EWA:  {
    factors: ['EWA(iShares Australia, USD) + ^AXJO(ASX 200, AUD) blend RSI-14', 'EWA + ASX200 vs 125-day SMA', 'EWA + ASX200 vol ratio'],
    macro: 'RBA cut expectations, China stimulus benefits resource exports. Property market overheating concern persists.',
    risk: 'China slowdown hits iron ore exports, RBA tightening reversal risk',
  },
  GLD:  {
    factors: ['GLD ETF RSI-14', 'GLD vs 125-day SMA', 'Gold spot volatility'],
    macro: 'Central bank gold buying at record highs, dollar weakness expected, geopolitical hedge demand. Real rate decline expectations compound.',
    risk: 'Fed cut delay → real rate rise reduces gold appeal',
  },
  QQQ:  {
    factors: ['Nasdaq-100 RSI-14', 'QQQ vs 125-day SMA', 'AI theme stock volatility'],
    macro: 'Mag7 AI capex continues (MS/Google/Amazon data center spending surge), NVDA earnings beat expected. Rate cut bets expand growth multiples.',
    risk: 'AI monetization delay, prolonged high rates → valuation compression',
  },
  TLT:  {
    factors: ['20Y Treasury ETF RSI-14', 'Bond price vs 125-day SMA', 'Rate volatility (duration risk)'],
    macro: 'FOMC cut expectations drive long bond buying. But fiscal deficit concern limits long rate downside.',
    risk: 'Fiscal deficit deepening, CPI re-acceleration → long rate spike',
  },
  ITA:  {
    factors: ['ITA Defense ETF RSI-14', 'Defense stocks vs 125-day SMA', 'Geopolitical event volatility'],
    macro: 'NATO 2% GDP defense target raised, European rearmament boom. LMT/RTX/NOC new orders surge.',
    risk: 'Geopolitical de-escalation cuts orders, government budget sequestration',
  },
  XLE:  {
    factors: ['Energy sector RSI-14', 'XLE vs 125-day SMA', 'WTI/Brent volatility'],
    macro: 'OPEC+ output cuts maintained, Middle East supply risk. China demand recovery expected. But US shale output increase caps upside.',
    risk: 'Global recession → demand collapse, OPEC+ cohesion fracture',
  },
  IBB:  {
    factors: ['Biotech ETF RSI-14', 'IBB vs 125-day SMA', 'FDA approval event volatility'],
    macro: 'GLP-1 (obesity drugs) boom sustained, AI drug development accelerating. Rate cut expectations recover non-profitable biotech valuations.',
    risk: 'FDA clinical trial failure, Medicare drug price negotiation intensification',
  },
  DJP:  {
    factors: ['Bloomberg Commodity Index RSI-14', 'DJP vs 125-day SMA', 'Commodity price volatility'],
    macro: 'China stimulus drives copper/iron ore demand expectations. Energy transition drives structural copper/lithium demand growth.',
    risk: 'Dollar strength, China growth disappointment → broad commodity decline',
  },
  VNQ:  {
    factors: ['REIT ETF RSI-14', 'VNQ vs 125-day SMA', 'Mortgage rate volatility'],
    macro: 'Fed cut expectations drive mortgage rate decline, REIT dividend appeal recovery. Logistics/data center REITs outperforming.',
    risk: 'Fed cut delay, office vacancy rate surge',
  },
  XLF:  {
    factors: ['Financial sector RSI-14', 'XLF vs 125-day SMA', 'Yield curve volatility'],
    macro: 'Bank NIM at peak, credit card delinquency rising — monitor. Yield curve normalization supports margin recovery expectations.',
    risk: 'Recession → credit loss surge, commercial real estate exposure',
  },
  BITO: {
    factors: ['Bitcoin spot ETF RSI-14', 'BTC price vs 125-day SMA', 'Crypto funding rate volatility'],
    macro: 'Institutional inflows post-spot ETF approval, halving effect. Risk-on indicator correlated with equity markets.',
    risk: 'Regulatory risk, exchange hacks, first to be sold in risk-off',
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
  redis: Redis | null, useCNN = false, force = false,
) {
  // v6: US CNN entry includes 30-day history for sparkline
  const cacheKey = `flowvium:fg:v6:${ticker}`;
  if (redis && !force) {
    try {
      const cached = await redis.get<object>(cacheKey);
      if (cached) return cached;
    } catch { /* non-fatal */ }
  }

  let score: number, prevScore: number;
  let history: Array<{date: string; score: number}> | undefined;
  let rsiScore = 50, momentumScore = 50, volScore = 50;
  let source: 'cnn' | 'composite' = 'composite';
  let dataQuality: 'full' | 'partial' | 'insufficient' = 'full';
  let degradedFactors: string[] = [];

  if (useCNN) {
    // Fetch CNN, SPY prices, and VIX in parallel. VIX is used when CNN is blocked.
    const [cnn, prices, vixPrices] = await Promise.all([
      fetchCNNScore(),
      fetchPrices(ticker).catch(() => [] as number[]),
      fetchPrices('^VIX').catch(() => [] as number[]),
    ]);
    const currentVix = vixPrices.length > 0 ? vixPrices[vixPrices.length - 1] : undefined;
    const prevVix = vixPrices.length > 7 ? vixPrices[vixPrices.length - 8] : undefined;
    if (cnn) {
      score = cnn.score;
      prevScore = cnn.prevScore;
      history = cnn.history;
      source = 'cnn';
      try {
        const f = compositeWithFactors(prices, ticker);
        rsiScore = f.rsiScore; momentumScore = f.momentumScore; volScore = f.volatilityScore;
        dataQuality = f.dataQuality; degradedFactors = f.degradedFactors;
      } catch {
        dataQuality = 'partial';
        degradedFactors = ['yahoo_factors'];
      }
    } else {
      logger.error('fear-greed', 'cnn_expected_fallback_to_composite', { ticker, vixAvailable: currentVix != null });
      const f = compositeWithFactors(prices, ticker, currentVix);
      score = f.score; prevScore = compositeScore(prices.slice(0, -7), prevVix);
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
    ...(history ? { history } : {}),
  };

  if (redis) {
    await loggedRedisSet(redis, 'api.fear-greed', cacheKey, entry, { ex: CACHE_TTL })
  }
  return entry;
}


// ── sectorFlows 동적 계산 ─────────────────────────────────────────────────────
// capital-flows Redis 캐시에서 sectorPerformance를 읽어 signal 계산.
// Redis miss시 moneyFlowSectors static fallback 사용.
async function computeSectorFlows(redis: Redis | null): Promise<typeof moneyFlowSectors> {
  try {
    if (redis) {
      const cached = await redis.get<{ sectorPerformance?: Array<{ id: string; label: string; flag: string; ticker: string; ret1w: number | null; ret4w: number | null }> }>(
        'flowvium:capital-flows:v5'
      );
      const sectors = cached?.sectorPerformance;
      if (sectors && sectors.length > 0) {
        const sinceDate = new Date().toISOString().slice(0, 10);
        return sectors.map(s => {
          const ret4w = s.ret4w ?? 0;
          const ret1w = s.ret1w ?? 0;
          const signal: 'accelerating' | 'holding' | 'fading' =
            ret4w > 3 ? 'accelerating' : ret4w < -3 ? 'fading' : 'holding';
          return {
            sector: s.label,
            sectorKo: s.label,
            direction: ret4w >= 0 ? 'inflow' : 'outflow' as 'inflow' | 'outflow',
            magnitude: Math.min(5, Math.max(1, Math.round(Math.abs(ret4w) / 2) + 1)),
            topMovers: [{ ticker: s.ticker, action: ret4w >= 0 ? '↑' : '↓' }],
            reason: `${s.label} 4W ${ret4w.toFixed(1)}% / 1W ${ret1w.toFixed(1)}%`,
            sinceDate,
            signal,
          };
        });
      }
    }
  } catch {
    // Redis miss or parse error — fall through to static fallback
  }
  return moneyFlowSectors;
}


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === '1';
  const redis = createRedis();

  // Module-level memory cache hit (no-Redis path)
  if (!redis && !force && FG_MEMORY_CACHE && Date.now() < FG_MEMORY_CACHE.expiresAt) {
    logger.info('fear-greed', 'memory_cache_hit');
    return NextResponse.json(FG_MEMORY_CACHE.data, { headers: CDN_HEADERS });
  }

  const [byCountry, byAsset] = await Promise.all([
    Promise.all(
      COUNTRY_ETFS.map(({ id, ticker, nativeTicker, flag, label, useCNN }) =>
        buildEntry(id, ticker, nativeTicker, flag, label, redis, useCNN ?? false, force).catch((err) => {
          logger.error('fear-greed', 'build_entry_failed', { id, ticker, error: err instanceof Error ? err.message : String(err) });
          return null;
        })
      )
    ),
    Promise.all(
      ASSET_ETFS.map(({ id, ticker, flag, label }) =>
        // 자산 ETF는 네이티브 지수 매핑 없음 (ETF 단독 composite)
        buildEntry(id, ticker, null, flag, label, redis, false, force).catch((err) => {
          logger.error('fear-greed', 'build_entry_failed', { id, ticker, error: err instanceof Error ? err.message : String(err) });
          return null;
        })
      )
    ),
  ]);

  const sectorFlows = await computeSectorFlows(redis);

  const response = {
    byCountry: byCountry.filter(Boolean),
    byAsset: byAsset.filter(Boolean),
    sectorFlows,
    updatedAt: new Date().toISOString(),
  };

  // Module-level memory cache write (no-Redis path)
  if (!redis) {
    FG_MEMORY_CACHE = { data: response, expiresAt: Date.now() + FG_MEMORY_TTL_MS };
    logger.info('fear-greed', 'memory_cache_written', { countries: response.byCountry.length });
  }

  return NextResponse.json(response, { headers: CDN_HEADERS });
}
