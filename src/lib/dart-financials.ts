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
// scripts/fetch-dart-corp-codes.mjs 가 월 1회 생성. DART company.json 은 corp_code 필수
// (stock_code 로는 조회 불가) — 이 매핑이 없으면 모든 KR 종목 fetch 실패.
import dartCorpCodes from '../../data/dart-corp-codes.json';

const CORP_CODE_LOOKUP = (dartCorpCodes as { map: Record<string, { corpCode: string; corpName: string }> }).map;

const DART_BASE = 'https://opendart.fss.or.kr/api';
const CORP_CODE_TTL  = 30 * 24 * 3600;  // 30 days
const FINANCIALS_TTL = 24 * 3600;        // 24 hours
const FETCH_TIMEOUT  = 15_000;

// DART 재무제표 금액 단위: 원(KRW), 숫자 그대로 원(₩)
// USD 환산: 원 × (1/1450) — 단순 크로스마켓 비교용 (소수점 과한 정밀도 방지)
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
  // 2026-06-04: US-parity — 현금흐름표(CF) 계정. fnlttSinglAcntAll 응답에 sj_div='CF' 로 포함됨.
  operatingCF:      ['ifrs-full_CashFlowsFromUsedInOperatingActivities', 'dart_CashFlowsFromUsedInOperatingActivities'],
  investingCF:      ['ifrs-full_CashFlowsFromUsedInInvestingActivities'],
  financingCF:      ['ifrs-full_CashFlowsFromUsedInFinancingActivities'],
  capex:            ['ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
  dividendsPaid:    ['ifrs-full_DividendsPaidClassifiedAsFinancingActivities'],
} as const;

// 한국어 계정명 fallback (account_id 매핑 실패 시)
const ACCOUNT_NM_MAP: Record<keyof typeof ACCOUNT_IDS, string[]> = {
  revenue:          ['매출액', '수익(매출액)'],
  operatingIncome:  ['영업이익', '영업이익(손실)'],
  netIncome:        ['당기순이익', '당기순이익(손실)'],
  totalAssets:      ['자산총계'],
  totalEquity:      ['자본총계'],
  totalLiabilities: ['부채총계'],
  operatingCF:      ['영업활동현금흐름', '영업활동으로 인한 현금흐름'],
  investingCF:      ['투자활동현금흐름', '투자활동으로 인한 현금흐름'],
  financingCF:      ['재무활동현금흐름', '재무활동으로 인한 현금흐름'],
  capex:            ['유형자산의 취득', '유형자산의취득'],
  dividendsPaid:    ['배당금의지급', '배당금의 지급'],
};

export interface DartCorpInfo {
  corpCode: string;
  corpName: string;
  stockCode: string;
  corpCls: string;  // 'Y'=KOSPI, 'K'=KOSDAQ, 'N'=KONEX, 'E'=ETC
  // 2026-06-03: DART company.json 의 실제 기업 메타 (이전엔 corp_name 만 쓰고 버렸음).
  //   전부 라이브 DART 출처 — 정적/하드코딩 아님. KR 회사페이지 "기업 정보" 섹션용.
  corpNameEng?: string;
  ceo?: string;
  establishedDate?: string;
  address?: string;
  homepage?: string;
  indutyCode?: string;
  phone?: string;
}

export interface DartAnnualFinancials {
  fiscalYear: string;          // "2024"
  reportCode: string;          // "11011"
  revenueKRW: number | null;   // 원(KRW) — DART 원본 단위
  operatingIncomeKRW: number | null;
  netIncomeKRW: number | null;
  totalAssetsKRW: number | null;
  totalEquityKRW: number | null;
  totalLiabilitiesKRW: number | null;
  // 2026-06-04: 현금흐름표 (US-parity). 원(KRW).
  operatingCFKRW: number | null;
  investingCFKRW: number | null;
  financingCFKRW: number | null;
  capexKRW: number | null;
  freeCashFlowKRW: number | null;   // 영업CF - capex (파생)
  dividendsPaidKRW: number | null;
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
  // 2026-06-03: DART company.json 라이브 기업 메타 (정적 아님 — 매 fetch 갱신, 30d 캐시).
  corpInfo?: {
    corpNameEng?: string; ceo?: string; establishedDate?: string;
    address?: string; homepage?: string; indutyCode?: string; phone?: string;
  };
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

function deriveRatios(f: Pick<DartAnnualFinancials, 'revenueKRW'|'operatingIncomeKRW'|'netIncomeKRW'|'totalEquityKRW'|'totalLiabilitiesKRW'>): Pick<DartAnnualFinancials, 'operatingMarginPct'|'netMarginPct'|'roePct'|'debtRatioPct'> {
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
  const cacheKey = `flowvium:dart:corp-code:v2:${stockCode}`;

  if (redis) {
    try {
      const cached = await redis.get<DartCorpInfo>(cacheKey);
      if (cached) return cached;
    } catch { /* non-fatal */ }
  }

  // 1차: corp_code static map (3,967 종목) 에서 lookup. DART company.json 은
  //      stock_code 파라미터를 지원하지 않아 corp_code 가 필수.
  const mapped = CORP_CODE_LOOKUP[stockCode];
  let corpCode: string | null = mapped?.corpCode ?? null;
  let corpName: string = mapped?.corpName ?? stockCode;
  let corpCls = '';
  let meta: Record<string, string> = {};

  if (corpCode) {
    // map hit — corp_code 로 추가 메타 조회 (corpCls + 기업 메타)
    const data = await dartFetch('company.json', { corp_code: corpCode }) as Record<string, string> | null;
    if (data?.corp_code) {
      corpName = data.corp_name ?? corpName;
      corpCls = data.corp_cls ?? '';
      meta = data;
    }
  } else {
    logger.warn('dart', 'corp_code_not_in_map', { stockCode });
    return null;
  }

  const info: DartCorpInfo = {
    corpCode,
    corpName,
    stockCode,
    corpCls,
    corpNameEng: meta.corp_name_eng || undefined,
    ceo: meta.ceo_nm || undefined,
    establishedDate: meta.est_dt || undefined,
    address: meta.adres || undefined,
    homepage: meta.hm_url || undefined,
    indutyCode: meta.induty_code || undefined,
    phone: meta.phn_no || undefined,
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
  const cacheKey = `flowvium:dart:financials:v4:${cleanCode}`;  // v4: 현금흐름표/capex 추가 (2026-06-04)

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
    // 2026-06-04: 현금흐름표 (US-parity)
    const ocf  = pickAccount(items, 'operatingCF');
    const icf  = pickAccount(items, 'investingCF');
    const fcf_ = pickAccount(items, 'financingCF');
    const capx = pickAccount(items, 'capex');
    const divp = pickAccount(items, 'dividendsPaid');
    const freeCF = (ocf != null && capx != null) ? ocf - capx : null;  // capex 는 취득액(양수)

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
      operatingCFKRW: ocf,
      investingCFKRW: icf,
      financingCFKRW: fcf_,
      capexKRW: capx,
      freeCashFlowKRW: freeCF,
      dividendsPaidKRW: divp,
      revenueUSD:         rev  != null ? Math.round(rev  * KRW_USD) : null,  // 원(KRW) → USD
      operatingIncomeUSD: op   != null ? Math.round(op   * KRW_USD) : null,
      netIncomeUSD:       net  != null ? Math.round(net  * KRW_USD) : null,
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
    corpInfo: {
      corpNameEng: corpInfo.corpNameEng,
      ceo: corpInfo.ceo,
      establishedDate: corpInfo.establishedDate,
      address: corpInfo.address,
      homepage: corpInfo.homepage,
      indutyCode: corpInfo.indutyCode,
      phone: corpInfo.phone,
    },
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
