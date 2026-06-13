#!/usr/bin/env node
/**
 * scripts/build-candidate-tickers.mjs
 * src/data/companies-batch*.ts + companies.ts 에서 titan + mega + large 종목 추출.
 * → data/candidate-tickers.json 생성. generate-report-local.mjs 가 로드.
 *
 * 실행: node scripts/build-candidate-tickers.mjs
 * Cron: 주 1회 권장 (S&P 500 구성 변경 반영)
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'src/data');

const seen = new Set();
const grouped = { titan: [], mega: [], large: [], mid: [], small: [] };
const fields = {}; // ticker -> { name, sector, market }

const files = readdirSync(DATA_DIR).filter(f => f.startsWith('companies-batch') || f === 'companies.ts' || f === 'heatmap-stocks.ts');
for (const f of files) {
  const c = readFileSync(resolve(DATA_DIR, f), 'utf8');
  // Position-based pairing: find each ticker, then nearest marketCap within 2000 chars after
  const tickerRe = /ticker:\s*['"]([A-Z0-9.\-]{1,8})['"]/g;
  let m;
  while ((m = tickerRe.exec(c)) !== null) {
    const ticker = m[1];
    if (seen.has(ticker)) continue;
    // Look ahead up to 3000 chars for marketCap
    const window = c.slice(m.index, m.index + 3000);
    // String 형태 (companies-batch): marketCap:'mega'
    const capStrMatch = window.match(/marketCap:\s*['"](\w+)['"]/);
    // 숫자 형태 (heatmap-stocks): marketCap: 3200 → $3.2T = titan
    const capNumMatch = !capStrMatch && window.match(/marketCap:\s*(\d+)/);
    const nameMatch = window.match(/name:\s*['"]([^'"]+)['"]/);
    const sectorMatch = window.match(/sector:\s*['"]([^'"]+)['"]/);
    let cap;
    if (capStrMatch) cap = capStrMatch[1];
    else if (capNumMatch) {
      const billion = parseInt(capNumMatch[1]);
      cap = billion >= 1000 ? 'titan' : billion >= 200 ? 'mega' : billion >= 10 ? 'large' : 'mid';
    } else cap = 'large'; // 폴백
    if (!grouped[cap]) continue;
    seen.add(ticker);
    grouped[cap].push(ticker);
    fields[ticker] = {
      name: nameMatch?.[1] ?? ticker,
      sector: sectorMatch?.[1] ?? 'Unknown',
      cap,
    };
  }
}

// ETF + KR (hardcoded — not in companies-batch files)
// 2026-06-04: 유명 ETF 망라(레버리지/인버스 제외 — CLAUDE.md 차단). prune-dead 가 무효 티커 자동 제거.
const ETF_TICKERS = [
  // Broad US + index
  'SPY','VOO','IVV','VTI','ITOT','SPLG','QQQ','QQQM','DIA','IWM','IJR','IJH','MDY','VB','VO','RSP',
  // Style (성장/가치/퀄/저변동/모멘텀)
  'VUG','VTV','IWF','IWD','IWB','VIG','SCHG','QUAL','USMV','SPLV','MTUM','MAGS','MOAT',
  // 11 GICS 섹터 (SPDR) + Vanguard 섹터
  'XLK','XLE','XLF','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC',
  'VGT','VHT','VFH','VDE','VPU','VNQ',
  // 테마/산업
  'SMH','SOXX','IGV','IYW','FDN','SKYY','WCLD','AIQ','BOTZ','CIBR','HACK','ARKK','ARKG','ARKW','ARKF','FINX',
  'XBI','IBB','KWEB','ICLN','TAN','GDX','GDXJ','URA','LIT','JETS','XME','XOP','KRE','ITB','PAVE',
  // 지역
  'EWY','EWJ','FXI','MCHI','ASHR','GXC','VGK','EFA','IEFA','VEA','SCHF','VWO','EEM','IEMG','EWG','EWU','EWC','EWW',
  'EWT','EWH','EWS','INDA','EPI','THD','EIDO','EPHE','TUR','EWA','EWZ','EZA','EWQ','EWL','EWN','EWP',
  // 원자재
  'GLD','IAU','SLV','PPLT','USO','BNO','UNG','DBA','CORN','WEAT','PDBC','CPER',
  // 채권
  'TLT','IEF','SHY','GOVT','AGG','BND','BNDX','LQD','VCIT','VCSH','HYG','JNK','EMB','MUB','TIP','SGOV','BIL','MBB',
  // 배당/인컴
  'SCHD','VYM','DGRO','NOBL','HDV','SPYD','JEPI','JEPQ','QYLD',
  // 암호화폐 현물/선물
  'IBIT','FBTC','ETHA','BITO',
  // 변동성
  'VXX',
  // 레버리지/인버스 (2026-06-04 사용자 요청 — 모니터링 풀만. 보고서 매수추천엔 CLAUDE.md BLOCKED 규칙 +
  //   ETF_META 미포함으로 제외. /company·heatmap 등 가시화용.)
  'TQQQ','SQQQ','UPRO','SPXU','SPXL','SPXS','SOXL','SOXS','TNA','TZA','UDOW','SDOW',
  'QLD','QID','SSO','SDS','TECL','TECS','FAS','FAZ','LABU','LABD','NUGT','DUST',
  'YINN','YANG','TMF','TMV','BOIL','KOLD','UCO','SCO','UVXY','SVXY','SH','PSQ','FNGU','BULZ',
];
// 2026-05-29: hardcoded 29개 → companies-kr.ts 의 242개 (KOSPI 132 + KOSDAQ 108) 활용.
// stockCode 6자리 + market (KOSPI→.KS / KOSDAQ→.KQ) 자동 매핑. sector 도 메타에 반영.
const KR_TICKERS = {};
const KR_META = {};
try {
  const krFile = readFileSync(resolve(DATA_DIR, 'companies-kr.ts'), 'utf8');
  const krEntries = [...krFile.matchAll(
    /stockCode:\s*"(\d{6})"[^}]*?name:\s*"([^"]+)"[^}]*?market:\s*"(KOSPI|KOSDAQ)"[^}]*?sector:\s*"([^"]+)"/g
  )];
  for (const [, code, name, market, sector] of krEntries) {
    const ticker = code + (market === 'KOSPI' ? '.KS' : '.KQ');
    KR_TICKERS[ticker] = name;
    KR_META[ticker] = { name, sector, cap: 'kr', market: market.toLowerCase() };
  }
  console.log(`[KR] companies-kr.ts 에서 ${krEntries.length}개 로드 (KOSPI ${Object.values(KR_META).filter(m=>m.market==='kospi').length} + KOSDAQ ${Object.values(KR_META).filter(m=>m.market==='kosdaq').length})`);
} catch (e) {
  console.warn('[KR] companies-kr.ts 로드 실패, hardcoded fallback:', e.message);
  Object.assign(KR_TICKERS, {
    '005930.KS':'삼성전자','000660.KS':'SK하이닉스','373220.KS':'LG에너지솔루션',
    '005380.KS':'현대차','035420.KS':'NAVER','035720.KS':'카카오',
  });
}

// 2026-05-29: KOSPI 200 + KOSDAQ 150 자동 보장 — kr-major-indexes.json
// (fetch-kospi200-kosdaq150.mjs 산출물, Naver finance 시총 상위 기반).
try {
  const krIdx = JSON.parse(readFileSync(resolve(ROOT, 'data/kr-major-indexes.json'), 'utf8'));
  let added = 0;
  for (const t of [...(krIdx.kospi?.tickers ?? []), ...(krIdx.kosdaq?.tickers ?? [])]) {
    if (KR_TICKERS[t]) continue;
    const meta = krIdx.kospi?.meta?.[t] ?? krIdx.kosdaq?.meta?.[t] ?? {};
    KR_TICKERS[t] = meta.name ?? t;
    KR_META[t] = {
      name: meta.name ?? t,
      sector: 'KR',
      cap: 'kr',
      market: meta.market?.toLowerCase() ?? (t.endsWith('.KQ') ? 'kosdaq' : 'kospi'),
    };
    added++;
  }
  console.log(`[KR-IDX] kr-major-indexes (KOSPI ${krIdx.kospi?.total} + KOSDAQ ${krIdx.kosdaq?.total}) → ${added}개 추가`);
} catch (e) {
  console.warn('[KR-IDX] kr-major-indexes.json 로드 실패: ' + e.message);
}

// 2026-05-29: S&P 500 자동 보장 — sp500-tickers.json (fetch-sp500-list.mjs 산출물).
// candidate 에 없는 S&P 500 종목 자동 추가 (large 대역 + sp500=true 메타).
const SP500_ADDED = {};
try {
  const sp500 = JSON.parse(readFileSync(resolve(ROOT, 'data/sp500-tickers.json'), 'utf8'));
  const existing = new Set([
    ...grouped.titan, ...grouped.mega, ...grouped.large, ...grouped.mid,
  ]);
  let added = 0;
  for (const t of sp500.tickers) {
    if (existing.has(t)) continue;
    // candidate 의 dot 형식 (BRK.B) 도 동일 매칭
    if (existing.has(t.replace('-', '.'))) continue;
    grouped.large.push(t);
    SP500_ADDED[t] = {
      name: sp500.meta?.[t]?.name ?? t,
      sector: sp500.meta?.[t]?.sector ?? 'Unknown',
      cap: 'large',
      sp500: true,
    };
    added++;
  }
  console.log(`[SP500] ${sp500.tickers.length} 종목 중 ${added}개 누락 → large 대역 자동 추가`);
} catch (e) {
  console.warn('[SP500] sp500-tickers.json 로드 실패 (수동 fetch 권장): ' + e.message);
}

// 추천 가능 풀 = titan + mega + large + mid + ETF + KR
// (small 34개는 유동성 약함 — 제외)
// mid 포함 = small-cap premium factor (Fama-French SMB) 활용
// 2026-06-04: 거래불가 종목 제외 — (a) 외국거래소 suffix 규칙, (b) prune-dead-tickers.mjs 가
//   생성한 delisted-tickers.json(상장폐지/피인수, 데이터 기반). 죽은 티커가 풀에 남아 LLM 점수·NE 환각 노이즈.
const FOREIGN_SUFFIX = /\.(T|HK|L|TO|PA|DE|SW|AS|MI|MC|ST|HE|OL|CO|VX|SI|AX|NZ|TW|SS|SZ|F|BR|MX|JO|IS)$/;
let DELISTED = new Set();
try {
  const dl = JSON.parse(readFileSync(resolve(ROOT, 'data/delisted-tickers.json'), 'utf8'));
  DELISTED = new Set((dl.tickers || []).map(t => t.toUpperCase()));
  console.log(`[prune] delisted-tickers.json 로드: ${DELISTED.size} 제외 (외국 ${dl.foreign?.length ?? 0} + 폐지 ${dl.noPrice?.length ?? 0})`);
} catch { /* prune-dead-tickers.mjs 미실행 — 제외 없음 */ }
const isDead = (t) => FOREIGN_SUFFIX.test(t) || DELISTED.has((t || '').toUpperCase());

const candidate = [
  ...grouped.titan,
  ...grouped.mega,
  ...grouped.large,
  ...grouped.mid,
  ...ETF_TICKERS,
  ...Object.keys(KR_TICKERS),
].filter(t => !isDead(t));

const out = {
  generatedAt: new Date().toISOString(),
  total: candidate.length,
  byBand: {
    titan: grouped.titan.length,
    mega: grouped.mega.length,
    large: grouped.large.length,
    mid: grouped.mid.length,
    etf: ETF_TICKERS.length,
    kr: Object.keys(KR_TICKERS).length,
  },
  tickers: candidate,
  // ticker → meta (sector, cap, name). 2026-06-04: 최종 pool(candidate)에 있는 ticker 만 — 죽은/풀외
  //   ticker 의 stale meta 제거(alias probe [11] meta-stale 경고 해소).
  meta: Object.fromEntries([
    ...Object.entries(fields),
    ...ETF_TICKERS.map(t => [t, { name: t, sector: 'ETF', cap: 'etf' }]),
    ...Object.entries(KR_TICKERS).map(([t, name]) => [t, KR_META[t] ?? { name, sector: 'KR', cap: 'kr' }]),
    ...Object.entries(SP500_ADDED),
  ].filter(([t]) => new Set(candidate).has(t))),
  krNames: KR_TICKERS,
};

// ── 2026-06-13: 라이브 시총 재분류 (사용자 "티어 stale — 미루지 말고 개선"). 정적 enum 은
//    2026년초 스냅샷이라 종목 성장/축소 시 어긋남 (rotation pool 의 티어 랭킹/분산에 사용됨).
//    Yahoo v7 crumb 배치로 US 후보 전량 실시총 조회 → 임계 재분류. 실패 종목은 정적 유지.
async function retierWithLiveCaps(metaObj) {
  const usTickers = Object.keys(metaObj).filter(t => !/\.(KS|KQ)$/.test(t) && metaObj[t].cap !== 'etf');
  if (!usTickers.length) return 0;
  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    const cr = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(8000) });
    const cookie = (cr.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
    const crumb = await (await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': ua, Cookie: cookie }, signal: AbortSignal.timeout(8000) })).text();
    if (!crumb || crumb.includes('<')) { console.warn('  [retier] crumb 실패 — 정적 티어 유지'); return 0; }
    let changed = 0;
    for (let i = 0; i < usTickers.length; i += 100) {
      const batch = usTickers.slice(i, i + 100).map(t => t.replace(/\./g, '-'));
      const u = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(batch.join(','))}&fields=marketCap&crumb=${encodeURIComponent(crumb)}`;
      const r = await fetch(u, { headers: { 'User-Agent': ua, Cookie: cookie }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const j = await r.json();
      for (const q of j?.quoteResponse?.result ?? []) {
        const t = q.symbol?.replace(/-/g, '.');
        const cap = q.marketCap;
        if (!t || !metaObj[t] || !cap) continue;
        const tier = cap >= 1e12 ? 'titan' : cap >= 2e11 ? 'mega' : cap >= 1e10 ? 'large' : cap >= 2e9 ? 'mid' : 'small';
        if (metaObj[t].cap !== tier) { metaObj[t].cap = tier; changed++; }
      }
      await new Promise(res => setTimeout(res, 300));
    }
    return changed;
  } catch (e) { console.warn(`  [retier] 실패(정적 유지): ${String(e?.message).slice(0, 60)}`); return 0; }
}
const retiered = await retierWithLiveCaps(out.meta);
if (retiered) {
  // byBand 재집계 (meta 기준)
  const counts = { titan: 0, mega: 0, large: 0, mid: 0, small: 0 };
  for (const m of Object.values(out.meta)) if (counts[m.cap] != null) counts[m.cap]++;
  out.byBand = { ...out.byBand, ...counts };
  console.log(`  [retier] 라이브 시총 재분류 ${retiered}건`);
}

const outPath = resolve(ROOT, 'data/candidate-tickers.json');
// 2026-06-14: enrich-sectors.mjs 가 채운 실제 sector 를 재빌드 시 보존 (덮어쓰기 방지).
//   재빌드는 KR_META 미수록 KR 을 sector:'KR' generic 으로 되돌리는데, 그러면 enrich 결과가 wipe 되어
//   LLM 환각(HPSP="차량") 이 재발 → 사용자 "왜 자꾸 사각지대". 기존 real sector 면 유지.
try {
  const prev = JSON.parse(readFileSync(outPath, 'utf8'));
  const generic = s => !s || s === 'KR' || s === 'kr' || s === 'Unknown' || s === '';
  let kept = 0;
  for (const [t, m] of Object.entries(out.meta)) {
    const ps = prev.meta?.[t]?.sector;
    if (generic(m.sector) && !generic(ps)) { m.sector = ps; kept++; }
  }
  if (kept) console.log(`  [sector-preserve] enrich 결과 ${kept}건 유지 (재빌드 generic 되돌림 방지)`);
} catch { /* 최초 빌드 — prev 없음 */ }
writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

console.log(`✅ ${candidate.length} candidates → ${outPath}`);
console.log(`  titan: ${out.byBand.titan} | mega: ${out.byBand.mega} | large: ${out.byBand.large} | ETF: ${out.byBand.etf} | KR: ${out.byBand.kr}`);
