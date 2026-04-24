/**
 * /api/earnings
 *
 * Finnhub 실적 캘린더 (무료 티어 60 req/min).
 * 블룸버그 EE (Earnings Events) 함수 대응.
 *
 * 쿼리:
 *   ?from=YYYY-MM-DD  (기본: 오늘)
 *   ?to=YYYY-MM-DD    (기본: 오늘+14일)
 *
 * 환경변수: FINNHUB_KEY
 *
 * Redis cache: `flowvium:earnings:v2:{from}:{to}` — 2h
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
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

  // 1. Hardcoded map (free, instant)
  for (const sym of symbols) {
    if (COMPANY_NAMES[sym]) names[sym] = COMPANY_NAMES[sym];
  }

  // 2. Redis cache for unknowns
  const unknown = symbols.filter(s => !names[s]);
  if (redis && unknown.length > 0) {
    await Promise.all(unknown.map(async sym => {
      try {
        const cached = await redis.get(`flowvium:co-name:v1:${sym}`);
        if (cached) names[sym] = cached as string;
      } catch { /* non-fatal */ }
    }));
  }

  // 3. Finnhub profile2 for still-unknown (max 20 new lookups per request)
  const stillUnknown = symbols.filter(s => !names[s]).slice(0, 20);
  if (stillUnknown.length > 0) {
    await Promise.all(stillUnknown.map(async sym => {
      try {
        const r = await fetch(
          `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(apiKey)}`,
          { signal: AbortSignal.timeout(4000), cache: 'no-store' },
        );
        if (!r.ok) return;
        const d = await r.json() as { name?: string };
        if (d.name) {
          names[sym] = d.name;
          if (redis) {
            redis.set(`flowvium:co-name:v1:${sym}`, d.name, { ex: 7 * 24 * 3600 }).catch(() => {});
          }
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
    logger.warn('api.earnings', 'no_finnhub_key');
    return NextResponse.json({
      earnings: [],
      from, to,
      warning: 'FINNHUB_KEY 미설정 — 실적 캘린더를 표시하려면 Finnhub 무료 키 발급 필요 (60 req/min 무료)',
      cached: false,
    });
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
    const raw = data.earningsCalendar ?? [];
    const symbols = Array.from(new Set(raw.map(e => e.symbol)));
    const nameMap = await resolveCompanyNames(redis, key, symbols);
    const enriched = raw.map(e => enrichRow(e, nameMap[e.symbol] ?? null))
      .sort((a, b) => a.date.localeCompare(b.date));

    logger.info('api.earnings', 'finnhub_ok', { from, to, count: enriched.length, durationMs: Date.now() - t0 });

    const payload = {
      earnings: enriched,
      from, to,
      count: enriched.length,
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
