/**
 * /api/earnings
 *
 * Primary: Finnhub 실적 캘린더 (무료 티어 60 req/min, FINNHUB_KEY 필요).
 * Fallback: Yahoo Finance v7 batch quote (키 불필요, major 50 tickers, 날짜만).
 *
 * 쿼리:
 *   ?from=YYYY-MM-DD  (기본: 오늘)
 *   ?to=YYYY-MM-DD    (기본: 오늘+14일)
 *
 * Redis cache: `flowvium:earnings:v2:{from}:{to}` — 2h (Finnhub)
 *              `flowvium:earnings:yahoo:v1:{from}:{to}` — 6h (Yahoo fallback)
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import candidateTickers from '../../../../data/candidate-tickers.json';

// 추적 universe(권위 소스) — Finnhub 캘린더는 애널리스트 커버리지 없는 CEF/마이크로캡 수백 개를
//   포함해 estimate 가 전부 NULL → 페이지가 빈칸 투성이. universe US 티커로 노이즈 필터.
const UNIVERSE_US = new Set(
  ((candidateTickers as { tickers?: string[] }).tickers ?? [])
    .filter(t => !/\.(KS|KQ)$/.test(t) && !/^\d{6}$/.test(t))
    .map(t => t.toUpperCase()),
);

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── 2026-06-13: KR 실적 일정 (사용자 "/earnings KR 0건 — 미루지 말고 개선"). 무료 예정 캘린더
//    API 부재 → 자본시장법 정기보고서 법정 제출기한으로 결정론 추정 (하드코딩 일정/추측 금지 원칙
//    내에서 법규 기반): 분기·반기보고서 = 분기말+45일, 사업보고서 = 사업연도말+90일.
//    estimate/actual 없음 + hour='deadline' 라벨로 "추정 기한"임을 명시. 대상은 KR 대형주만
//    (allCompanies 의 .KS 보유 + 보고서 portfolio 류 — 전 universe 475개 같은 날 폭주 방지).
const KR_MAJORS: Array<{ ticker: string; name: string }> = (() => {
  try {
    const meta = (candidateTickers as { meta?: Record<string, { name?: string; sector?: string }> }).meta ?? {};
    // KOSPI(.KS) 중 meta name 보유 — 상위 노이즈 제한 위해 대형 섹터 우선 60개 cap
    return Object.entries(meta)
      .filter(([t]) => /\.KS$/.test(t))
      .slice(0, 60)
      .map(([t, m]) => ({ ticker: t, name: m.name ?? t }));
  } catch { return []; }
})();

function krDeadlineEvents(from: string, to: string): EarningRow[] {
  const year = new Date(from).getFullYear();
  // (기한일, 분기, 라벨연도) — 해당 연도와 전후 연도 경계 커버
  const deadlines: Array<{ date: string; quarter: number; year: number }> = [];
  for (const y of [year - 1, year, year + 1]) {
    deadlines.push(
      { date: `${y}-05-15`, quarter: 1, year: y },
      { date: `${y}-08-14`, quarter: 2, year: y },
      { date: `${y}-11-14`, quarter: 3, year: y },
      { date: `${y}-03-31`, quarter: 4, year: y - 1 },   // 사업보고서 (전년 결산)
    );
  }
  const inRange = deadlines.filter(d => d.date >= from && d.date <= to);
  if (!inRange.length) return [];
  const rows: EarningRow[] = [];
  for (const d of inRange) {
    for (const k of KR_MAJORS) {
      rows.push({
        date: d.date, symbol: k.ticker, companyName: k.name,
        epsActual: null, epsEstimate: null, revenueActual: null, revenueEstimate: null,
        epsSurprise: null, revenueSurprise: null,
        hour: '',
        session: 'deadline',
        quarter: d.quarter, year: d.year,
      } as unknown as EarningRow);
    }
  }
  return rows;
}

const CACHE_TTL = 2 * 60 * 60; // 2h
const ALLOWED_SPAN_DAYS = 30;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=7200, stale-while-revalidate=300' };

interface FinnhubEarning {
  date: string;
  symbol: string;
  epsActual: number | null;
  epsEstimate: number | null;
  hour: 'bmo' | 'amc' | 'dmh' | '' | null;  // before-market-open / after-market-close / during-market-hours
  quarter: number;
  revenueActual: number | null;
  revenueEstimate: number | null;
  year: number;
}

export interface EarningRow extends FinnhubEarning {
  /** EPS surprise % (actual vs estimate) — 발표 후에만 계산 */
  epsSurprise: number | null;
  /** 매출 surprise % */
  revenueSurprise: number | null;
  /** 'pre' | 'after' | 'during' | null — hour를 알기 쉬운 레이블로 */
  session: 'pre' | 'after' | 'during' | null;
  /** 기업 공식명 (Finnhub profile2 또는 하드코딩 맵) */
  companyName: string | null;
}

// 주요 티커 기업명 하드코딩 맵 — API 호출 없이 즉시 조회
const COMPANY_NAMES: Record<string, string> = {
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', GOOGL: 'Alphabet', GOOG: 'Alphabet',
  AMZN: 'Amazon', META: 'Meta', TSLA: 'Tesla', INTC: 'Intel', AMD: 'AMD',
  AVGO: 'Broadcom', QCOM: 'Qualcomm', MU: 'Micron', AMAT: 'Applied Materials',
  LRCX: 'Lam Research', KLAC: 'KLA Corp', TSM: 'TSMC', ASML: 'ASML', ARM: 'ARM Holdings',
  MRVL: 'Marvell', SMCI: 'Super Micro', MCHP: 'Microchip',
  JPM: 'JPMorgan Chase', BAC: 'Bank of America', WFC: 'Wells Fargo', GS: 'Goldman Sachs',
  MS: 'Morgan Stanley', BLK: 'BlackRock', V: 'Visa', MA: 'Mastercard',
  AXP: 'Amex', BX: 'Blackstone', C: 'Citigroup', SCHW: 'Schwab',
  JNJ: 'J&J', LLY: 'Eli Lilly', ABBV: 'AbbVie', MRK: 'Merck', PFE: 'Pfizer',
  UNH: 'UnitedHealth', AMGN: 'Amgen', GILD: 'Gilead', REGN: 'Regeneron',
  MRNA: 'Moderna', BMY: 'Bristol-Myers', CVS: 'CVS Health',
  XOM: 'ExxonMobil', CVX: 'Chevron', COP: 'ConocoPhillips', SLB: 'SLB', EOG: 'EOG Resources',
  COST: 'Costco', WMT: 'Walmart', TGT: 'Target', HD: 'Home Depot', SBUX: 'Starbucks',
  NKE: 'Nike', MCD: "McDonald's", LOW: "Lowe's", TJX: 'TJX',
  CAT: 'Caterpillar', RTX: 'RTX', LMT: 'Lockheed Martin', BA: 'Boeing',
  GE: 'GE Aerospace', HON: 'Honeywell', NOC: 'Northrop Grumman', LHX: 'L3Harris', KTOS: 'Kratos Defense',
  CRM: 'Salesforce', ORCL: 'Oracle', ADBE: 'Adobe', NFLX: 'Netflix',
  NOW: 'ServiceNow', SNOW: 'Snowflake', PLTR: 'Palantir', PANW: 'Palo Alto Networks',
  INTU: 'Intuit', IBM: 'IBM',
  COIN: 'Coinbase', MSTR: 'MicroStrategy', MARA: 'MARA Holdings',
  T: 'AT&T', VZ: 'Verizon', TMUS: 'T-Mobile',
  BABA: 'Alibaba', NIO: 'NIO',
  CRWV: 'CoreWeave', APP: 'Applovin', HOOD: 'Robinhood', RDDT: 'Reddit',
  DDOG: 'Datadog', NET: 'Cloudflare', ZS: 'Zscaler',
  AAON: 'AAON', AAP: 'Advance Auto', AAXN: 'Axon', ACN: 'Accenture',
  ADI: 'Analog Devices', ADP: 'ADP', ADSK: 'Autodesk', AEP: 'AEP',
  AFL: 'Aflac', AIG: 'AIG', ALL: 'Allstate', ANET: 'Arista Networks',
  ANSS: 'Ansys', APH: 'Amphenol', APO: 'Apollo', ARE: 'Alexandria Real Estate',
  BIIB: 'Biogen', BKNG: 'Booking Holdings', BR: 'Broadridge',
  CB: 'Chubb', CI: 'Cigna', CMCSA: 'Comcast', CME: 'CME Group',
  COF: 'Capital One', CPRT: 'Copart', CSX: 'CSX', CTSH: 'Cognizant',
  D: 'Dominion', DE: 'Deere', DIS: 'Disney', DLR: 'Digital Realty',
  DXCM: 'DexCom', EA: 'EA', EL: 'Estee Lauder', EMR: 'Emerson',
  EW: 'Edwards Lifesciences', F: 'Ford', FAST: 'Fastenal', FCX: 'Freeport-McMoRan',
  FDX: 'FedEx', FI: 'Fiserv', FIS: 'FIS', FITB: 'Fifth Third',
  GM: 'GM', GNRC: 'Generac', HBAN: 'Huntington',
  HCA: 'HCA Healthcare', HIG: 'Hartford', HLT: 'Hilton', HPE: 'HP Enterprise',
  HPQ: 'HP', HUM: 'Humana', IEX: 'IDEX', IFF: 'IFF',
  ILMN: 'Illumina', IR: 'Ingersoll Rand', ITW: 'Illinois Tool',
  JBHT: 'J.B. Hunt', KEY: 'KeyCorp', KHC: 'Kraft Heinz', KMB: 'Kimberly-Clark',
  KMI: 'Kinder Morgan', KR: 'Kroger', LIN: 'Linde', LNT: 'Alliant Energy',
  LUV: 'Southwest Airlines', LVS: 'Las Vegas Sands', LW: "Lamb Weston",
  MET: 'MetLife', MGM: 'MGM Resorts', MMC: 'Marsh McLennan', MMM: '3M',
  MO: 'Altria', MOH: 'Molina Healthcare', MOS: 'Mosaic', MPW: 'Medical Properties',
  MTB: 'M&T Bank', MTCH: 'Match Group', NEE: 'NextEra Energy',
  NEM: 'Newmont', NSC: 'Norfolk Southern',
  NTAP: 'NetApp', NUAN: 'Nuance', NUE: 'Nucor', NVAX: 'Novavax',
  OKE: 'ONEOK', ON: 'ON Semiconductor', PCAR: 'Paccar', PCG: 'PG&E',
  PEAK: 'Healthpeak', PEG: 'PSEG', PEP: 'PepsiCo', PKG: 'Packaging Corp',
  PM: 'Philip Morris', PNC: 'PNC Financial', PRU: 'Prudential', PSA: 'Public Storage',
  PYPL: 'PayPal', QRVO: 'Qorvo', RE: 'Everest Group', RF: 'Regions Financial',
  RHI: 'Robert Half', RJF: 'Raymond James', RL: 'Ralph Lauren', ROK: 'Rockwell',
  ROP: 'Roper', ROST: 'Ross Stores', RSG: 'Republic Services',
  SBAC: 'SBA Comm', SNA: 'Snap-on', SNPS: 'Synopsys', SO: 'Southern Company',
  SPG: 'Simon Property', SPGI: 'S&P Global', STT: 'State Street', STX: 'Seagate',
  SWK: 'Stanley Black', SYK: 'Stryker', SYY: 'Sysco',
  TECH: 'Bio-Techne', TFC: 'Truist',
  TMO: 'Thermo Fisher', TROW: 'T. Rowe Price', TRV: 'Travelers', TTWO: 'Take-Two',
  TXN: 'Texas Instruments', UAL: 'United Airlines', UDR: 'UDR',
  UPS: 'UPS', URI: 'United Rentals', USB: 'US Bancorp',
  VFC: 'VF Corp', VLO: 'Valero Energy', VMC: 'Vulcan Materials',
  VTR: 'Ventas', WAB: 'Wabtec', WAT: 'Waters', WBA: 'Walgreens',
  WEC: 'WEC Energy', WMB: 'Williams', WRB: 'WR Berkley', WST: 'West Pharma',
  WTW: 'Willis Towers', WY: 'Weyerhaeuser', XEL: 'Xcel Energy',
  XRAY: 'Dentsply', XYL: 'Xylem', YUM: 'Yum Brands', ZBH: 'Zimmer Biomet',
  ZBRA: 'Zebra Tech', ZTS: 'Zoetis',
};

const YHDR = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
// Same 50-ticker universe as market-movers
const YAHOO_EARNINGS_TICKERS = [
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','BRK-B','AVGO','JPM',
  'LLY','UNH','V','XOM','MA','JNJ','PG','COST','HD','ABBV',
  'BAC','MRK','CRM','ORCL','CVX','AMD','NFLX','ADBE','NOW','KO',
  'PEP','TMO','WMT','WFC','GS','BX','QCOM','ISRG','TXN','DHR',
  'MS','RTX','AMGN','CAT','INTU','PLTR','PANW','AMAT','INTC','COIN',
  // AI/cloud infra — high-signal for supply chain reports
  'CRWV','APP','ARM','MU','MRVL','SMCI','DDOG','NET','ZS','HOOD','RDDT',
];

function estimateQuarter(dateStr: string): number {
  const month = new Date(dateStr).getUTCMonth() + 1; // 1-12
  return Math.ceil(month / 3);
}

async function fetchYahooEarnings(from: string, to: string): Promise<EarningRow[]> {
  const fromTs = Math.floor(new Date(from).getTime() / 1000);
  const toTs = Math.floor(new Date(to + 'T23:59:59Z').getTime() / 1000);

  // No &fields= filter: get full quote response which includes earningsTimestampStart/End
  const res = await fetch(
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${YAHOO_EARNINGS_TICKERS.join(',')}`,
    { headers: YHDR, signal: AbortSignal.timeout(12000), cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Yahoo quote HTTP ${res.status}`);

  const data = await res.json() as {
    quoteResponse?: {
      result?: Array<{
        symbol?: string;
        earningsTimestampStart?: number | null;
        earningsTimestampEnd?: number | null;
        earningsTimestamp?: number | null;
      }>;
    };
  };

  const quotes = data?.quoteResponse?.result ?? [];
  const rows: EarningRow[] = [];

  for (const q of quotes) {
    if (!q.symbol) continue;
    // Use earningsTimestampStart if available, fall back to earningsTimestamp
    const ts = q.earningsTimestampStart ?? q.earningsTimestamp;
    if (ts == null || ts < fromTs || ts > toTs) continue;

    const dateStr = new Date(ts * 1000).toISOString().slice(0, 10);
    rows.push({
      date: dateStr,
      symbol: q.symbol,
      companyName: COMPANY_NAMES[q.symbol] ?? null,
      epsActual: null,
      epsEstimate: null,
      revenueActual: null,
      revenueEstimate: null,
      hour: null,
      quarter: estimateQuarter(dateStr),
      year: new Date(ts * 1000).getUTCFullYear(),
      epsSurprise: null,
      revenueSurprise: null,
      session: null,
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

function hourToSession(h: FinnhubEarning['hour']): EarningRow['session'] {
  if (h === 'bmo') return 'pre';
  if (h === 'amc') return 'after';
  if (h === 'dmh') return 'during';
  return null;
}

function enrichRow(e: FinnhubEarning, companyName: string | null = null): EarningRow {
  // Guard: |estimate| < 0.01 produces misleading extreme % (e.g. INTC +3052% when estimate=$0.009)
  const epsSurprise =
    e.epsActual != null && e.epsEstimate != null && Math.abs(e.epsEstimate) >= 0.01
      ? Math.max(-999, Math.min(999, Math.round(((e.epsActual - e.epsEstimate) / Math.abs(e.epsEstimate)) * 1000) / 10))
      : null;
  const revenueSurprise =
    e.revenueActual != null && e.revenueEstimate != null && e.revenueEstimate !== 0
      ? Math.max(-999, Math.min(999, Math.round(((e.revenueActual - e.revenueEstimate) / Math.abs(e.revenueEstimate)) * 1000) / 10))
      : null;
  return { ...e, epsSurprise, revenueSurprise, session: hourToSession(e.hour), companyName };
}

async function resolveCompanyNames(
  redis: Redis | null,
  apiKey: string,
  symbols: string[],
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};

  // 2026-06-16: companyName mojibake 가드 (페이지 전수감사 — earnings 에 "SNOA J�虣�" 등 깨진
  //   바이너리가 Redis co-name 캐시/Yahoo 응답에서 유입돼 렌더됨). 제어문자/replacement char/비정상
  //   문자 30%+ 이면 깨진 이름으로 보고 거부 → 다음 소스 또는 티커 폴백. 캐시 garbage 도 read 시 차단.
  const cleanName = (s: unknown): string | null => {
    if (typeof s !== 'string') return null;
    const t = s.trim();
    if (!t) return null;
    if (/[\u0000-\u001F\u007F\uFFFD]/.test(t)) return null; // 제어문자/replacement char
    const bad = (t.match(/[^\u0020-\u007E\uAC00-\uD7A3\u00C0-\u024F\s]/g) || []).length;
    if (bad / t.length > 0.3) return null;                          // 비정상 문자 30%+ = 모지바케
    return t;
  };

  // 1. Hardcoded map (free, instant)
  for (const sym of symbols) {
    if (COMPANY_NAMES[sym]) names[sym] = COMPANY_NAMES[sym];
  }

  // 2. Redis cache for unknowns
  const unknown = symbols.filter(s => !names[s]);
  if (redis && unknown.length > 0) {
    await Promise.all(unknown.map(async sym => {
      try {
        const cached = cleanName(await redis.get(`flowvium:co-name:v1:${sym}`));
        if (cached) names[sym] = cached;
      } catch { /* non-fatal */ }
    }));
  }

  // 3. Yahoo Finance v7 batch for still-unknown (100 symbols/request, no key needed)
  const stillUnknown = symbols.filter(s => !names[s]);
  if (stillUnknown.length > 0) {
    const CHUNK = 100;
    const batches: string[][] = [];
    for (let i = 0; i < stillUnknown.length; i += CHUNK)
      batches.push(stillUnknown.slice(i, i + CHUNK));
    await Promise.all(batches.map(async batch => {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${batch.map(s => encodeURIComponent(s)).join(',')}`,
          { headers: YHDR, signal: AbortSignal.timeout(8000), cache: 'no-store' },
        );
        if (!r.ok) return;
        const d = await r.json() as { quoteResponse?: { result?: Array<{ symbol?: string; shortName?: string; longName?: string }> } };
        for (const q of d?.quoteResponse?.result ?? []) {
          if (!q.symbol) continue;
          const name = cleanName(q.shortName ?? q.longName ?? null);
          // Skip if Yahoo returned the ticker itself as the name (meaningless)
          if (name && name.toUpperCase() !== q.symbol.toUpperCase()) {
            names[q.symbol] = name;
            if (redis)
              loggedRedisSet(redis, 'api.earnings', `flowvium:co-name:v1:${q.symbol}`, name, { ex: 7 * 24 * 3600 }).catch(() => {});
          }
        }
      } catch { /* non-fatal */ }
    }));
  }

  // 4. Finnhub profile2 for tickers still unknown after Yahoo (소형주 커버)
  //    Finnhub이 earnings 데이터 원천이므로 profile2도 거의 항상 이름 반환.
  //    Redis에 7일 캐싱 → 동일 심볼 재조회 비용 없음.
  const finnhubUnknown = symbols.filter(s => !names[s]);
  if (apiKey && finnhubUnknown.length > 0) {
    await Promise.all(finnhubUnknown.map(async sym => {
      try {
        const r = await fetch(
          `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(apiKey)}`,
          { signal: AbortSignal.timeout(5000), cache: 'no-store' },
        );
        if (!r.ok) return;
        const d = await r.json() as { name?: string };
        const fname = cleanName(d.name);
        if (fname && fname.toUpperCase() !== sym.toUpperCase()) {
          names[sym] = fname;
          if (redis)
            loggedRedisSet(redis, 'api.earnings', `flowvium:co-name:v1:${sym}`, fname, { ex: 7 * 24 * 3600 }).catch(() => {});
        }
      } catch { /* non-fatal */ }
    }));
  }

  return names;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000); // UTC+9
  const today = kstNow.toISOString().slice(0, 10);
  const defaultTo = new Date(kstNow.getTime() + 14 * 86400000).toISOString().slice(0, 10);

  const from = url.searchParams.get('from') ?? today;
  const to = url.searchParams.get('to') ?? defaultTo;

  // 범위 검증 (최대 30일)
  const spanDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
  if (isNaN(spanDays) || spanDays < 0 || spanDays > ALLOWED_SPAN_DAYS) {
    return NextResponse.json({ error: `Invalid range. Max ${ALLOWED_SPAN_DAYS} days.` }, { status: 400 });
  }

  const key = process.env.FINNHUB_KEY?.trim();
  const redis = createRedis();
  const cacheKey = `flowvium:earnings:v2:${from}:${to}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  if (!key) {
    // Yahoo Finance fallback — no API key needed, major 50 tickers, dates only
    const yahooCacheKey = `flowvium:earnings:yahoo:v1:${from}:${to}`;
    if (redis) {
      try {
        const cached = await redis.get(yahooCacheKey);
        if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
      } catch { /* non-fatal */ }
    }
    try {
      logger.info('api.earnings', 'yahoo_fallback', { from, to });
      const yahooRows = await fetchYahooEarnings(from, to);
      const payload = {
        earnings: yahooRows,
        from, to,
        count: yahooRows.length,
        updatedAt: new Date().toISOString(),
        source: 'Yahoo Finance (top 50 tickers, dates only — add FINNHUB_KEY for full calendar)',
        cached: false,
      };
      if (redis) {
        await loggedRedisSet(redis, 'api.earnings', yahooCacheKey, payload, { ex: 6 * 3600 });
      }
      return NextResponse.json(payload, { headers: CDN_HEADERS });
    } catch (err) {
      logger.error('api.earnings', 'yahoo_fallback_failed', { error: String(err) });
      return NextResponse.json({
        earnings: [],
        from, to,
        warning: 'FINNHUB_KEY 미설정 — Finnhub 무료 키 없이는 주요 50개 종목 날짜만 제공됩니다. 현재 Yahoo Finance 응답 오류.',
        cached: false,
      });
    }
  }

  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(12000), cache: 'no-store' }
    );
    if (!res.ok) {
      logger.error('api.earnings', 'finnhub_http_error', { status: res.status, durationMs: Date.now() - t0 });
      return NextResponse.json({ earnings: [], from, to, error: `Finnhub HTTP ${res.status}`, cached: false }, { status: 502 });
    }
    const data = await res.json() as { earningsCalendar?: FinnhubEarning[] };
    const rawAll = data.earningsCalendar ?? [];
    // 노이즈 필터: universe US 티커 OR 실제 estimate 보유 OR known 기업명(중대형주)만 유지.
    //   → CEF/마이크로캡(estimate 영구 NULL) 제거해 페이지 빈칸 해소. estimate 보유는 무조건 유지.
    const raw = rawAll.filter(e =>
      UNIVERSE_US.has((e.symbol ?? '').toUpperCase()) ||
      e.epsEstimate != null || e.revenueEstimate != null ||
      !!COMPANY_NAMES[e.symbol],
    );
    const droppedNoise = rawAll.length - raw.length;
    const symbols = Array.from(new Set(raw.map(e => e.symbol)));
    const nameMap = await resolveCompanyNames(redis, key, symbols);
    const enriched = raw.map(e => enrichRow(e, nameMap[e.symbol] ?? null))
      .concat(krDeadlineEvents(from, to))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 커버리지 메타 — estimate 채움률(미래 실적은 actual 자연 NULL 이므로 estimate 기준).
    const withEst = enriched.filter(e => e.epsEstimate != null || e.revenueEstimate != null).length;
    const estCoverage = enriched.length ? Math.round((withEst / enriched.length) * 100) : 0;
    logger.info('api.earnings', 'finnhub_ok', { from, to, count: enriched.length, droppedNoise, estCoverage, durationMs: Date.now() - t0 });

    const payload = {
      earnings: enriched,
      from, to,
      count: enriched.length,
      coverage: { withEstimate: withEst, total: enriched.length, estCoverage, droppedNoise },
      updatedAt: new Date().toISOString(),
      source: 'Finnhub',
      cached: false,
    };

    if (redis) {
      await loggedRedisSet(redis, 'api.earnings', cacheKey, payload, { ex: CACHE_TTL });
    }
    return NextResponse.json(payload, { headers: CDN_HEADERS });
  } catch (err) {
    logger.error('api.earnings', 'fetch_failed', { error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 });
    return NextResponse.json({ earnings: [], from, to, error: 'fetch failed', cached: false }, { status: 502 });
  }
}
