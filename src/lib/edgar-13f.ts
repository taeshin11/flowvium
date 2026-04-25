/**
 * src/lib/edgar-13f.ts
 *
 * SEC EDGAR 13F-HR 파싱 라이브러리
 *
 * 흐름:
 *   1. 기관 CIK → 최신 13F-HR 제출 내역 조회 (submissions API)
 *   2. accession number → 제출 파일 인덱스 조회
 *   3. informationtable.xml 또는 primary_doc.xml 다운로드
 *   4. regex 기반 포지션 파싱 (JSON 라이브러리 없음, 빠름)
 *   5. 직전 분기와 비교 → action 결정
 */

import { logger } from './logger';

export const EDGAR_UA = 'FlowVium/1.0 taeshinkim11@gmail.com';

// ── 추적 기관 목록 ─────────────────────────────────────────────────────────────
// SEC EDGAR 등록 CIK. 검증된 CIK만 포함.
export const INSTITUTIONS: Record<string, { cik: string; sector: string }> = {
  'Berkshire Hathaway':       { cik: '1067983', sector: 'conglomerate' },
  'BlackRock':                { cik: '1364742', sector: 'asset-management' },
  'Vanguard Group':           { cik: '102909',  sector: 'asset-management' },
  'State Street':             { cik: '93751',   sector: 'asset-management' },
  'Wellington Management':    { cik: '902219',  sector: 'asset-management' },
  'Viking Global Investors':  { cik: '1103804', sector: 'hedge-fund' },
  'Third Point LLC':          { cik: '1040273', sector: 'hedge-fund' },
  'Pershing Square Capital':  { cik: '1336528', sector: 'hedge-fund' },
  'FMR (Fidelity)':           { cik: '315066',  sector: 'asset-management' },
};

// ── 추적 종목 CUSIP 매핑 ────────────────────────────────────────────────────────
// CUSIP은 변경되지 않으며 13F XML에서 포지션 식별에 사용
export const CUSIP_TO_TICKER: Record<string, string> = {
  // ── Mega-cap Tech ──────────────────────────────────────────────────────────
  '67066G104': 'NVDA',   // NVIDIA
  '037833100': 'AAPL',   // Apple
  '594918104': 'MSFT',   // Microsoft
  '023135106': 'AMZN',   // Amazon
  '02079K305': 'GOOGL',  // Alphabet A
  '02079K107': 'GOOGL',  // Alphabet C
  '30303M102': 'META',   // Meta
  '88160R101': 'TSLA',   // Tesla
  '68389X105': 'ORCL',   // Oracle
  '19260Q107': 'COIN',   // Coinbase
  '24703L202': 'DELL',   // Dell
  '60871R209': 'AVGO',   // Broadcom
  '17275R102': 'CSCO',   // Cisco
  // ── Semiconductors ─────────────────────────────────────────────────────────
  '879868107': 'TSM',    // TSMC ADR (variant 1)
  '874039100': 'TSM',    // TSMC (variant 2 — Viking/Third Point XML)
  '045927104': 'ASML',   // ASML ADR
  '595112103': 'MU',     // Micron
  '007903107': 'AMD',    // AMD
  '458140100': 'INTC',   // Intel
  '482480100': 'KLAC',   // KLA Corp
  '512807108': 'LRCX',   // Lam Research
  '038222105': 'AMAT',   // Applied Materials
  'G5876H105': 'MRVL',   // Marvell
  '86800U104': 'SMCI',   // Super Micro
  // ── Defense ────────────────────────────────────────────────────────────────
  '539830109': 'LMT',    // Lockheed Martin
  '75513E101': 'RTX',    // RTX Corp
  '666628104': 'NOC',    // Northrop Grumman
  '502431109': 'LHX',    // L3Harris
  '50155Q100': 'KTOS',   // Kratos Defense
  '097023105': 'BA',     // Boeing
  // ── Healthcare & Biotech ───────────────────────────────────────────────────
  '75886F107': 'REGN',   // Regeneron
  '60770K107': 'MRNA',   // Moderna
  '532457108': 'LLY',    // Eli Lilly
  '670100205': 'NVO',    // Novo Nordisk ADR
  '00287Y109': 'ABBV',   // AbbVie
  '478160104': 'JNJ',    // Johnson & Johnson
  '717081103': 'PFE',    // Pfizer
  '91324P102': 'UNH',    // UnitedHealth
  // ── Financials ─────────────────────────────────────────────────────────────
  '46625H100': 'JPM',    // JPMorgan
  '38141G104': 'GS',     // Goldman Sachs
  '09247X101': 'BLK',    // BlackRock
  '92826C839': 'V',      // Visa
  '084670702': 'BRK',    // Berkshire Hathaway B (correct CUSIP)
  '084670108': 'BRK',    // Berkshire Hathaway A
  '14040H105': 'COF',    // Capital One Financial (was wrongly labeled BRK)
  '693475105': 'PNC',    // PNC Financial Services
  '808513105': 'SCHW',   // Charles Schwab
  '060505104': 'BAC',    // Bank of America
  '172967424': 'C',      // Citigroup
  '617446448': 'MS',     // Morgan Stanley
  '949746101': 'WFC',    // Wells Fargo
  '45866F104': 'ICE',    // Intercontinental Exchange
  '37045V100': 'GM',     // General Motors
  '01609W102': 'BABA',   // Alibaba ADR
  // ── Consumer & Retail ──────────────────────────────────────────────────────
  '191216100': 'KO',     // Coca-Cola
  '654106103': 'NKE',    // Nike
  '742718109': 'PG',     // Procter & Gamble
  '931142103': 'WMT',    // Walmart
  '437076102': 'HD',     // Home Depot
  '580135101': 'MCD',    // McDonald's
  '254687106': 'DIS',    // Walt Disney
  '778296103': 'ROST',   // Ross Stores
  '26142V105': 'DKNG',   // DraftKings
  // ── Telecom ────────────────────────────────────────────────────────────────
  '872590104': 'TMUS',   // T-Mobile US
  '00206R102': 'T',      // AT&T
  '92343V104': 'VZ',     // Verizon
  // ── Energy & Materials ─────────────────────────────────────────────────────
  '30231G102': 'XOM',    // ExxonMobil
  '20825C104': 'COP',    // ConocoPhillips
  '009158106': 'APD',    // Air Products & Chemicals
  '35671D857': 'FCX',    // Freeport-McMoRan
  '012653101': 'ALB',    // Albemarle
  '824348106': 'SHW',    // Sherwin-Williams
  // ── Other ──────────────────────────────────────────────────────────────────
  '22160K105': 'COST',   // Costco
  '78409V104': 'SPGI',   // S&P Global
  '34959J108': 'FTV',    // Fortive Corp
  '65339F101': 'NEE',    // NextEra Energy
  '70450Y103': 'PYPL',   // PayPal
  '00724F101': 'ADBE',   // Adobe
};

// 역방향 매핑 (ticker → CUSIP)
export const TICKER_TO_CUSIP: Record<string, string> = Object.fromEntries(
  Object.entries(CUSIP_TO_TICKER).map(([cusip, ticker]) => [ticker, cusip])
);

export const TICKER_TO_COMPANY: Record<string, string> = {
  NVDA: 'NVIDIA', AAPL: 'Apple', MSFT: 'Microsoft', AMZN: 'Amazon',
  GOOGL: 'Alphabet', META: 'Meta', TSLA: 'Tesla', TSM: 'TSMC',
  ASML: 'ASML', MU: 'Micron', AMD: 'AMD', INTC: 'Intel',
  LMT: 'Lockheed Martin', RTX: 'RTX', NOC: 'Northrop Grumman',
  LHX: 'L3Harris', BA: 'Boeing',
  REGN: 'Regeneron', MRNA: 'Moderna', LLY: 'Eli Lilly',
  ABBV: 'AbbVie', JNJ: 'Johnson & Johnson', PFE: 'Pfizer', UNH: 'UnitedHealth',
  ORCL: 'Oracle', COIN: 'Coinbase', FCX: 'Freeport-McMoRan',
  SMCI: 'Super Micro', DELL: 'Dell', MRVL: 'Marvell', KTOS: 'Kratos',
  KLAC: 'KLA', LRCX: 'Lam Research', AMAT: 'Applied Materials',
  ALB: 'Albemarle', NVO: 'Novo Nordisk', JPM: 'JPMorgan', GS: 'Goldman Sachs',
  BLK: 'BlackRock', AVGO: 'Broadcom', CSCO: 'Cisco',
  V: 'Visa', BRK: 'Berkshire Hathaway', COF: 'Capital One',
  PNC: 'PNC Financial', SCHW: 'Charles Schwab', BAC: 'Bank of America',
  C: 'Citigroup', MS: 'Morgan Stanley', WFC: 'Wells Fargo',
  ICE: 'Intercontinental Exchange', GM: 'General Motors', BABA: 'Alibaba',
  KO: 'Coca-Cola', NKE: 'Nike', PG: 'Procter & Gamble', WMT: 'Walmart',
  HD: 'Home Depot', MCD: "McDonald's", DIS: 'Disney', ROST: 'Ross Stores',
  DKNG: 'DraftKings', TMUS: 'T-Mobile', T: 'AT&T', VZ: 'Verizon',
  XOM: 'ExxonMobil', COP: 'ConocoPhillips', APD: 'Air Products', SHW: 'Sherwin-Williams',
  COST: 'Costco', SPGI: 'S&P Global', FTV: 'Fortive', NEE: 'NextEra Energy',
  PYPL: 'PayPal', ADBE: 'Adobe',
};

export const TICKER_TO_SECTOR: Record<string, string> = {
  NVDA: 'semiconductors', AAPL: 'technology', MSFT: 'technology',
  AMZN: 'technology', GOOGL: 'technology', META: 'technology',
  TSLA: 'ev-battery', TSM: 'semiconductors', ASML: 'semiconductors',
  MU: 'semiconductors', AMD: 'semiconductors', INTC: 'semiconductors',
  LMT: 'defense', RTX: 'defense', NOC: 'defense', LHX: 'defense', BA: 'defense',
  REGN: 'biotech', MRNA: 'biotech', LLY: 'pharma',
  ABBV: 'pharma', JNJ: 'pharma', PFE: 'pharma', UNH: 'healthcare',
  ORCL: 'cloud', COIN: 'crypto', FCX: 'mining',
  SMCI: 'infrastructure', DELL: 'hardware', MRVL: 'semiconductors',
  KTOS: 'defense', KLAC: 'semiconductors', LRCX: 'semiconductors',
  AMAT: 'semiconductors', ALB: 'ev-battery', NVO: 'pharma',
  JPM: 'finance', GS: 'finance', BLK: 'finance', AVGO: 'semiconductors', CSCO: 'technology',
  V: 'finance', BRK: 'finance', COF: 'finance',
  PNC: 'finance', SCHW: 'finance', BAC: 'finance',
  C: 'finance', MS: 'finance', WFC: 'finance', ICE: 'finance',
  GM: 'automotive', BABA: 'technology',
  KO: 'consumer', NKE: 'consumer', PG: 'consumer', WMT: 'consumer',
  HD: 'consumer', MCD: 'consumer', DIS: 'consumer', ROST: 'consumer', DKNG: 'consumer',
  TMUS: 'telecom', T: 'telecom', VZ: 'telecom',
  XOM: 'energy', COP: 'energy', APD: 'materials', SHW: 'materials',
  COST: 'consumer', SPGI: 'finance', FTV: 'industrial', NEE: 'utilities',
  PYPL: 'fintech', ADBE: 'software',
};

// ── 타입 정의 ──────────────────────────────────────────────────────────────────
export interface Filing13F {
  accNum: string;       // "0001234567-26-012345"
  filingDate: string;   // "2026-02-14"
  quarterEnd: string;   // "2025-12-31"
}

export interface Position13F {
  cusip: string;
  ticker: string;
  companyName: string;
  valueThousands: number;   // 원시 달러 단위 (SEC 13F XML <value> 필드 — 수천 단위 아님)
  shares: number;
}

export interface InstitutionHoldings {
  institution: string;
  filingDate: string;
  quarterEnd: string;
  positions: Position13F[];
  source: 'live' | 'error';
  error?: string;
}

// ── EDGAR API 유틸 ─────────────────────────────────────────────────────────────
function padCik(cik: string): string {
  return cik.replace(/^0+/, '').padStart(10, '0');
}

/** CIK에서 최근 13F-HR 제출 내역 조회 (최대 2건) */
export async function fetch13FFilings(cik: string): Promise<Filing13F[]> {
  const paddedCik = padCik(cik);
  const start = Date.now();
  const res = await fetch(
    `https://data.sec.gov/submissions/CIK${paddedCik}.json`,
    { headers: { 'User-Agent': EDGAR_UA }, signal: AbortSignal.timeout(8000), cache: 'no-store' }
  );
  if (!res.ok) {
    logger.warn('edgar.13f', 'submissions_http_error', { cik, status: res.status, durationMs: Date.now() - start });
    throw new Error(`EDGAR submissions HTTP ${res.status}`);
  }
  const data = await res.json();

  const recent = data?.filings?.recent ?? {};
  const forms: string[] = recent.form ?? [];
  const dates: string[] = recent.filingDate ?? [];
  const accNums: string[] = recent.accessionNumber ?? [];
  const periods: string[] = recent.reportDate ?? [];

  const filings: Filing13F[] = [];
  for (let i = 0; i < forms.length && filings.length < 2; i++) {
    if (forms[i] === '13F-HR') {
      filings.push({
        accNum: accNums[i],
        filingDate: dates[i],
        quarterEnd: periods[i] ?? '',
      });
    }
  }
  return filings;
}

/** 제출 인덱스에서 informationtable XML 파일명 찾기
 *  SEC EDGAR는 {accNum}-index.json 미지원.
 *  디렉터리 HTML 파싱으로 XML 탐색 후 informationtable 패턴 우선 반환.
 */
async function findInfoTableFile(cik: string, accNum: string): Promise<string | null> {
  const folder = accNum.replace(/-/g, '');
  const cikNum = cik.replace(/^0+/, '');
  const dirUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${folder}/`;

  try {
    const res = await fetch(dirUrl, {
      headers: { 'User-Agent': EDGAR_UA },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Extract XML filenames from directory listing hrefs
    const matches = Array.from(html.matchAll(/href="[^"]*\/([^/"]+\.xml)"/gi));
    const xmlFiles = matches.map(m => m[1]).filter(Boolean);
    // Prefer informationtable / infotable pattern
    const infoTable = xmlFiles.find(f => /info.?table/i.test(f));
    if (infoTable) return infoTable;
    // Fall back: any XML that isn't the primary cover doc
    const other = xmlFiles.find(f => !/primary.?doc/i.test(f) && !/xbrl/i.test(f));
    return other ?? xmlFiles[0] ?? null;
  } catch (err) {
    logger.warn('edgar.13f', 'index_fetch_error', { cik, accNum, error: err });
    return null;
  }
}

/**
 * informationtable XML 다운로드 및 파싱
 * 파일이 5MB 초과면 빈 배열 반환 (타임아웃 방지)
 */
export async function parseInfoTable(
  cik: string,
  accNum: string,
  maxSizeBytes = 8 * 1024 * 1024  // 8MB
): Promise<Position13F[]> {
  const start = Date.now();
  const xmlFile = await findInfoTableFile(cik, accNum);
  if (!xmlFile) {
    logger.warn('edgar.13f', 'no_info_table_file', { cik, accNum });
    return [];
  }

  const folder = accNum.replace(/-/g, '');
  const cikNum = cik.replace(/^0+/, '');
  const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${folder}/${xmlFile}`;

  const res = await fetch(xmlUrl, {
    headers: { 'User-Agent': EDGAR_UA },
    signal: AbortSignal.timeout(20000),
    cache: 'no-store',
  });
  if (!res.ok) {
    logger.warn('edgar.13f', 'xml_http_error', { cik, accNum, status: res.status, durationMs: Date.now() - start });
    return [];
  }

  // 크기 체크
  const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);
  if (contentLength > maxSizeBytes) {
    // 대형 파일: CUSIP 기반 부분 파싱 시도
    const text = await res.text();
    return extractPositions(text);
  }

  const text = await res.text();
  const positions = extractPositions(text);
  logger.info('edgar.13f', 'parsed', { cik, accNum, positions: positions.length, durationMs: Date.now() - start });
  return positions;
}

/** XML 텍스트에서 <infoTable> 블록 파싱 — ns1: namespace prefix 처리 포함 */
function extractPositions(xml: string): Position13F[] {
  const positions: Position13F[] = [];
  // ns1:infoTable (Viking Global 등) 과 infoTable (일반) 모두 처리
  const blocks = xml.match(/(?:<[a-z0-9]*:)?infoTable>([\s\S]*?)<\/(?:[a-z0-9]*:)?infoTable>/gi) ?? [];

  for (const block of blocks) {
    // ns1:cusip 과 cusip 모두 처리
    const cusip = (block.match(/<(?:[a-z0-9]*:)?cusip>(.*?)<\/(?:[a-z0-9]*:)?cusip>/i)?.[1] ?? '').trim();
    const ticker = CUSIP_TO_TICKER[cusip];
    if (!ticker) continue; // 추적 대상 아님

    const nameMatch = block.match(/<(?:[a-z0-9]*:)?nameOfIssuer>(.*?)<\/(?:[a-z0-9]*:)?nameOfIssuer>/i);
    const valueMatch = block.match(/<(?:[a-z0-9]*:)?value>(.*?)<\/(?:[a-z0-9]*:)?value>/i);
    const sharesMatch = block.match(/<(?:[a-z0-9]*:)?sshPrnamt>(.*?)<\/(?:[a-z0-9]*:)?sshPrnamt>/i);

    const valueThousands = parseInt((valueMatch?.[1] ?? '0').replace(/,/g, ''), 10);
    const shares = parseInt((sharesMatch?.[1] ?? '0').replace(/,/g, ''), 10);

    positions.push({
      cusip,
      ticker,
      companyName: nameMatch?.[1]?.trim() ?? TICKER_TO_COMPANY[ticker] ?? ticker,
      valueThousands,
      shares,
    });
  }
  return positions;
}

/** 기관 하나의 최신 + 직전 분기 13F 데이터 취득 */
export async function fetchInstitutionHoldings(
  name: string,
  cik: string,
): Promise<{ current: InstitutionHoldings; previous: InstitutionHoldings | null }> {
  const start = Date.now();
  const filings = await fetch13FFilings(cik);
  if (filings.length === 0) {
    logger.warn('edgar.13f', 'no_filings', { institution: name, cik });
    return {
      current: { institution: name, filingDate: '', quarterEnd: '', positions: [], source: 'error', error: 'No 13F-HR filings found' },
      previous: null,
    };
  }

  const [latest, prev] = filings;

  const [currentPositions, prevPositions] = await Promise.allSettled([
    parseInfoTable(cik, latest.accNum),
    prev ? parseInfoTable(cik, prev.accNum) : Promise.resolve([]),
  ]);

  if (currentPositions.status === 'rejected') {
    logger.error('edgar.13f', 'parse_failed', { institution: name, cik, accNum: latest.accNum, error: currentPositions.reason });
  }
  const posCount = currentPositions.status === 'fulfilled' ? currentPositions.value.length : 0;
  logger.info('edgar.13f', 'holdings_fetched', { institution: name, positions: posCount, durationMs: Date.now() - start });

  return {
    current: {
      institution: name,
      filingDate: latest.filingDate,
      quarterEnd: latest.quarterEnd,
      positions: currentPositions.status === 'fulfilled' ? currentPositions.value : [],
      source: 'live',
    },
    previous: prev ? {
      institution: name,
      filingDate: prev.filingDate,
      quarterEnd: prev.quarterEnd,
      positions: prevPositions.status === 'fulfilled' ? prevPositions.value : [],
      source: 'live',
    } : null,
  };
}

/** action 결정: 현재 포지션과 직전 분기 비교 */
export function determineAction(
  current: Position13F | undefined,
  previous: Position13F | undefined,
): 'accumulating' | 'reducing' | 'new_position' | 'exit' {
  if (!current && previous) return 'exit';
  if (current && !previous) return 'new_position';
  if (!current || !previous) return 'accumulating';
  if (current.shares > previous.shares * 1.02) return 'accumulating';
  if (current.shares < previous.shares * 0.98) return 'reducing';
  return 'accumulating'; // maintained → show as accumulating
}

/** 값 포맷 "$1.2B" / "$340M" — SEC 13F <value>는 원시 달러 단위 */
export function formatValue(valueDollars: number): string {
  if (valueDollars >= 1e9) return `$${(valueDollars / 1e9).toFixed(1)}B`;
  if (valueDollars >= 1e6) return `$${(valueDollars / 1e6).toFixed(0)}M`;
  return `$${(valueDollars / 1e3).toFixed(0)}K`;
}

/** sharesChanged 계산 */
export function calcSharesChanged(
  current: Position13F,
  previous: Position13F | undefined,
): number {
  if (!previous) return current.shares;
  return current.shares - previous.shares;
}
