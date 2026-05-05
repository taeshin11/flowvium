#!/usr/bin/env node
/**
 * DART OpenAPI로 KOSPI + KOSDAQ 기업 목록을 생성합니다.
 *
 * 방식:
 *   1. DART CORPCODE.xml ZIP 다운로드 (PowerShell 압축 해제)
 *   2. XML 파싱 → stock_code 있는 상장사만 추출 (stockCode → corpCode 맵)
 *   3. 우선순위 종목코드 목록 기준으로 company.json 배치 호출
 *      → corp_cls(KOSPI/KOSDAQ), 업종, CEO, 설립일 등 수집
 *   4. src/data/companies-kr.ts 자동 생성
 *
 * 사용법: node scripts/generate-kr-company-list.mjs
 * 환경변수: DART_API_KEY (.env.local 자동 로드)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

// .env.local 로드
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const DART_API_KEY = process.env.DART_API_KEY;
if (!DART_API_KEY) {
  console.error('❌ DART_API_KEY 환경변수가 없습니다.');
  process.exit(1);
}

const DART_BASE = 'https://opendart.fss.or.kr/api';
const BATCH_SIZE = 5;
const BATCH_DELAY = 600;

// ── 시총 우선순위 종목코드 목록 ──────────────────────────────────────────────
// KOSPI (KOSPI 200 기준 상위 종목)
const KOSPI_PRIORITY = [
  '005930','000660','207940','373220','005380','000270','051910','068270',
  '035420','028260','105560','055550','012330','066570','003550','032830',
  '096770','017670','030200','086790','003490','034730','015760','010130',
  '005490','032640','047050','011070','009150','316140','000810','033780',
  '138040','009830','071050','010950','000100','018260','034020','035720',
  '006400','024110','036460','001040','097950','078930','011200','004020',
  '011780','042660','008770','003230','185750','000720','028050','047040',
  '000210','064350','180640','090430','051900','001450','039570','016880',
  '002790','021240','041510','036570','251270','293490','115390','086280',
  '000990','012450','054180','272210','042700','000120','069620','267250',
  '079550','175330','192820','039200','271560','007310','241560','042670',
  '352820','326030','214450','200130','069960','006280','161390','004990',
  '016360','009020','004800','054620','003670','053000','082800','067830',
  '002310','010620','007070','080880','000080','005810','001680','073960',
  '003410','139480','030000','047810','010140','082740','054780','086520',
  '000120','069620','055660','214150','032350','188350','003230','004415',
  '002600','011390','011760','227840','036800','031430','073960','003960',
  '245620','001680','002070','016580','003030','001120','010280','058430',
  '005200','042000','001800','002025','029530','009000','021040','023790',
];

// KOSDAQ 150 기준 상위 종목
const KOSDAQ_PRIORITY = [
  '247540','086520','091990','357780','058470','041830','035760','018290',
  '091480','101680','048410','073540','078600','237690','064760','048530',
  '032500','054450','267260','067160','220130','095700','053350','229220',
  '145020','039030','032280','049480','123600','100120','080160','214150',
  '039290','168490','352480','065690','049990','009420','130740','030520',
  '258750','102310','131970','108490','052600','041960','093050','199480',
  '190650','122870','089470','060300','049630','203650','027830','050890',
  '048870','215600','196170','094970','095910','219130','086900','038460',
  '112610','078130','190510','065500','069510','068840','014710','220100',
  '079190','107640','007390','044060','093500','036640','053800','063570',
  '224880','100050','089600','093380','054490','036540','033160','038870',
  '234080','054540','043370','024120','060870','199800','034230','046080',
  '078650','104830','222080','054040','048260','214420','036800','025900',
  '050540','017040','056730','209900','032350','073640','098460','234080',
  '100120','081000','066570','044990','019570','037400','036800','025870',
  '199800','034230','046080','093500','219130','052790','026040','057760',
  '040460','053680','036810','205100','199480','190510','065500','069510',
];

// ── XML 파싱: stock_code 있는 상장사 → stockCode→corpCode 맵 ──────────────
function buildCorpCodeMap(xml) {
  const map = new Map();
  const listRegex = /<list>([\s\S]*?)<\/list>/g;
  let match;
  while ((match = listRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m ? m[1].trim() : '';
    };
    const corpCode  = get('corp_code');
    const stockCode = get('stock_code').trim();
    const corpName  = get('corp_name');
    // stock_code가 6자리 숫자인 경우만 상장사
    if (/^\d{6}$/.test(stockCode) && corpCode) {
      map.set(stockCode, { corpCode, corpName });
    }
  }
  return map;
}

// ── DART company.json → corp_cls + 업종 등 ───────────────────────────────────
async function fetchCorpDetail(corpCode) {
  const params = new URLSearchParams({ crtfc_key: DART_API_KEY, corp_code: corpCode });
  try {
    const res = await fetch(`${DART_BASE}/company.json?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== '000') return null;
    return {
      corpCls:    json.corp_cls ?? '',      // 'Y'=KOSPI, 'K'=KOSDAQ, 'N'=KONEX
      indutyCode: json.induty_code ?? '',
      ceoName:    json.ceo_nm ?? '',
      established: json.est_dt ?? '',
      homepage:   json.hm_url ?? '',
    };
  } catch { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 한국표준산업분류(KSIC) 코드 → 영문 섹터 매핑
// 코드 앞자리가 일치하는 가장 긴 prefix 우선 적용
const KSIC_MAP = [
  // 정보통신
  ['6312', 'IT Services'],
  ['631',  'IT Services'],
  ['632',  'Software'],
  ['641',  'Telecom'],
  ['642',  'Telecom'],
  ['643',  'Telecom'],
  ['659',  'Entertainment'],  // 영상·방송
  ['602',  'Entertainment'],
  // 금융·보험
  ['641',  'Banking'],
  ['642',  'Banking'],
  ['643',  'Telecom'],
  ['651',  'Insurance'],
  ['652',  'Insurance'],
  ['661',  'Financial Services'],
  ['662',  'Financial Services'],
  ['663',  'Financial Services'],
  ['64',   'Banking'],
  ['65',   'Insurance'],
  ['66',   'Financial Services'],
  // 제조업 — 전자·반도체
  // 반도체 (261x: 집적회로 제조)
  ['2611', 'Semiconductors'],  // 메모리 반도체 (SK하이닉스 등)
  ['2612', 'Semiconductors'],  // 비메모리·기타 반도체
  ['261',  'Semiconductors'],  // 반도체 제조업 일반
  // 전자·IT
  ['264',  'Technology'],      // 통신·방송장비 (삼성전자, LG전자)
  ['263',  'Technology'],      // 통신장비
  ['262',  'Technology'],      // 컴퓨터·주변기기
  ['265',  'Technology'],      // 측정·항법·광학기기
  ['272',  'Medical Devices'], // 의료기기
  ['268',  'Display'],         // 표시장치(디스플레이)
  // 배터리·전기장비
  ['28202','Battery'],
  ['2820', 'Battery'],
  ['282',  'Electrical Equipment'],
  ['281',  'Electrical Equipment'],
  // 자동차·운송
  ['3012', 'Automotive'],
  ['3011', 'Automotive'],
  ['301',  'Automotive'],
  ['302',  'Transportation Equipment'],
  ['303',  'Transportation Equipment'],
  // 화학
  ['201',  'Chemicals'],
  ['202',  'Chemicals'],
  ['203',  'Chemicals'],
  ['204',  'Chemicals'],
  ['205',  'Chemicals'],
  ['206',  'Chemicals'],
  ['20',   'Chemicals'],
  // 의약품·바이오
  ['211',  'Healthcare'],
  ['212',  'Healthcare'],
  ['21',   'Healthcare'],
  // 철강·금속
  ['241',  'Metals & Mining'],
  ['242',  'Metals & Mining'],
  ['243',  'Metals & Mining'],
  ['244',  'Metals & Mining'],
  ['24',   'Metals & Mining'],
  // 기계
  ['291',  'Industrials'],
  ['292',  'Industrials'],
  ['29',   'Industrials'],
  // 건설
  ['41',   'Construction'],
  ['42',   'Construction'],
  // 유통·도소매
  ['46',   'Wholesale'],
  ['47',   'Retail'],
  // 음식료
  ['10',   'Consumer Staples'],
  ['11',   'Consumer Staples'],
  ['12',   'Consumer Staples'],
  // 섬유·의류
  ['13',   'Textiles'],
  ['14',   'Textiles'],
  // 에너지
  ['35',   'Energy'],
  ['19',   'Energy'],          // 석유정제
  // 운수·물류
  ['49',   'Transportation'],
  ['50',   'Transportation'],
  ['51',   'Transportation'],
  ['52',   'Transportation'],
  // 부동산
  ['68',   'Real Estate'],
  // 서비스
  ['56',   'Hospitality'],
  ['55',   'Hospitality'],
  ['63',   'IT Services'],
  ['69',   'Professional Services'],
  ['70',   'Professional Services'],
  ['71',   'Professional Services'],
  ['75',   'Professional Services'],
  // 예술·엔터테인먼트
  ['90',   'Entertainment'],
  ['91',   'Entertainment'],
];

function mapSector(code) {
  if (!code) return 'Other';
  const c = String(code).trim();
  // 가장 긴 prefix 매칭 우선
  let best = null;
  for (const [prefix, sector] of KSIC_MAP) {
    if (c.startsWith(prefix)) {
      if (!best || prefix.length > best[0].length) best = [prefix, sector];
    }
  }
  return best ? best[1] : 'Other';
}

// ── 메인 ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== DART CORPCODE.xml 기반 한국 기업 목록 생성 ===\n');

  const tmpDir = resolve(tmpdir(), 'dart-corpcode-' + Date.now());
  mkdirSync(tmpDir, { recursive: true });
  const zipPath = resolve(tmpDir, 'CORPCODE.zip');

  // 1. ZIP 다운로드
  console.log('[1/5] CORPCODE.xml ZIP 다운로드...');
  const zipUrl = `${DART_BASE}/corpCode.xml?crtfc_key=${DART_API_KEY}`;
  const zipRes = await fetch(zipUrl, { signal: AbortSignal.timeout(30000) });
  if (!zipRes.ok) { console.error(`❌ HTTP ${zipRes.status}`); process.exit(1); }
  writeFileSync(zipPath, Buffer.from(await zipRes.arrayBuffer()));
  console.log(`  저장: ${zipPath}`);

  // 2. PowerShell 압축 해제
  console.log('[2/5] ZIP 압축 해제...');
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`,
    { stdio: 'pipe' }
  );
  const xmlPath = resolve(tmpDir, 'CORPCODE.xml');
  const xml = readFileSync(xmlPath, 'utf8');
  console.log(`  XML 크기: ${(xml.length / 1024).toFixed(1)} KB`);

  // 3. 파싱 → stockCode→corpCode 맵
  console.log('[3/5] XML 파싱 (상장사 필터링)...');
  const corpCodeMap = buildCorpCodeMap(xml);
  console.log(`  상장사 (stock_code 있음): ${corpCodeMap.size}개`);

  // 우선순위 목록에서 CORPCODE.xml에 있는 종목만 선택
  const allPriority = [
    ...KOSPI_PRIORITY.map(s => ({ stockCode: s, market: 'KOSPI' })),
    ...KOSDAQ_PRIORITY.map(s => ({ stockCode: s, market: 'KOSDAQ' })),
  ];
  // 중복 제거 (같은 종목이 두 목록에 있을 경우 KOSPI 우선)
  const seen = new Set();
  const deduped = allPriority.filter(({ stockCode }) => {
    if (seen.has(stockCode)) return false;
    seen.add(stockCode);
    return true;
  });

  const selected = deduped
    .filter(({ stockCode }) => corpCodeMap.has(stockCode))
    .map(({ stockCode, market }) => ({
      stockCode,
      market,
      ...corpCodeMap.get(stockCode),
    }));

  const notFound = deduped.filter(({ stockCode }) => !corpCodeMap.has(stockCode)).map(s => s.stockCode);
  console.log(`  선택: ${selected.length}개 (미발견: ${notFound.length}개: ${notFound.slice(0,10).join(',')})${notFound.length > 10 ? '...' : ''}`);

  // 4. company.json 배치 호출 → corp_cls + 업종
  console.log(`[4/5] company.json 업종/분류 조회 (${selected.length}개)...`);
  const enriched = [];
  let kospiCount = 0, kosdaqCount = 0, unknownCount = 0;

  for (let i = 0; i < selected.length; i += BATCH_SIZE) {
    const batch = selected.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  [${i + 1}-${Math.min(i + BATCH_SIZE, selected.length)}/${selected.length}] `);
    const results = await Promise.all(
      batch.map(async (c) => {
        const d = await fetchCorpDetail(c.corpCode);
        const corpCls = d?.corpCls ?? '';
        // corp_cls 우선, 없으면 priority list의 market 사용
        const finalMarket = corpCls === 'Y' ? 'KOSPI' : corpCls === 'K' ? 'KOSDAQ' : c.market;
        return {
          stockCode: c.stockCode,
          corpCode: c.corpCode,
          corpName: c.corpName,
          market: finalMarket,
          corpCls: corpCls || (c.market === 'KOSPI' ? 'Y' : 'K'),
          indutyCode: d?.indutyCode ?? '',
          ceoName: d?.ceoName ?? '',
          established: d?.established ?? '',
          homepage: d?.homepage ?? '',
        };
      })
    );
    for (const r of results) {
      if (r.corpCls === 'Y') kospiCount++;
      else if (r.corpCls === 'K') kosdaqCount++;
      else unknownCount++;
    }
    enriched.push(...results);
    const withSector = results.filter(r => r.indutyCode).length;
    process.stdout.write(`${withSector}/${results.length} 업종\n`);
    if (i + BATCH_SIZE < selected.length) await sleep(BATCH_DELAY);
  }

  console.log(`  KOSPI: ${kospiCount}개 / KOSDAQ: ${kosdaqCount}개 / 기타: ${unknownCount}개`);

  // 5. TS 파일 생성
  console.log('[5/5] companies-kr.ts 생성...');

  const lines = [
    '/**',
    ' * @generated — 수동 편집 금지',
    ' * 생성 방법: node scripts/generate-kr-company-list.mjs',
    ` * 생성일시: ${new Date().toISOString()}`,
    ' * 데이터 소스: DART OpenAPI CORPCODE.xml + company.json',
    ' *',
    ' * 포함: 종목코드, DART 법인코드, 회사명, 시장구분, 섹터 (구조적 메타데이터만)',
    ' * 재무 데이터(매출/이익/자산)는 /api/company-kr/[ticker] 에서 실시간 제공',
    ' */',
    '',
    "export type KRMarket = 'KOSPI' | 'KOSDAQ';",
    '',
    'export interface KRCompany {',
    "  stockCode: string;    // 6자리 종목코드 (예: '005930')",
    "  corpCode: string;     // DART 8자리 법인코드 (예: '00126380')",
    '  name: string;',
    '  market: KRMarket;',
    '  sector: string;       // 영문 섹터',
    '  sectorKR: string;     // DART 원본 업종코드',
    '  homepage: string;',
    '  ceoName: string;',
    '  established: string;  // YYYYMMDD',
    '}',
    '',
    'export const companiesKR: KRCompany[] = [',
    ...enriched.map(c => {
      const sectorEN = mapSector(c.indutyCode);
      return `  { stockCode: ${JSON.stringify(c.stockCode)}, corpCode: ${JSON.stringify(c.corpCode)}, name: ${JSON.stringify(c.corpName)}, market: ${JSON.stringify(c.market)}, sector: ${JSON.stringify(sectorEN)}, sectorKR: ${JSON.stringify(c.indutyCode)}, homepage: ${JSON.stringify(c.homepage)}, ceoName: ${JSON.stringify(c.ceoName)}, established: ${JSON.stringify(c.established)} },`;
    }),
    '];',
    '',
    'export const krCompanyMap = new Map<string, KRCompany>(',
    '  companiesKR.map(c => [c.stockCode, c])',
    ');',
    '',
    'export const krCorpCodeMap = new Map<string, KRCompany>(',
    '  companiesKR.map(c => [c.corpCode, c])',
    ');',
    '',
    "export const kospi200 = companiesKR.filter(c => c.market === 'KOSPI');",
    "export const kosdaq150 = companiesKR.filter(c => c.market === 'KOSDAQ');",
  ];

  const outPath = resolve(process.cwd(), 'src/data/companies-kr.ts');
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  rmSync(tmpDir, { recursive: true });

  console.log(`\n✅ 생성 완료: ${outPath}`);
  console.log(`   KOSPI: ${kospiCount}개 / KOSDAQ: ${kosdaqCount}개 / 총: ${enriched.length}개`);
}

main().catch(err => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
