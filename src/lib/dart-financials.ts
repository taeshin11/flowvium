/**
 * 금융감독원 DART OpenAPI 클라이언트
 *
 * 주요 엔드포인트:
 *   company.json  — 종목코드 → corp_code 변환 (ZIP 불필요)
 *   fnlttSinglAcntAll.json — 연결재무제표 전체 계정 (IFRS / K-IFRS)
 *
 * Redis 캐시 키:
 *   flowvium:dart:corp-code:v1:{stockCode}     TTL 30일
 *   flowvium:dart:financials:v2:{stockCode}    TTL 24h
 *
 * 환경변수: DART_API_KEY
 * 참고: https://opendart.fss.or.kr/api
 */

import { logger } from './logger';
import type { Redis } from '@upstash/redis';

const DART_BASE = 'https://opendart.fss.or.kr/api';
const CORP_CODE_TTL  = 30 * 24 * 3600;  // 30 days
const FINANCIALS_TTL = 24 * 3600;        // 24 hours
const FETCH_TIMEOUT  = 15_000;

// KRW → USD for cross-market comparison (rounded to avoid false precision)
const KRW_USD = 1 / 1450;

// DART 재무제표 구분
const REPORT_CODE_ANNUAL = '11011'; // 사업보고서 (4Q / annual)
const FS_DIV_CONSOLIDATED = 'CFS';  // 연결재무제표

// IFRS / K-IFRS 계정과목 ID (대표 값 + 한국 변형 포함)
const ACCOUNT_IDS = {
  revenue:          ['ifrs-full_Revenue', 'dart_Revenue', 'ifrs_Revenue'],
  operatingIncome:  ['ifrs-full_OperatingIncomeLoss', 'dart_OperatingIncomeLoss'],
  netIncome:        ['ifrs-full_ProfitLoss', 'dart_ProfitLoss'],
  totalAssets:      ['ifrs-full_Assets', 'dart_Assets'],
  totalEquity:      ['ifrs-full_Equity', 'dart_Equity'],
  totalLiabilities: ['ifrs-full_Liabilities', 'dart_Liabilities'],
} as const;

// 한국어 계정명 fallback (account_id 매핑 실패 시)
const ACCOUNT_NM_MAP: Record<keyof typeof ACCOUNT_IDS, string[]> = {
  revenue:          ['매출액', '수익(매출액)'],
  operatingIncome:  ['영업이익', '영업이익(손실)'],
  netIncome:        ['당기순이익', '당기순이익(손실)'],
  totalAssets:      ['자산총계'],
  totalEquity:      ['자본총계'],
  totalLiabilities: ['부채총계'],
};

export interface DartCorpInfo {
  corpCode: string;
  corpName: string;
  stockCode: string;
  corpCls: string;  // 'Y'=KOSPI, 'K'=KOSDAQ, 'N'=KONEX, 'E'=ETC
}

export interface DartAnnualFinancials {
  fiscalYear: string;          // "2024"
  reportCode: string;          // "11011"
  revenueKRW: number | null;   // 백만원
  operatingIncomeKRW: number | null;
  netIncomeKRW: number | null;
  totalAssetsKRW: number | null;
  totalEquityKRW: number | null;
  totalLiabilitiesKRW: number | null;
  // Derived (USD for cross-comparison)
  revenueUSD: number | null;
  operatingIncomeUSD: number | null;
  netIncomeUSD: number | null;
  // Ratios
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  roePct: number | null;
  debtRatioPct: number | null;
}

export interface DartFinancials {
  ticker: string;              // e.g. "005930.KS"
  stockCode: string;           // e.g. "005930"
  corpCode: string;            // e.g. "00126380"
  corpName: string;
  corpCls: string;
  fiscalYear: string;
  annuals: DartAnnualFinancials[];
  latestAnnual: DartAnnualFinancials | null;
  revenueYoYPct: number | null;
  source: 'dart';
  fetchedAt: string;
  cached?: boolean;
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

function dartKey(): string {
  const key = process.env.DART_API_KEY?.trim();
  if (!key) throw new Error('DART_API_KEY 환경변수가 설정되지 않았습니다');
  return key;
}

async function dartFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const query = new URLSearchParams({ crtfc_key: dartKey(), ...params }).toString();
  const url = `${DART_BASE}/${path}?${query}`;
  const start = Date.now();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    cache: 'no-store',
  });
  const durationMs = Date.now() - start;
  if (!res.ok) {
    logger.warn('dart', 'http_error', { path, status: res.status, durationMs });
    return null;
  }
  const json = await res.json();
  if (json?.status && json.status !== '000') {
    logger.warn('dart', 'api_error', { path, status: json.status, message: json.message, durationMs });
    return null;
  }
  logger.info('dart', 'fetch_ok', { path, durationMs });
  return json;
}

function parseKRW(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,\s]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function pickAccount(
  items: Array<{ account_id?: string; account_nm?: string; thstrm_amount?: string }>,
  key: keyof typeof ACCOUNT_IDS
): number | null {
  // 1차: account_id 매칭
  for (const id of ACCOUNT_IDS[key]) {
    const found = items.find(i => i.account_id === id);
    if (found) return parseKRW(found.thstrm_amount);
  }
  // 2차: 한국어 account_nm 매칭 (fallback)
  for (const nm of ACCOUNT_NM_MAP[key]) {
    const found = items.find(i => i.account_nm === nm);
    if (found) return parseKRW(found.thstrm_amount);
  }
  return null;
}

function deriveRatios(f: Omit<DartAnnualFinancials, 'revenueUSD'|'operatingIncomeUSD'|'netIncomeUSD'|'operatingMarginPct'|'netMarginPct'|'roePct'|'debtRatioPct'>): Pick<DartAnnualFinancials, 'operatingMarginPct'|'netMarginPct'|'roePct'|'debtRatioPct'> {
  const rev = f.revenueKRW;
  const op  = f.operatingIncomeKRW;
  const net = f.netIncomeKRW;
  const eq  = f.totalEquityKRW;
  const liab = f.totalLiabilitiesKRW;
  return {
    operatingMarginPct: rev && op  != null ? Math.round((op  / rev) * 1000) / 10 : null,
    netMarginPct:       rev && net != null ? Math.round((net / rev) * 1000) / 10 : null,
    roePct:             eq  && net != null && eq > 0 ? Math.round((net / eq) * 1000) / 10 : null,
    debtRatioPct:       eq  && liab != null && eq > 0 ? Math.round((liab / eq) * 1000) / 10 : null,
  };
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 종목코드 → DART corp_code / 기업정보 조회.
 * Redis 캐시 30일. DART company.json 엔드포인트 사용 (ZIP 불필요).
 */
export async function getDartCorpInfo(
  stockCode: string,
  redis?: Redis | null
): Promise<DartCorpInfo | null> {
  const cacheKey = `flowvium:dart:corp-code:v1:${stockCode}`;

  if (redis) {
    try {
      const cached = await redis.get<DartCorpInfo>(cacheKey);
      if (cached) return cached;
    } catch { /* non-fatal */ }
  }

  const data = await dartFetch('company.json', { stock_code: stockCode }) as Record<string, string> | null;
  if (!data?.corp_code) {
    logger.warn('dart', 'corp_code_not_found', { stockCode });
    return null;
  }

  const info: DartCorpInfo = {
    corpCode: data.corp_code,
    corpName: data.corp_name,
    stockCode,
    corpCls: data.corp_cls ?? '',
  };

  if (redis) {
    try {
      await redis.set(cacheKey, info, { ex: CORP_CODE_TTL });
    } catch { /* non-fatal */ }
  }

  return info;
}

/**
 * DART 연결재무제표에서 연간 재무 데이터를 가져옵니다.
 * 최근 2개 사업연도(현재 연도 → 전년도) 순으로 시도.
 * Redis 캐시 24h.
 */
export async function fetchDartFinancials(
  stockCode: string,
  redis?: Redis | null
): Promise<DartFinancials | null> {
  const cleanCode = stockCode.replace(/\.KS$/i, '').replace(/\.KQ$/i, '');
  const cacheKey = `flowvium:dart:financials:v2:${cleanCode}`;

  if (redis) {
    try {
      const cached = await redis.get<DartFinancials>(cacheKey);
      if (cached) return { ...cached, cached: true };
    } catch { /* non-fatal */ }
  }

  const corpInfo = await getDartCorpInfo(cleanCode, redis);
  if (!corpInfo) return null;

  // 최근 2개 연도 시도 (사업보고서는 다음 해 3월 제출)
  const currentYear = new Date().getFullYear();
  const yearsToTry = [currentYear - 1, currentYear - 2];

  const annuals: DartAnnualFinancials[] = [];

  for (const year of yearsToTry) {
    const raw = await dartFetch('fnlttSinglAcntAll.json', {
      corp_code: corpInfo.corpCode,
      bsns_year: String(year),
      reprt_code: REPORT_CODE_ANNUAL,
      fs_div: FS_DIV_CONSOLIDATED,
    }) as { list?: Array<{ account_id?: string; account_nm?: string; thstrm_amount?: string }> } | null;

    if (!raw?.list?.length) continue;

    const items = raw.list;
    const rev  = pickAccount(items, 'revenue');
    const op   = pickAccount(items, 'operatingIncome');
    const net  = pickAccount(items, 'netIncome');
    const ast  = pickAccount(items, 'totalAssets');
    const eq   = pickAccount(items, 'totalEquity');
    const liab = pickAccount(items, 'totalLiabilities');

    const base = {
      fiscalYear: String(year),
      reportCode: REPORT_CODE_ANNUAL,
      revenueKRW: rev,
      operatingIncomeKRW: op,
      netIncomeKRW: net,
      totalAssetsKRW: ast,
      totalEquityKRW: eq,
      totalLiabilitiesKRW: liab,
    };
    const ratios = deriveRatios(base);

    annuals.push({
      ...base,
      ...ratios,
      revenueUSD:         rev  != null ? Math.round(rev  * KRW_USD * 1_000_000) : null,  // KRW 백만원 → USD
      operatingIncomeUSD: op   != null ? Math.round(op   * KRW_USD * 1_000_000) : null,
      netIncomeUSD:       net  != null ? Math.round(net  * KRW_USD * 1_000_000) : null,
    });
  }

  if (!annuals.length) {
    logger.warn('dart', 'no_financials', { stockCode: cleanCode, corpCode: corpInfo.corpCode });
    return null;
  }

  // YoY 성장률 (최신 두 연도 비교)
  let revenueYoYPct: number | null = null;
  if (annuals.length >= 2 && annuals[0].revenueKRW && annuals[1].revenueKRW) {
    const prev = annuals[1].revenueKRW;
    if (prev !== 0) {
      revenueYoYPct = Math.round(((annuals[0].revenueKRW! - prev) / Math.abs(prev)) * 1000) / 10;
    }
  }

  const result: DartFinancials = {
    ticker: `${cleanCode}.KS`,
    stockCode: cleanCode,
    corpCode: corpInfo.corpCode,
    corpName: corpInfo.corpName,
    corpCls: corpInfo.corpCls,
    fiscalYear: annuals[0].fiscalYear,
    annuals,
    latestAnnual: annuals[0] ?? null,
    revenueYoYPct,
    source: 'dart',
    fetchedAt: new Date().toISOString(),
  };

  if (redis) {
    try {
      await redis.set(cacheKey, result, { ex: FINANCIALS_TTL });
    } catch { /* non-fatal */ }
  }

  return result;
}
