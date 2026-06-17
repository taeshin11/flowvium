/**
 * src/lib/dart-insider.ts — DART 임원·주요주주 지분공시 (KR 내부자 거래) — 2026-06-17.
 *
 * 사용자 "이거(내부자 거래) KS종목에 대해서는 파악안됨?" — US Form 4(/api/insider-trades)의 KR 대응.
 * 기존 insider 페이지 korea 탭은 외인/기관 *수급 흐름*(Naver)만 — 실제 임원·주요주주 *지분 변동 공시*는
 * 부재였음. DART OpenAPI 두 엔드포인트로 보강:
 *   elestock.json   — 임원·주요주주 특정증권등 소유상황보고 (개별 내부자 매매, Form 4 대응)
 *   majorstock.json — 대량보유 상황보고 (5%룰 — 주요주주 지분 변동/계약)
 *
 * 둘 다 corp_code 필수(stock_code 미지원) → corpCodeFor() 정적 매핑 사용. 응답은 *전체 이력* 반환 →
 * rcept_no 역순 정렬 후 최근분만 노출. 정적 폴백 금지(빈 배열 + source 명시). Redis 캐시 12h.
 *
 * 검증(2026-06-17 production probe): elestock 삼성전자(00126380)=2,617건, majorstock=39건 정상 200.
 */
import { logger, loggedRedisSet } from './logger';
import { dartFetch, corpCodeFor } from './dart-financials';
import type { Redis } from '@upstash/redis';

const INSIDER_TTL = 12 * 3600; // 12h — 지분공시는 D+5 영업일 보고라 자주 안 바뀜

export interface KrInsiderFiling {
  rceptNo: string;            // 접수번호 (고유 ID + 공시뷰어 링크 키)
  filedAt: string;            // 접수일자 YYYY-MM-DD
  kind: 'insider' | 'major';  // elestock(임원·주요주주) | majorstock(대량보유 5%룰)
  reporter: string;           // 보고자(repror)
  role: string;               // 등기임원/비등기임원/주요주주 등 (insider) · 보고구분(major)
  title: string | null;       // 직위(isu_exctv_ofcps) — insider 만
  relation: string | null;    // 주요주주 관계(isu_main_shrholdr) — insider 만
  sharesAfter: number | null; // 소유/보유 수량 (변동 후)
  sharesDelta: number | null; // 증감 수량 (+매수 / -매도) — 핵심
  ratioAfter: number | null;  // 소유/보유 비율 %
  ratioDelta: number | null;  // 증감 비율 %p
  direction: 'buy' | 'sell' | 'flat'; // sharesDelta 부호
  reason: string | null;      // 보고사유(major report_resn) — insider 는 null
  filingUrl: string;          // DART 공시뷰어 URL
}

export interface KrInsiderResult {
  ticker: string;
  corpCode: string;
  corpName: string;
  filings: KrInsiderFiling[];
  total: number;              // 정규화 전 전체 이력 건수
  source: 'dart-live' | 'dart-stale' | 'empty' | 'not-applicable';
  fetchedAt: string;
}

// DART 금액/수량 문자열("1,198,938,025") → number. 빈/"-" → null.
function parseNum(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[,\s]/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function filingUrl(rceptNo: string): string {
  return `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptNo}`;
}

interface ElestockRow {
  rcept_no?: string; rcept_dt?: string; repror?: string;
  isu_exctv_rgist_at?: string; isu_exctv_ofcps?: string; isu_main_shrholdr?: string;
  sp_stock_lmp_cnt?: string; sp_stock_lmp_irds_cnt?: string;
  sp_stock_lmp_rate?: string; sp_stock_lmp_irds_rate?: string;
}
interface MajorstockRow {
  rcept_no?: string; rcept_dt?: string; repror?: string; report_tp?: string;
  stkqy?: string; stkqy_irds?: string; stkrt?: string; stkrt_irds?: string; report_resn?: string;
}

function dir(delta: number | null): 'buy' | 'sell' | 'flat' {
  if (delta == null || delta === 0) return 'flat';
  return delta > 0 ? 'buy' : 'sell';
}

function normElestock(row: ElestockRow): KrInsiderFiling {
  const delta = parseNum(row.sp_stock_lmp_irds_cnt);
  const rcpt = String(row.rcept_no ?? '');
  return {
    rceptNo: rcpt,
    filedAt: row.rcept_dt ?? '',
    kind: 'insider',
    reporter: row.repror ?? '',
    role: row.isu_exctv_rgist_at ?? '',
    title: row.isu_exctv_ofcps && row.isu_exctv_ofcps !== '-' ? row.isu_exctv_ofcps : null,
    relation: row.isu_main_shrholdr && row.isu_main_shrholdr !== '-' ? row.isu_main_shrholdr : null,
    sharesAfter: parseNum(row.sp_stock_lmp_cnt),
    sharesDelta: delta,
    ratioAfter: parseNum(row.sp_stock_lmp_rate),
    ratioDelta: parseNum(row.sp_stock_lmp_irds_rate),
    direction: dir(delta),
    reason: null,
    filingUrl: filingUrl(rcpt),
  };
}

function normMajorstock(row: MajorstockRow): KrInsiderFiling {
  const delta = parseNum(row.stkqy_irds);
  const rcpt = String(row.rcept_no ?? '');
  return {
    rceptNo: rcpt,
    filedAt: row.rcept_dt ?? '',
    kind: 'major',
    reporter: row.repror ?? '',
    role: row.report_tp ?? '',
    title: null,
    relation: null,
    sharesAfter: parseNum(row.stkqy),
    sharesDelta: delta,
    ratioAfter: parseNum(row.stkrt),
    ratioDelta: parseNum(row.stkrt_irds),
    direction: dir(delta),
    reason: row.report_resn ? String(row.report_resn).replace(/\s*\n\s*/g, ' · ').trim() : null,
    filingUrl: filingUrl(rcpt),
  };
}

/**
 * KR 종목의 최근 임원·주요주주 지분공시 + 대량보유 공시.
 * @param stockCode 005930 또는 005930.KS
 * @param limit 노출 최대 건수 (기본 30, 최신순)
 */
export async function fetchKrInsiderFilings(
  stockCode: string,
  redis?: Redis | null,
  limit = 30,
): Promise<KrInsiderResult> {
  const clean = stockCode.replace(/\.(KS|KQ)$/i, '').trim();
  const fetchedAt = new Date().toISOString();
  const mapped = corpCodeFor(clean);

  // corp_code 없음 = DART 미제출 법인(ETF/ETN/펀드 등) → 결함 아님, notApplicable
  if (!mapped) {
    return { ticker: clean, corpCode: '', corpName: clean, filings: [], total: 0, source: 'not-applicable', fetchedAt };
  }

  const cacheKey = `flowvium:dart:insider:v1:${clean}`;
  if (redis) {
    try {
      const cached = await redis.get<KrInsiderResult>(cacheKey);
      if (cached) return { ...cached, source: 'dart-stale' };
    } catch { /* non-fatal */ }
  }

  const { corpCode, corpName } = mapped;

  // 두 엔드포인트 병렬. 각각 전체 이력 반환 → rcept_no 역순(최신 먼저)으로 합산.
  const [ele, maj] = await Promise.all([
    dartFetch('elestock.json', { corp_code: corpCode }) as Promise<{ list?: ElestockRow[] } | null>,
    dartFetch('majorstock.json', { corp_code: corpCode }) as Promise<{ list?: MajorstockRow[] } | null>,
  ]);

  const eleRows = (ele?.list ?? []).map(normElestock);
  const majRows = (maj?.list ?? []).map(normMajorstock);
  const all = [...eleRows, ...majRows]
    .filter(f => f.rceptNo)
    .sort((a, b) => b.rceptNo.localeCompare(a.rceptNo)); // 접수번호 = 시간순 단조 → 역순 = 최신

  const total = all.length;
  const filings = all.slice(0, limit);
  const source: KrInsiderResult['source'] = total > 0 ? 'dart-live' : 'empty';

  const result: KrInsiderResult = { ticker: clean, corpCode, corpName, filings, total, source, fetchedAt };

  // 데이터 있을 때만 캐시 — 일시적 빈 응답이 good 스냅샷 덮어쓰는 것 방지(insider-trades 패턴)
  if (redis && total > 0) {
    await loggedRedisSet(redis, 'dart-insider', cacheKey, result, { ex: INSIDER_TTL });
  }
  logger.info('dart-insider', 'fetched', { ticker: clean, total, ele: eleRows.length, maj: majRows.length });
  return result;
}
