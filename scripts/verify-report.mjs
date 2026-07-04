#!/usr/bin/env node
// Quick verification of a report JSON. Usage: node scripts/verify-report.mjs <path>
//
// 2026-05-30 Karpathy closed loop: 결함을 defects 배열로 모아 caller 가 DB 적재 가능.
// CLI 호환 유지 (console.log) + verifyReport(file, opts) 함수 export.
import fs from 'node:fs';

// 2026-05-31: 최신 보고서 자동 선택. 이전엔 default 가 'report-2026-05-30-morning-ko.json'
//   하드코딩 → verify-all / cron verify-loop 가 며칠째 stale 보고서만 검증 (silent 사각지대).
//   파일명 report-YYYY-MM-DD-{morning|afternoon|evening}-ko.json 의 날짜+세션 순으로 최신 선택.
const SESSION_RANK = { midnight: 0, morning: 1, noon: 2, afternoon: 3, evening: 4 };
export function pickLatestReport(dir = 'reports') {
  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }
  const matched = files
    .map(f => f.match(/^report-(\d{4}-\d{2}-\d{2})-(midnight|morning|noon|afternoon|evening)-[a-z-]+\.json$/i))
    .filter(Boolean)
    .map(m => ({ file: `${dir}/${m[0]}`, date: m[1], rank: SESSION_RANK[m[2].toLowerCase()] ?? -1 }));
  if (!matched.length) return null;
  matched.sort((a, b) => (a.date === b.date ? b.rank - a.rank : b.date.localeCompare(a.date)));
  return matched[0].file;
}

// CANDIDATE_TICKERS meta lookup (LLM sector 환각 cross-reference 용)
// 2026-06-17 전수조사 detector-tuning: 파일 missing/corrupt/empty 여부를 추적해 probe 가 silent
//   green("✅ 0건 검증") 대신 "검증 불가" 결함을 push 하도록 _LOADED 플래그를 노출 (CPRT 류 누락 방지).
let CANDIDATE_META = {};
let CANDIDATE_META_LOADED = false;
try {
  const data = JSON.parse(fs.readFileSync('data/candidate-tickers.json', 'utf8'));
  CANDIDATE_META = data.meta ?? {};
  CANDIDATE_META_LOADED = Object.keys(CANDIDATE_META).length > 0;
} catch { /* skip — CANDIDATE_META_LOADED=false 로 probe 가 결함 보고 */ }

// 2026-06-03 CPRT→"Cypress Semiconductor" 사건: ticker↔회사명 검증이 전혀 없었음(검증 사각지대).
//   company-names.json(companies-batch*.ts 추출 ~499 실제명) 을 권위 소스로 name 환각 cross-check.
// 2026-06-17 전수조사 detector-tuning: 파일 missing/corrupt 시 빈 {} 로 green pass 되던 사각지대 —
//   COMPANY_NAMES_LOADED 로 권위 소스 부재를 명시적 결함으로 surface.
let COMPANY_NAMES = {};
let COMPANY_NAMES_LOADED = false;
try {
  COMPANY_NAMES = JSON.parse(fs.readFileSync('data/company-names.json', 'utf8'));
  COMPANY_NAMES_LOADED = Object.keys(COMPANY_NAMES).length > 0;
} catch { /* build-company-names.mjs 미실행 — COMPANY_NAMES_LOADED=false 로 probe 가 결함 보고 */ }

const NAME_SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|companies|ltd|limited|plc|llc|lp|holdings?|group|the|technologies|technology|sa|nv|ag|se)\b/g;
function normName(s) {
  return String(s || '').toLowerCase().replace(/[.,&'"()\-]/g, ' ').replace(NAME_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}
function nameMatches(a, b) {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return true;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// sector → 금지 키워드 (한글). semiconductors/it 회사에 "건설", financials 에 "반도체" 등.
// 2026-05-31: export — generate-report-local 의 rationale strip 과 단일 source of truth.
export const SECTOR_FORBID = {
  technology:               ['건설', '석유', '광물', '유틸리티', '소비재', '제약', '바이오', '의류', '식품'],
  semiconductor:            ['건설', '석유', '광물', '유틸리티', '소비재', '제약', '바이오', '의류', '식품'],
  semiconductors:           ['건설', '석유', '광물', '유틸리티', '소비재', '제약', '바이오', '의류', '식품'],
  'it services':            ['건설', '석유', '광물', '유틸리티', '제약', '바이오', '의류', '식품'],
  'metals & mining':        ['반도체', 'AI', '클라우드', '소프트웨어', '제약', '바이오', '의류'],
  'metals/mining':          ['반도체', 'AI', '클라우드', '소프트웨어', '제약', '바이오'],
  industrials:              ['반도체', 'AI', '클라우드', '제약', '바이오'],
  energy:                   ['반도체', 'AI', '소프트웨어', '제약', '바이오', '의류'],
  financials:               ['반도체', 'AI', '제약', '바이오', '의류'],
  'consumer discretionary': ['반도체', '석유'],
  'consumer-discretionary': ['반도체', '석유'],
  automotive:               ['반도체', 'AI', '클라우드', '제약', '바이오'],
  communication:            ['건설', '석유', '광물'],
  utilities:                ['반도체', 'AI', '소프트웨어'],
};

// 2026-06-01: blacklist(SECTOR_FORBID) 는 나열한 단어만 막아 무한히 샘(현대차 "바이오" 사건).
//   positive 방식 — sector 별 *허용* 산업어휘. 산업어가 "수요/시장/성장" 맥락으로 등장하는데
//   해당 sector 허용 어휘에 없으면 cross-sector thesis 환각으로 판정. 나열 안 한 산업어도 자동 차단.
export const INDUSTRY_TERMS = [
  '자동차','차량','모빌리티','전기차','수소차','완성차',
  '반도체','메모리','파운드리','d램','낸드','hbm',
  '바이오','제약','신약','헬스케어','의료','진단','백신',
  '건설','부동산','리츠','시멘트',
  '석유','정유','원유','가스','에너지',
  '철강','화학','소재','광물','금속','비철',
  '조선','항공','방산','국방','기계',
  '금융','은행','보험','증권','카드',
  '배터리','2차전지','이차전지',
  '식품','음료','담배',
  '의류','패션','화장품','뷰티',
  '유통','이커머스','면세',
  '게임','엔터','미디어','콘텐츠','방송',
  '통신','커뮤니케이션','전력',
  '가전','디스플레이','전자','인터넷','검색','광고','플랫폼','핀테크','보안',
  '물류','해운','태양광','풍력','수소','원전','로봇','우주','제지','섬유','농업','축산',
];
export const SECTOR_VOCAB = {
  'automotive': ['자동차','차량','모빌리티','전기차','수소차','완성차','배터리','2차전지','이차전지'],
  'transportation equipment': ['자동차','차량','모빌리티','전기차','완성차','조선','항공','기계'],
  'transportation': ['항공','조선','자동차','차량'],
  'semiconductors': ['반도체','메모리','파운드리','d램','낸드','hbm'],
  'semiconductor': ['반도체','메모리','파운드리','d램','낸드','hbm'],
  'technology': ['반도체','it','소프트웨어','클라우드','전자','통신','가전','디스플레이'],
  'it services': ['it','소프트웨어','클라우드','플랫폼','게임','엔터','미디어','콘텐츠','통신','인터넷','검색','광고','핀테크','보안'],
  'it-software': ['it','소프트웨어','클라우드','플랫폼','게임','엔터','미디어','콘텐츠','인터넷','검색','광고','핀테크','보안'],
  'ai-cloud': ['클라우드','반도체','소프트웨어','데이터','인터넷','플랫폼'],
  'communication-services': ['통신','커뮤니케이션','미디어','엔터','콘텐츠','게임','방송','플랫폼'],
  'communication': ['통신','커뮤니케이션','미디어','엔터','콘텐츠','게임','방송'],
  'telecom': ['통신','커뮤니케이션','미디어','방송'],
  'pharma-biotech': ['바이오','제약','신약','헬스케어','의료','진단','백신'],
  'healthcare': ['바이오','제약','신약','헬스케어','의료','진단','백신'],
  'financials': ['금융','은행','보험','증권','카드'],
  'banking': ['금융','은행','카드'],
  'insurance': ['금융','보험'],
  'energy': ['석유','정유','원유','가스','에너지','전력','태양광','풍력','수소','원전','재생에너지'],
  'utilities': ['전력','가스','에너지','원전','태양광','풍력'],
  'materials': ['철강','화학','소재','광물','금속','비철','시멘트','제지','섬유'],
  'chemicals': ['화학','소재','배터리','2차전지','이차전지'],
  'metals & mining': ['철강','광물','금속','비철','소재'],
  'metals/mining': ['철강','광물','금속','비철','소재'],
  'industrials': ['기계','조선','항공','방산','국방','건설','로봇','우주','물류','해운'],
  'defense': ['방산','국방','항공','기계'],
  'consumer-discretionary': ['자동차','차량','의류','패션','화장품','뷰티','유통','이커머스','게임','엔터','면세'],
  'consumer discretionary': ['자동차','차량','의류','패션','화장품','뷰티','유통','게임','엔터'],
  'consumer-defensive': ['식품','음료','담배','유통'],
  'consumer staples': ['식품','음료','담배','유통'],
  'wholesale': ['유통','이커머스','식품'],
  'ev-battery': ['배터리','2차전지','이차전지','전기차','소재'],
  'battery': ['배터리','2차전지','이차전지','소재'],
  'real-estate': ['부동산','리츠','건설'],
};
const DEMAND_CTX = /(수요|시장|성장|업황|호황|특수|확대|반등|회복|모멘텀|테마|수혜)/;
// 2026-06-14: KR sector 보강(enrich-sectors)으로 Yahoo-raw 라벨(Consumer Cyclical/Basic Materials/
//   Communication Services/Real Estate/Financial Services/Consumer Defensive)이 meta 에 들어옴.
//   SECTOR_VOCAB 키(하이픈/축약형)와 달라 grounding 프로브가 silent skip → 별칭 정규화로 흡수.
const SECTOR_ALIAS = {
  'consumer cyclical': 'consumer-discretionary', 'consumer discretionary': 'consumer-discretionary',
  'consumer defensive': 'consumer-defensive', 'consumer staples': 'consumer-defensive',
  'basic materials': 'materials', 'financial services': 'financials',
  'communication services': 'communication-services', 'real estate': 'real-estate',
  'industrials': 'industrials', 'semiconductors': 'semiconductors', 'technology': 'technology',
};
/** text 의 산업어 중 sector 허용 어휘에 없고 demand 맥락인 첫 항목 반환 (cross-sector thesis 환각). 없으면 null. */
export function mismatchedIndustryTerm(text, sectorLower) {
  if (typeof text !== 'string' || !text) return null;
  const key = SECTOR_ALIAS[sectorLower] ?? sectorLower;
  const allowed = SECTOR_VOCAB[key];
  if (!allowed) return null; // 미등록 sector → 판단 보류 (false positive 방지)
  for (const term of INDUSTRY_TERMS) {
    const t = term.toLowerCase();
    if (!text.toLowerCase().includes(t)) continue;
    if (allowed.includes(t)) continue; // sector 허용 어휘
    const idx = text.toLowerCase().indexOf(t);
    const around = text.slice(Math.max(0, idx - 4), idx + term.length + 8);
    if (DEMAND_CTX.test(around)) return term;
  }
  return null;
}

export async function verifyReport(file, { silent = false } = {}) {
  const log = silent ? () => {} : console.log;
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const defects = [];

  log(`\n═══ ${file} ═══`);
  log('## meta');
  log(' source:', r.source, '| session:', r.session, '| locale:', r.locale);
  log(' schemaVersion:', r.schemaVersion);

  log('\n## portfolio[0] 필드 검사');
  const required = ['ticker','name','sector','allocation','rationale','entryZone','target','stopLoss','action','confidence'];
  const p0 = r.portfolio?.[0] || {};
  log(' fields:', Object.keys(p0).join(', '));
  for (const f of required) {
    const v = p0[f];
    const status = v === undefined ? '❌ undefined' : v === null ? '⚠️ null' : v === '' ? '⚠️ empty' : '✅ ' + String(v).slice(0,50);
    log('  ', f.padEnd(12), status);
  }

  log('\n## portfolio 필드 누락 통계');
  const missing = { rationale:0, entryZone:0, target:0, stopLoss:0, allocation:0, action:0, confidence:0 };
  const total = (r.portfolio||[]).length;
  for (const p of (r.portfolio||[])) {
    for (const k of Object.keys(missing)) {
      if (p[k] == null || p[k] === '' || p[k] === undefined) missing[k]++;
    }
  }
  for (const [k,v] of Object.entries(missing)) {
    const status = v === 0 ? '✅' : v < total/2 ? '⚠️ ' : '❌';
    log('  ', status, k.padEnd(12), v+'/'+total);
  }

  log('\n## sellRecommendations');
  const allSells = [...(r.sellRecommendations?.us||[]), ...(r.sellRecommendations?.kr||[])];
  const s0 = allSells[0] || {};
  log(' fields:', Object.keys(s0).join(', '));
  const ruleDist = new Map();
  for (const s of allSells) ruleDist.set(s.ruleId, (ruleDist.get(s.ruleId)||0)+1);
  log(' rule 분포:', [...ruleDist.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+'='+v).join(', '));

  log('\n## buyCandidateScoring');
  const bc = r.buyCandidateScoring;
  log(' method:', bc?.method, '| top:', bc?.top30?.length);

  log('\n## sections');
  log(' macroAnalysis:', (r.macroAnalysis||'').length, 'c');
  log(' sectorAllocation:', (r.sectorAllocation||[]).length);

  // 2026-06-18: 티커 유효성 (N/A·null·malformed) — 내부자 섹션에 ticker:'N/A' 가 렌더된 사건.
  //   기존 verify 는 portfolio sector/name 만 봐서 insiderSignals 의 'N/A' 티커를 못 잡던 사각지대.
  log('\n## 티커 유효성 (N/A/malformed detect)');
  const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/i;
  let invalidTk = 0;
  for (const [field, arr] of [['portfolio', r.portfolio], ['insiderSignals', r.insiderSignals], ['shortSqueeze', r.shortSqueeze]]) {
    for (const it of (arr || [])) {
      const t = it?.ticker;
      if (t != null && !TICKER_RE.test(String(t))) {
        invalidTk++;
        log(`  ❌ ${field} 무효 티커 "${t}"`);
        defects.push({ ticker: String(t), defect_type: 'invalid_ticker', llm_value: `${field}.ticker="${t}"`, correct_value: 'valid ticker or omit entry', severity: 'medium' });
      }
    }
  }
  if (!invalidTk) log('  ✅ 무효 티커 없음');

  // 2026-06-18: 콘텐츠 의미 검증 — 숫자/티커/렌더링 검사가 못 잡는 "프로세스 의미" 결함 계열 구조화 포착.
  //   (N/A 내러티브 누출, 과거 이벤트를 미래 risk 로 표기 등 — verify 가 portfolio 값만 보던 사각지대.)
  log('\n## 콘텐츠 의미 검증 (placeholder 누출 / stale 이벤트)');
  // (a) placeholder/junk 누출 — 전 서술 필드 스캔 (N/A·undefined·null·NaN·U+FFFD·[object Object] 등)
  const JUNK = /\bN\/A\b|\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]|�|\{\{|\bTODO\b|\bFIXME\b/;
  const textFields = [
    ['thesis', r.thesis], ['macroAnalysis', r.macroAnalysis], ['technicalAnalysis', r.technicalAnalysis],
    ['fundamentalAnalysis', r.fundamentalAnalysis], ['topOpportunity', r.topOpportunity],
    ['hedgingSuggestion', r.hedgingSuggestion], ['portfolioRiskNote', r.portfolioRiskNote],
  ];
  for (const p of (r.portfolio || [])) textFields.push([`portfolio[${p.ticker}]`, p.entryRationale || p.rationale]);
  for (const i of (r.insiderSignals || [])) textFields.push([`insider[${i.ticker}]`, i.significance]);
  for (const e of (r.riskEvents || [])) textFields.push(['riskEvent', `${e.event} ${e.watchFor || ''}`]);
  let junkN = 0;
  for (const [field, text] of textFields) {
    if (text && JUNK.test(String(text))) {
      const m = String(text).match(JUNK)[0];
      junkN++;
      log(`  ❌ ${field} placeholder 누출 "${m}": "${String(text).slice(0, 60)}"`);
      defects.push({ ticker: field.slice(0, 20), defect_type: 'placeholder_leak', llm_value: `${field}: "${m}"`, correct_value: 'no placeholder/junk in prose', severity: 'medium' });
    }
  }
  if (!junkN) log('  ✅ placeholder 누출 없음');
  // (a2) 2026-06-18: 전 필드 재귀 U+FFFD(�) 스캔 — sellRecommendations 등 (a)가 안 보는 필드의 byte-fallback 깨짐 포착.
  let fffdN = 0;
  const scanFffd = (o, path) => {
    if (typeof o === 'string') { if (o.includes('�')) { fffdN++; if (fffdN <= 3) log(`  ❌ ${path} U+FFFD: "${o.slice(0, 40)}"`); defects.push({ ticker: path.slice(0, 24), defect_type: 'placeholder_leak', llm_value: `${path}: U+FFFD(byte-fallback)`, correct_value: 'no � in any field', severity: 'medium' }); } return; }
    if (Array.isArray(o)) return o.forEach((v, i) => scanFffd(v, `${path}[${i}]`));
    if (o && typeof o === 'object') for (const k of Object.keys(o)) scanFffd(o[k], `${path}.${k}`);
  };
  scanFffd(r, 'report');
  if (!fffdN) log('  ✅ 전필드 U+FFFD 없음');
  // (b) stale 이벤트 — riskEvents 에 보고서 날짜보다 *과거*인 이벤트(이미 발생을 미래 risk 로 표기)
  const repDate = r.generatedAt ? new Date(new Date(r.generatedAt).getTime() + 9 * 3600000).toISOString().slice(0, 10) : null;
  let staleN = 0;
  if (repDate) for (const e of (r.riskEvents || [])) {
    if (e.date && e.date < repDate) {
      staleN++;
      log(`  ❌ stale 이벤트 "${e.event}" date=${e.date} < 보고서 ${repDate}`);
      defects.push({ ticker: 'EVENT', defect_type: 'stale_event', llm_value: `${e.event} @${e.date}`, correct_value: `보고서일(${repDate}) 이후만 미래 이벤트 — 과거는 결과로 서술`, severity: 'medium' });
    }
  }
  if (!staleN) log('  ✅ stale 이벤트 없음');
  // (b2) 포트폴리오 구성 — 2026-07-03 afternoon '삼성화재 1종목 100%' 가 전 게이트 통과한 사각지대.
  //   veto 대량 탈락 자체는 규율이나, thin/몰빵 출력은 검출·적재(발간 차단은 안 함 — 진짜 공석 장세 존재).
  const nPort = (r.portfolio ?? []).length;
  const cashDisclosed = /현금\s*보유|현금도\s*포지션/.test(String(r.portfolioRiskNote ?? ''));
  if (nPort > 0 && nPort < 3 && !cashDisclosed) {
    // thin 자체는 극단장세의 정당한 규율 결과일 수 있음 — 결함은 "현금 보유 미명시"(출력 표현).
    log(`  ❌ 포트폴리오 thin ${nPort}종목 + 현금 보유 미명시 (몰빵/공석 표현 결함)`);
    defects.push({ ticker: 'PORTFOLIO', defect_type: 'portfolio_thin', llm_value: `${nPort}종목, 현금노트 없음`, correct_value: '3종목 미만이면 portfolioRiskNote 에 현금 보유 명시(applyLocalHarness 캡)', severity: 'medium' });
  } else if (nPort > 0 && nPort < 3) {
    log(`  ✅ 포트폴리오 thin ${nPort}종목 — 현금 보유 명시됨(규율상 공석 처리 정상)`);
  }
  const overAlloc = (r.portfolio ?? []).filter(p => (p.allocation ?? 0) > 40);
  for (const p of overAlloc) {
    log(`  ❌ allocation 몰빵: ${p.ticker} ${p.allocation}% (프롬프트 정책 단일 ≤25%)`);
    defects.push({ ticker: p.ticker, defect_type: 'allocation_concentration', llm_value: `${p.allocation}%`, correct_value: '단일 종목 ≤25%(정책) — 정규화 몰빵 방지 캡 확인', severity: 'high' });
  }
  if (nPort >= 3 && !overAlloc.length) log('  ✅ 포트폴리오 구성 정상 (thin/몰빵 없음)');
  // (b3) 2026-07-04 (ChatGPT 리뷰 차용): flow claim 정합 — 보고서 내장 flowNarrativeEvidence(결정론 근거) 기준.
  //   proxy-only 인데 유입성 동사 사용 = high(수익률→자금유입 의미 환각) / 근거 전무한데 유입액 주장 = medium.
  {
    const fe = r.flowNarrativeEvidence;
    const narrText = [r.thesis, r.macroAnalysis, r.marketNarrative?.why, r.marketNarrative?.story].filter(Boolean).join(' ');
    const hasTrue = !!fe?.allClaims?.some?.((c) => c.kind === 'true_flow');
    const flowWordRe = /(자금|돈)이?\s*(순)?\s*유입|유입액|순유입/;
    if (fe && !hasTrue && fe.primaryClaim?.kind === 'return_proxy' && flowWordRe.test(narrText)) {
      log('  ❌ return_proxy 를 자금유입으로 표현 (flow contract 위반)');
      defects.push({ ticker: 'NARRATIVE', defect_type: 'return_proxy_as_flow', llm_value: (narrText.match(flowWordRe) ?? [''])[0], correct_value: '가격수익률 proxy 는 수익률 우위/상대강도로만 표현', severity: 'high' });
    } else if (fe && !fe.allClaims?.length && flowWordRe.test(narrText)) {
      log('  ❌ 근거 없는 자금유입 주장 (flow evidence 전무)');
      defects.push({ ticker: 'NARRATIVE', defect_type: 'unsupported_flow_claim', llm_value: (narrText.match(flowWordRe) ?? [''])[0], correct_value: 'flowNarrativeEvidence 에 claim 이 있을 때만 유입/유출 서술', severity: 'medium' });
    } else if (fe) {
      log('  ✅ flow claim 정합 (contract 준수)');
    }
  }
  // (c) CPI 라벨 — 우리 CPI 값은 헤드라인(CPIAUCSL)이라 "핵심/근원/core CPI" 표기는 사실오류 (core 는 별도 더 낮은 수치).
  let cpiMis = 0;
  const CPI_MIS = /(핵심|근원)\s*(?:인플레이션\s*\()?\s*CPI|(핵심|근원)\s*소비자물가|\bcore\s+CPI/i;
  for (const [field, text] of [['thesis', r.thesis], ['macroAnalysis', r.macroAnalysis], ['technicalAnalysis', r.technicalAnalysis], ['fundamentalAnalysis', r.fundamentalAnalysis]]) {
    if (text && CPI_MIS.test(String(text))) {
      cpiMis++;
      log(`  ❌ ${field} CPI 라벨 오류 "${String(text).match(CPI_MIS)[0]}" (헤드라인을 core 로 오기)`);
      defects.push({ ticker: field, defect_type: 'cpi_mislabel', llm_value: String(text).match(CPI_MIS)[0], correct_value: '헤드라인 CPI (core 아님)', severity: 'medium' });
    }
  }
  if (!cpiMis) log('  ✅ CPI 라벨 정상');
  // (c2) 변동폭 과장 — "1.1% 급락/급등" 처럼 작은(<3%) 변동을 급락/급등/폭락/폭등으로 표기하면 사실오류.
  //   2026-06-18 사건: "원달러 환율 1535(1.1% 급락)" 라이브 노출(1.1%는 소폭). 사용자 "이거 급락 맞어?".
  let magMis = 0;
  const MAG = /([\d.]+)\s*%\s*(급락|급등|폭락|폭등)/g;
  const full = JSON.stringify(r);
  for (const m of full.matchAll(MAG)) {
    if (Math.abs(Number(m[1])) < 3) {
      magMis++;
      log(`  ❌ 변동폭 과장 "${m[0]}" (${m[1]}%는 급락/급등 아님 — 3%↑만)`);
      defects.push({ ticker: 'MACRO', defect_type: 'magnitude_overstate', llm_value: m[0], correct_value: `${m[1]}%는 소폭/하락-상승 (급락·급등은 3%↑)`, severity: 'medium' });
    }
  }
  if (!magMis) log('  ✅ 변동폭 표현 정상(급락/급등 과장 없음)');
  // (d) FOMC 시제 — 이미 끝난(보고서 월 이하) FOMC 를 "기대/전망/예상"(미래형)으로 서술하면 결함.
  //   2026-06-18 사건: 6월 FOMC 완료(데이터도 next=7/29 인지)인데 "6월 FOMC 동결 기대(100%)" 라이브 노출.
  let fomcTense = 0;
  const repMonth = repDate ? Number(repDate.slice(5, 7)) : 0;
  const FOMC_TENSE = /([0-9]{1,2})월\s*FOMC[^.]{0,30}?(?:동결|인상|인하)(?:을|를)?\s*(기대|전망|예상|예정)/g;
  // 연준/금리 맥락(월 미지정 포함)의 동결/인상/인하 + 기대/전망 — "연준의 금리 동결 기대" 류 잔존 탐지.
  const FED_TENSE = /(?:연준|Fed|기준금리|금리)[^.]{0,20}?(?:동결|인상|인하)(?:을|를)?\s*(기대|전망|예상|예정)/g;
  for (const [field, text] of [['thesis', r.thesis], ['macroAnalysis', r.macroAnalysis]]) {
    if (!text) continue;
    let mm; const re = new RegExp(FOMC_TENSE);
    while ((mm = re.exec(String(text)))) {
      if (repMonth && Number(mm[1]) <= repMonth) {
        fomcTense++;
        log(`  ❌ ${field} FOMC 시제 오류 "${mm[0].slice(0, 30)}" (${mm[1]}월 FOMC 는 발생함 — 결과로 서술)`);
        defects.push({ ticker: field, defect_type: 'fomc_stale_tense', llm_value: mm[0].slice(0, 40), correct_value: '발생한 FOMC 는 동결/인상/인하 *결과*로 서술 (기대/전망 금지)', severity: 'medium' });
      }
    }
    let fm; const fre = new RegExp(FED_TENSE);
    while ((fm = fre.exec(String(text)))) {
      fomcTense++;
      log(`  ❌ ${field} 연준 시제 오류 "${fm[0].slice(0, 30)}" (직전 FOMC 완료 — 결과로 서술)`);
      defects.push({ ticker: field, defect_type: 'fomc_stale_tense', llm_value: fm[0].slice(0, 40), correct_value: '연준 금리정책은 발생한 결과로 서술 (동결 기대/전망 금지)', severity: 'medium' });
    }
  }
  if (!fomcTense) log('  ✅ FOMC 시제 정상');

  // 1. sector ↔ meta consistency (LLM 환각 vs candidate-tickers meta)
  log('\n## sector ↔ meta 일치 (LLM 환각 detect)');
  let secFix = 0;
  // 2026-06-17 전수조사 detector-tuning: 권위 소스(candidate-tickers.json meta) 부재 시 silent
  //   "✅ consistent" 대신 "검증 불가" 결함 push — 빈 lookup 으로 sector 환각이 통과하던 사각지대 차단.
  if (!CANDIDATE_META_LOADED) {
    log('  ❌ candidate-tickers.json meta 부재/손상 — sector 검증 불가 (build:universe 필요)');
    defects.push({
      ticker: 'VERIFY', defect_type: 'authority_source_missing',
      llm_value: 'candidate-tickers.json meta empty/missing',
      correct_value: 'sector 환각 검증 불가 — data/candidate-tickers.json 재생성', severity: 'medium',
    });
  }
  for (const p of (r.portfolio||[])) {
    const meta = CANDIDATE_META[p.ticker];
    if (!meta?.sector || meta.sector === 'Unknown') continue;
    if (p.sector && p.sector !== meta.sector) {
      log(`  ❌ ${p.ticker} sector="${p.sector}" → 정답 "${meta.sector}"`);
      defects.push({
        ticker: p.ticker, defect_type: 'sector_mismatch',
        llm_value: p.sector, correct_value: meta.sector, severity: 'high',
      });
      secFix++;
    }
  }
  if (secFix === 0) log('  ✅ sector meta consistent');

  // 1b. ticker ↔ 회사명 일치 (CPRT="Cypress Semiconductor" 류 name 환각 detect, 2026-06-03)
  log('\n## ticker ↔ 회사명 일치 (name 환각 detect)');
  let nameFix = 0, nameChecked = 0;
  // 2026-06-17 전수조사 detector-tuning: company-names.json 부재 시 "✅ 0건 검증" green pass 가
  //   CPRT='Cypress Semiconductor' 류를 통과시키던 사각지대 — 권위 소스 부재를 명시적 결함으로.
  if (!COMPANY_NAMES_LOADED) {
    log('  ❌ company-names.json 부재/손상 — ticker↔회사명 검증 불가 (build:names 필요)');
    defects.push({
      ticker: 'VERIFY', defect_type: 'authority_source_missing',
      llm_value: 'company-names.json empty/missing',
      correct_value: 'name 환각 검증 불가 — npm run build:names 로 data/company-names.json 재생성', severity: 'medium',
    });
  }
  const nameTargets = [
    ...(r.portfolio || []).map(p => ['portfolio', p]),
    ...(Array.isArray(r.companyChanges) ? r.companyChanges.map(c => ['companyChanges', c]) : []),
  ];
  for (const [src, item] of nameTargets) {
    const authoritative = COMPANY_NAMES[(item.ticker || '').toUpperCase()];
    if (!authoritative || !item.name) continue;
    nameChecked++;
    if (!nameMatches(item.name, authoritative)) {
      log(`  ❌ ${item.ticker} name="${item.name}" → 정답 "${authoritative}" (${src})`);
      defects.push({
        ticker: item.ticker, defect_type: 'name_mismatch',
        llm_value: item.name, correct_value: authoritative, severity: 'high',
      });
      nameFix++;
    }
  }
  if (nameFix === 0) log(`  ✅ 회사명 일치 (${nameChecked}건 검증, 권위 소스 ${Object.keys(COMPANY_NAMES).length})`);

  // 2. sector-keyword mismatch — blacklist(SECTOR_FORBID) + positive 어휘(mismatchedIndustryTerm).
  //    2026-06-01: blacklist 만으론 나열 안 한 산업어(바이오 등)가 새어 → positive 방식 병행.
  log('\n## sector-keyword mismatch (forbidden + cross-sector thesis)');
  let mmCount = 0;
  for (const p of (r.portfolio||[])) {
    const sec = (p.sector||'').toLowerCase();
    const text = [p.rationale, p.entryRationale, p.targetRationale, p.fundamentalBasis, p.riskNote, ...(p.catalysts||[])].filter(Boolean).join(' | ');
    const forbid = SECTOR_FORBID[sec];
    let hit = forbid?.find(kw => text.includes(kw)) ?? null;
    if (!hit) hit = mismatchedIndustryTerm(text, sec);  // positive 어휘 — 나열 안 한 산업어도 catch
    if (hit) {
      log(`  ❌ ${p.ticker} (${p.sector}) — 무관 산업어 "${hit}": "${text.slice(0, 80)}..."`);
      defects.push({
        ticker: p.ticker, defect_type: 'sector_keyword_mismatch',
        llm_value: `"${hit}" in rationale`, correct_value: p.sector, severity: 'high',
        details: { sample: text.slice(0, 200) },
      });
      mmCount++;
    }
  }
  if (mmCount === 0) log('  ✅ sector-keyword mismatch 0');

  // 3. 52주 범위 환각 — 권위적 검사 (2026-06-04 ratio>3x 휴리스틱 폐기).
  //   근거: Samsung 005930.KS 가 1년간 57k→360k (6.3x), SK Hynix/Intel 등 AI 슈퍼사이클로 실제
  //   3x+ 상승 → ratio>3x 는 genuine high-flyer 를 false positive 로 잡아 Karpathy 루프를 오염시켰음
  //   (CLAUDE.md "검증은 권위 소스 대조, 휴리스틱 금지" 위반). 대신 "진짜 52주 범위는 항상 현재가를
  //   bracket 한다"는 불변식 + 물리적으로 불가능한 ratio(>20x = 데이터 글리치/환각)만 flag.
  log('\n## 52주 범위 환각 (현재가 bracket 불변식 + >20x absurd)');
  let weekBad = 0;
  for (const p of (r.portfolio||[])) {
    // 2026-06-17 전수조사 detector-tuning: 통화기호 없는 US 종목("52주: 410-250")도 검사.
    //   `[₩$]?` 는 이미 옵션이지만 "52주" 와 숫자 사이에 "범위"/"레인지" 등 단어가 끼면 놓쳐
    //   `\s*:?\s*[^\d₩$]{0,6}` 로 라벨↔숫자 근접 허용 (무관 숫자 매칭은 52주 키워드 anchor 로 차단).
    const m = (p.rationale||'').match(/52주\s*:?\s*[^\d₩$]{0,6}[₩$]?([\d,.]+)\s*[-~]\s*[₩$]?([\d,.]+)/);
    if (!m) continue;
    const lo = parseFloat(m[1].replace(/,/g, ''));
    const hi = parseFloat(m[2].replace(/,/g, ''));
    if (!isFinite(lo) || !isFinite(hi) || lo <= 0) continue;
    const ratio = hi / lo;
    // 현재가 추출 — "현재 $X" / entryZone 중간값 폴백. 실제 52주 범위는 현재가를 포함해야 함.
    const pm = (p.rationale||'').match(/현재\s*[~약]?\s*[₩$]?([\d,.]+)/);
    let price = pm ? parseFloat(pm[1].replace(/,/g, '')) : null;
    if (price == null && p.entryZone) {
      const em = String(p.entryZone).match(/([\d,.]+)/g);
      if (em?.length) price = em.map(x => parseFloat(x.replace(/,/g, ''))).reduce((a, b) => a + b, 0) / em.length;
    }
    let reason = null;
    if (lo >= hi) reason = '범위 역전(lo≥hi)';
    else if (ratio > 20) reason = `${ratio.toFixed(1)}x (물리적 불가 — 데이터 글리치)`;
    else if (price != null && (price < lo * 0.9 || price > hi * 1.1)) reason = `현재가 ${price} 가 52주 범위 [${lo}, ${hi}] 밖`;
    if (reason) {
      log(`  ❌ ${p.ticker} 52주 ${lo}-${hi} — ${reason}`);
      defects.push({
        ticker: p.ticker, defect_type: '52w_halluc',
        llm_value: `52주 ${lo}-${hi}${price != null ? ` (현재 ${price})` : ''}`,
        correct_value: reason, severity: 'medium',
      });
      weekBad++;
    }
  }
  if (weekBad === 0) log('  ✅ 52주 범위 정상 (high-flyer 의 genuine 3x+ 는 통과)');

  // 4. 50MA-200MA — 권위적 검사 (2026-06-04 gap>50% 휴리스틱 폐기).
  //   근거: 005930.KS(50MA=231k/200MA=144k, gap 60%)·000660.KS(gap 76%)는 AI 슈퍼사이클 genuine
  //   우상향에서 50MA가 200MA 위 60-76% — 정상인데 false positive 였음. 반면 NVDA(50MA=200/200MA=50,
  //   gap 300%)·005490.KS(50MA=200/200MA=340270)는 MA 값이 물리적으로 불가능한 진짜 글리치.
  //   → 불가능한 MA 발산(>2.5x)이나 현재가 대비 극단 이탈(>3x)만 flag. genuine 우상향 gap 은 통과.
  log('\n## 50MA-200MA (불가능 발산 >2.5x + 현재가 3x 이탈)');
  let maBad = 0;
  // 2026-06-17 전수조사 detector-tuning: 통화기호 없는 US MA("50MA 410 / 200MA 250")가
  //   종전 `[₩$]` 필수 정규식을 silent 통과하던 사각지대. 통화기호版 OR 무통화版 둘 다 매칭하되,
  //   무통화版은 (a) MA 라벨 바로 뒤 근접(≤4자), (b) 음수/퍼센트 제외(2026-06-06 "-4.9%" 오인 방지),
  //   (c) 3자리+ 가격성 숫자만 허용해 무관 작은 숫자 차단.
  const matchMA = (rawTxt, label) => {
    // 2026-06-18 (사용자 "왜 이런 사각지대가 아직도"): 천단위 콤마 뒤 공백("886, 308")이 끼면
    //   파서가 공백에서 끊겨 "886" 으로 오독 → divergence/이탈 전부 오탐. 콤마+공백+숫자만 정규화
    //   (", 308"→",308"); 절 구분자 ", RSI"(뒤 비숫자)는 보존. defense-in-depth(소스 fix 와 별개).
    const txt = String(rawTxt).replace(/,\s+(?=\d)/g, ',');
    const cur = txt.match(new RegExp(`${label}[^₩$]{0,10}[₩$]([\\d,.]+)`));
    if (cur) return cur;
    // 무통화: 라벨 직후 근접, 앞에 '-' 없고 뒤에 '%' 없는 3자리+ 숫자(콤마 포함). "위/돌파/=" 등 라벨어 허용.
    return txt.match(new RegExp(`${label}\\s*(?:선|값|위|아래|돌파|=|:)?\\s*([\\d][\\d,]{2,}(?:\\.\\d+)?)(?!\\s*%)`));
  };
  for (const p of (r.portfolio||[])) {
    const m50 = matchMA(p.rationale || '', '50MA');
    const m200 = matchMA(p.rationale || '', '200MA');
    if (!m50 || !m200) continue;
    const v50 = parseFloat(m50[1].replace(/,/g, ''));
    const v200 = parseFloat(m200[1].replace(/,/g, ''));
    if (!isFinite(v50) || !isFinite(v200) || v200 <= 0 || v50 <= 0) continue;
    const divergence = Math.max(v50 / v200, v200 / v50);
    const pm = (p.rationale||'').match(/현재\s*[~약]?\s*[₩$]?([\d,.]+)/);
    let price = pm ? parseFloat(pm[1].replace(/,/g, '')) : null;
    if (price == null && p.entryZone) {
      const em = String(p.entryZone).match(/([\d,.]+)/g);
      if (em?.length) price = em.map(x => parseFloat(x.replace(/,/g, ''))).reduce((a, b) => a + b, 0) / em.length;
    }
    // 2026-06-18 (사용자 "왜 이런 사각지대가 아직도"): 52주 레인지 파싱 — 포물선 급등주(009150 삼성전기
    //   52주 ₩130,300→현재 ₩200만, 15배)는 200MA 가 현재가의 1/4 인 게 *정상*. "현재가 3x 이탈" 휴리스틱이
    //   이를 환각으로 오탐 → Karpathy 학습루프에 가짜 결함 적재. MA 는 물리적으로 52주 레인지 안에 있어야
    //   하므로, 레인지 파악 가능하면 "MA ∉ [52wLow, 52wHigh]" 만 진짜 글리치로 판정(범위 마진 ±15%).
    const w52 = (p.rationale || '').match(/52주\s*[:：]?\s*[₩$]?([\d,.]+)\s*[-~]\s*[₩$]?([\d,.]+)/);
    let lo52 = null, hi52 = null;
    if (w52) { lo52 = parseFloat(w52[1].replace(/,/g, '')); hi52 = parseFloat(w52[2].replace(/,/g, '')); if (lo52 > hi52) [lo52, hi52] = [hi52, lo52]; }
    const rangeKnown = isFinite(lo52) && isFinite(hi52) && lo52 > 0 && hi52 > 0;
    // 진짜 멀티배거(레인지 4x+)면 발산 임계 완화 — 50MA 가 200MA 의 2.5x 넘는 것도 정상일 수 있음.
    const divThreshold = rangeKnown && hi52 / lo52 >= 4 ? 4.0 : 2.5;
    let reason = null;
    if (divergence > divThreshold) reason = `50MA↔200MA ${divergence.toFixed(1)}x 발산 (물리적 불가)`;
    else if (rangeKnown && (v50 < lo52 * 0.85 || v50 > hi52 * 1.15 || v200 < lo52 * 0.85 || v200 > hi52 * 1.15))
      reason = `MA가 52주 레인지[${lo52}-${hi52}] 밖 (50MA=${v50}, 200MA=${v200}) — 물리적 불가`;
    else if (!rangeKnown && price != null && (v50 < price / 3 || v50 > price * 3 || v200 < price / 3 || v200 > price * 3))
      reason = `MA가 현재가 ${price} 대비 3x 이탈 (50MA=${v50}, 200MA=${v200})`;
    if (reason) {
      log(`  ❌ ${p.ticker} 50MA=${v50} vs 200MA=${v200} — ${reason}`);
      defects.push({
        ticker: p.ticker, defect_type: 'ma_halluc',
        llm_value: `50MA=${v50} 200MA=${v200}${price != null ? ` (현재 ${price})` : ''}`,
        correct_value: reason, severity: 'medium',
      });
      maBad++;
    }
  }
  if (maBad === 0) log('  ✅ MA 정상 (genuine 우상향 gap 통과)');

  // 5. technicalBasis / riskNote 누락 detect (F23 fact-check 미완)
  log('\n## technicalBasis / riskNote 누락 (F23 미완)');
  let tbBad = 0;
  for (const p of (r.portfolio||[])) {
    if (p.action === 'buy' && (!p.technicalBasis || p.technicalBasis === 'undefined' || !p.riskNote || p.riskNote === 'undefined')) {
      log(`  ⚠️ ${p.ticker} technicalBasis=${!!p.technicalBasis} riskNote=${!!p.riskNote}`);
      defects.push({
        ticker: p.ticker, defect_type: 'fact_check_incomplete',
        llm_value: `technicalBasis=${!!p.technicalBasis} riskNote=${!!p.riskNote}`,
        correct_value: 'F23 fact-check 필수 채움', severity: 'low',
      });
      tbBad++;
    }
  }
  if (tbBad === 0) log('  ✅ 모든 buy 종목 technicalBasis + riskNote 채워짐');

  // 6. PE 환각 detect (2026-06-05) — 프롬프트가 PE 인용을 요구하나 PE 가 fetch 데이터에 없으면
  //    LLM 이 메모리/추측으로 지어냄. 검증체계가 없어 "왜 이게 검토 안 됐나"였던 사각지대.
  //    Telltale 2종: (a) 서로 다른 종목에 동일 PE 값(POSCO·프로텍 둘 다 "26.1" = copy-paste 환각),
  //    (b) KR(.KS/.KQ) 종목 PE 인용 — DART 는 EPS 미제공이라 KR PE 는 grounded 불가(인용=환각).
  log('\n## PE 환각 (중복값 / KR PE — 2026-06-05)');
  let peBad = 0;
  const peByValue = new Map();
  for (const p of (r.portfolio || [])) {
    const m = (p.fundamentalBasis || '').match(/P\/?E[=:\s]*(\d+\.?\d*)/i);
    if (!m) continue;
    const pe = m[1];
    const arr = peByValue.get(pe) ?? [];
    arr.push(p.ticker);
    peByValue.set(pe, arr);
    if (/\.(KS|KQ)$/.test(p.ticker)) {
      log(`  ⚠️ ${p.ticker} KR PE=${pe} — DART EPS 미제공, grounded 불가(환각 의심)`);
      defects.push({
        ticker: p.ticker, defect_type: 'pe_halluc',
        llm_value: `KR PE=${pe}`, correct_value: 'KR PE 인용 금지 — ROE/netMargin 사용', severity: 'medium',
      });
      peBad++;
    }
  }
  for (const [pe, tks] of peByValue) {
    const uniq = [...new Set(tks)];
    if (uniq.length >= 2) {
      log(`  ⚠️ 동일 PE=${pe} → ${uniq.length}종목(${uniq.join(', ')}) — copy-paste 환각 의심`);
      defects.push({
        ticker: uniq.join('/'), defect_type: 'pe_halluc',
        llm_value: `PE=${pe} ×${uniq.length}`, correct_value: '종목별 grounded PE(price/EPS)', severity: 'medium',
      });
      peBad++;
    }
  }
  if (peBad === 0) log('  ✅ PE 중복/KR PE 환각 없음');

  // 6b. 종목간 동일 %수치 (2026-06-06: 인사이더 12.3% 3종목·매출 28.7% 2종목 copy-paste 환각 사건).
  //   PE 외 모든 % (인사이더/매출/마진 등)가 서로 다른 2+종목에 동일하면 환각. 소수%만(정수%는 우연중복 흔함).
  log('\n## 종목간 동일 %수치 (copy-paste 환각 — 2026-06-06)');
  let dupPctBad = 0;
  // 2026-06-17 전수조사 detector-tuning: 종전 "2+종목 동일 소수%" = 즉시 환각 판정은 우연 일치
  //   (서로 다른 기업이 우연히 같은 28.7% 매출성장) false positive 가 잦았음. 진짜 copy-paste 만
  //   잡도록 조건 강화: (A) 3+ 종목이 같은 % → 우연 가능성 낮음, 또는 (B) 정확히 2종목이라도
  //   그 % 주변 텍스트(숫자 제외 정규화)가 near-identical 이면 copy-paste. 둘 다 아니면 통과.
  const pctOccur = new Map(); // value → [{ ticker, ctx }]
  // 숫자/공백 제거 후 비교용 정규화 — 같은 문구 틀에 숫자만 다른 것을 동일 취급.
  const normCtx = (s) => String(s || '').toLowerCase().replace(/[\d.,%]+/g, '#').replace(/\s+/g, '').trim();
  for (const p of (r.portfolio || [])) {
    const text = (p.fundamentalBasis || '') + ' ' + (Array.isArray(p.catalysts) ? p.catalysts.join(' ') : '');
    const seen = new Set();
    for (const m of text.matchAll(/(\d+\.\d+)%/g)) {
      const v = m[1];
      if (parseFloat(v) < 1) continue; // 0.x% 잡음 제외
      if (seen.has(v)) continue; seen.add(v); // 종목 내 중복 1회만
      const idx = m.index ?? 0;
      const ctx = normCtx(text.slice(Math.max(0, idx - 14), idx + m[0].length + 14)); // % 주변 ±14자 정규화
      const arr = pctOccur.get(v) ?? []; arr.push({ ticker: p.ticker, ctx }); pctOccur.set(v, arr);
    }
  }
  for (const [v, occ] of pctOccur) {
    const uniqTks = [...new Set(occ.map(o => o.ticker))];
    if (uniqTks.length < 2) continue;
    // (B) 정확히 2종목이면 주변 텍스트 near-identical 일 때만; 3+ 종목이면 그 자체로 의심.
    let copyPaste = uniqTks.length >= 3;
    if (!copyPaste && uniqTks.length === 2) {
      // 두 종목의 동일 % 주변 문구가 같으면 copy-paste (정규화 후 일치).
      const ctxs = [...new Set(occ.map(o => o.ctx).filter(Boolean))];
      copyPaste = ctxs.length === 1 && ctxs[0].length >= 6;
    }
    if (copyPaste) {
      const reason = uniqTks.length >= 3 ? `${uniqTks.length}종목 동일수치` : '주변 문구까지 동일(copy-paste)';
      log(`  ⚠️ 동일 ${v}% → ${uniqTks.length}종목(${uniqTks.join(', ')}) — ${reason}`);
      defects.push({
        ticker: uniqTks.join('/'), defect_type: 'dup_pct_halluc',
        llm_value: `${v}% ×${uniqTks.length} (${reason})`, correct_value: '종목별 실수치(인사이더/매출 grounded)', severity: 'medium',
      });
      dupPctBad++;
    }
  }
  if (dupPctBad === 0) log('  ✅ 종목간 동일 %수치 없음');

  // 6c. 망가진 숫자 (2026-06-06: rev-ground 정규식 greedy 분리자가 숫자 삼켜 "16.16.6%"/"21.21.8%"
  //   생성 사건). 소수점 2개+("\d+\.\d+\.\d") 는 코드/LLM 의 숫자 조립 버그 — 사용자에게 깨진 수치 노출.
  //   verify 사각지대였음(모든 % probe 가 첫 \d+\.\d+ 만 봐서 뒤 ".6" 무시). 전 텍스트필드 스캔.
  log('\n## 망가진 숫자 (소수점 2개+ — 숫자조립 버그 — 2026-06-06)');
  let malformedNum = 0;
  for (const p of (r.portfolio || [])) {
    const fields = {
      fundamentalBasis: p.fundamentalBasis, technicalBasis: p.technicalBasis,
      entryRationale: p.entryRationale, targetRationale: p.targetRationale, riskNote: p.riskNote,
      catalysts: Array.isArray(p.catalysts) ? p.catalysts.join(' | ') : p.catalysts,
    };
    for (const [fld, txt] of Object.entries(fields)) {
      const bad = String(txt || '').match(/\d+\.\d+\.\d+/g);
      if (bad) {
        log(`  ❌ ${p.ticker} ${fld}: 망가진 숫자 "${bad.join(', ')}" (소수점 2개+)`);
        defects.push({
          ticker: p.ticker, defect_type: 'malformed_number',
          llm_value: bad.join(','), correct_value: '단일 소수점 숫자', severity: 'high',
        });
        malformedNum++;
      }
    }
  }
  if (malformedNum === 0) log('  ✅ 망가진 숫자 없음');

  // 7. 기술 일관성 — RSI/지지선 환각 detect (2026-06-05, 삼전 "RSI 45+과매도"(실제 58)·
  //    "120,000 지지"(실제가 327k) 환각 사건). report 내부만으로 판정(외부 fetch 불필요):
  //    (a) "RSI N" + "과매도"(N≥35) 또는 "과매수"(N≤65) 모순, (b) entryRationale 의 지지가격이
  //    entryZone 과 >25% 이탈(지지선 환각).
  log('\n## 기술 일관성 (RSI/지지선 환각 — 2026-06-05)');
  let techBad = 0;
  const parseWon = (s) => { const m = (s || '').replace(/[,₩\s]/g, '').match(/(\d{4,})/); return m ? +m[1] : null; };
  // 2026-06-17 전수조사 detector-tuning: 종전 parseWon(entryRationale) 은 본문 첫 4+자리 숫자를
  //   무조건 "지지"로 읽어, 목표가/거래량/시총 같은 무관 큰 수를 지지선으로 오인했음. 지지/support
  //   키워드 근접(앞 14자 내 또는 숫자 직후 8자 내)에 있는 가격만 추출하도록 anchor.
  const parseSupport = (s) => {
    const str = String(s || '');
    // "지지" 키워드 ±근접 구간에서만 4+자리(콤마 포함) 가격 추출 — "120,000 지지" / "지지선 120,000".
    const m = str.match(/(?:지지[선가]?\s*[:\-~]?\s*[₩$]?([\d,]{4,})|([₩$]?[\d,]{4,})\s*(?:원)?\s*(?:지지|support)|support[^0-9]{0,8}([\d,]{4,}))/i);
    const raw = m ? (m[1] ?? m[2] ?? m[3]) : null;
    if (!raw) return null;
    const n = +raw.replace(/[,₩$\s]/g, '');
    return Number.isFinite(n) && n >= 1000 ? n : null;
  };
  for (const p of (r.portfolio || [])) {
    const txt = `${p.technicalBasis || ''} ${p.entryRationale || ''} ${p.rationale || ''}`;
    const rsiM = txt.match(/RSI\s*([0-9]{1,3})/i);
    const rsi = rsiM ? +rsiM[1] : null;
    const oversold = /과매도|oversold/i.test(txt), overbought = /과매수|overbought/i.test(txt);
    // 2026-06-17 전수조사 detector-tuning: 비표준 cutoff(과매도 rsi≥35 / 과매수 rsi≤65)가
    //   30-34·66-70 의 정당한 경계 케이스를 false positive 로 잡았음. 표준 TA(과매도<30/과매수>70)
    //   기준으로, 명백한 모순만(과매도 단언인데 rsi≥45, 과매수 단언인데 rsi≤55) flag.
    if (rsi != null && oversold && rsi >= 45) {
      log(`  ⚠️ ${p.ticker} "RSI ${rsi}" + "과매도" 모순 (표준 과매도는 RSI<30, rsi≥45 = 명백 모순)`);
      defects.push({ ticker: p.ticker, defect_type: 'rsi_halluc', llm_value: `RSI ${rsi}+과매도`, correct_value: '과매도는 RSI<30 (rsi≥45 모순)', severity: 'medium' });
      techBad++;
    } else if (rsi != null && overbought && rsi <= 55) {
      log(`  ⚠️ ${p.ticker} "RSI ${rsi}" + "과매수" 모순 (표준 과매수는 RSI>70, rsi≤55 = 명백 모순)`);
      defects.push({ ticker: p.ticker, defect_type: 'rsi_halluc', llm_value: `RSI ${rsi}+과매수`, correct_value: '과매수는 RSI>70 (rsi≤55 모순)', severity: 'medium' });
      techBad++;
    } else if (oversold && rsi == null && /지지|과매도/.test(p.entryRationale || '')) {
      // RSI 값 없이 "과매도" 단언 — 근거 없는 환각
      log(`  ⚠️ ${p.ticker} RSI 값 없이 "과매도" 단언 (근거 미상)`);
      defects.push({ ticker: p.ticker, defect_type: 'rsi_halluc', llm_value: 'RSI값없이 과매도', correct_value: 'RSI 값 명시 또는 제거', severity: 'low' });
      techBad++;
    }
    // 지지선 vs entryZone 이탈 — entryRationale 의 "지지" 가격이 entryZone 과 >25% 차이면 지지선 환각
    // 2026-06-17 전수조사 detector-tuning: supW 추출을 지지 키워드 anchor(parseSupport)로 교체 —
    //   무관 큰 수(목표가/거래량) 오인 차단. 키워드 없으면 supW=null 로 probe skip(false positive 방지).
    const ezLow = parseWon((p.entryZone || '').split(/[-~]/)[0]);
    const supW = parseSupport(p.entryRationale);
    if (ezLow && supW && Math.abs(supW / ezLow - 1) > 0.25) {
      log(`  ⚠️ ${p.ticker} 지지 "${supW}" vs entryZone(${ezLow}) ${Math.round((supW/ezLow-1)*100)}% 이탈 — 지지선 환각`);
      defects.push({ ticker: p.ticker, defect_type: 'support_halluc', llm_value: `지지 ${supW} vs entry ${ezLow}`, correct_value: 'entryZone 기준 지지', severity: 'medium' });
      techBad++;
    }
  }
  if (techBad === 0) log('  ✅ RSI/지지선 일관성 정상');

  // 8. portfolio 정합성 — allocation 합 + 개수 (2026-06-05, allocation 합 74 발견. RULES "sum=100"
  //    위반인데 검증 프로브 없던 사각지대). 합 95~105 벗어나면 결함.
  log('\n## portfolio 정합성 (allocation 합/개수 — 2026-06-05)');
  const port = r.portfolio || [];
  const allocSum = Math.round(port.reduce((s, p) => s + (Number(p.allocation) || 0), 0));
  // 2026-07-03: 현금 유보 정책과 정합 — thin 장세에서 캡(단일 ≤25%) 후 합 <100 은 portfolioRiskNote 에
  //   현금 보유가 명시돼 있으면 정상(투자비중+현금=100). 명시 없는 합 이탈만 결함.
  const cashOk = allocSum < 100 && /현금\s*보유|현금도\s*포지션/.test(String(r.portfolioRiskNote ?? ''));
  if (port.length > 0 && (allocSum < 95 || allocSum > 105) && !cashOk) {
    log(`  ⚠️ allocation 합 ${allocSum} (목표 100) — ${port.length}종목`);
    defects.push({
      ticker: 'PORTFOLIO', defect_type: 'allocation_sum',
      llm_value: `합 ${allocSum}% (${port.length}종목)`, correct_value: 'allocation 합 = 100 (또는 현금 보유 명시 시 <100 허용)', severity: 'medium',
    });
  } else if (port.length > 0) {
    log(`  ✅ allocation 합 ${allocSum} (${port.length}종목)${cashOk ? ` + 현금 ${100 - allocSum}% 명시 — 정상` : ' 정상'}`);
  }

  // 9. earlyWarning 침묵 probe (2026-06-12 신설 — 외부 실값 대조 의무).
  //    6/5~6/10 급락 때 earlyWarning 이 VIX 입력 결함(.score 오필드)으로 score 0 침묵 — 폭락 진행
  //    중에도 어떤 검증도 "경보가 죽어있다"를 못 잡았음. "최선(경보)이 미시행"인 상태 자체를 잡는 probe:
  //    보고서의 경보 점수를 Yahoo 실측 VIX·S&P500 5일 수익률과 대조. endpoint alive ≠ value accurate.
  log('\n## earlyWarning 침묵 probe (Yahoo 실측 대조)');
  try {
    const ew = r.earlyWarning;
    if (ew && typeof ew.score === 'number') {
      const yahoo = async (sym) => {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=10d&interval=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
        const j = await res.json();
        return (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter(c => c != null);
      };
      const [vixCloses, spxCloses] = await Promise.all([yahoo('^VIX'), yahoo('^GSPC')]);
      const vixNow = vixCloses.at(-1);
      const spx5d = spxCloses.length >= 6 ? ((spxCloses.at(-1) / spxCloses.at(-6)) - 1) * 100 : null;
      log(`  [accuracy probe] metric=earlyWarning source=Yahoo vix=${vixNow?.toFixed(1)} spx5d=${spx5d?.toFixed(2)}% our_score=${ew.score} our_level=${ew.level}`);
      const stress = (vixNow != null && vixNow >= 25) || (spx5d != null && spx5d <= -4);
      const mildStress = (vixNow != null && vixNow >= 20) || (spx5d != null && spx5d <= -2.5);
      if (stress && ew.score < 25) {
        defects.push({ ticker: 'MACRO', defect_type: 'early_warning_silent',
          llm_value: `score ${ew.score}/${ew.level}`, correct_value: `VIX ${vixNow?.toFixed(1)}/S&P5d ${spx5d?.toFixed(1)}% 스트레스인데 경보 침묵`, severity: 'high' });
        log(`  ❌ 시장 스트레스인데 earlyWarning ${ew.score} — 입력/임계 결함 의심`);
      } else if (mildStress && ew.score === 0) {
        defects.push({ ticker: 'MACRO', defect_type: 'early_warning_silent',
          llm_value: `score 0`, correct_value: `VIX ${vixNow?.toFixed(1)} 경계인데 score 0 — 입력 누락 의심`, severity: 'medium' });
        log(`  ⚠️ 경계 스트레스인데 score 0`);
      } else {
        log('  ✅ earlyWarning ↔ 외부 실측 정합');
      }
      // 2026-06-12: 과대경보 방향 (6/12 morning VIX 하루 stale 사건 — 실측은 진정됐는데 high 발간).
      //   실측이 평온(VIX<20 & S&P 5d>-2.5%)한데 score 45+ 면 stale 입력 의심.
      if (vixNow != null && spx5d != null && vixNow < 20 && spx5d > -2.5 && ew.score >= 45) {
        defects.push({ ticker: 'MACRO', defect_type: 'early_warning_overalarm',
          llm_value: `score ${ew.score}/${ew.level}`, correct_value: `실측 평온(VIX ${vixNow.toFixed(1)}, S&P5d ${spx5d.toFixed(1)}%) — stale 입력 의심`, severity: 'medium' });
        log(`  ⚠️ 실측 평온인데 earlyWarning ${ew.score} — stale 입력 의심`);
      }
      if ((ew.level === 'high' || ew.level === 'severe') && r.stance === 'bullish') {
        defects.push({ ticker: 'MACRO', defect_type: 'stance_gate_violation',
          llm_value: `stance bullish + ew ${ew.level}`, correct_value: 'stance-gate 가 cap 했어야 함', severity: 'high' });
        log(`  ❌ stance-gate 위반: ew=${ew.level} 인데 stance=bullish`);
      }
    } else {
      log('  ⚠️ earlyWarning 필드 없음 (구버전 보고서?)');
    }
  } catch (e) {
    log(`  ⚠️ probe skip (Yahoo 미가용): ${e?.message}`);
  }

  // 9b. 비현실 수익률 % (2026-06-12 KLAC "+1150.1% 급등" 사건 — Yahoo OHLCV 오염틱이 계산 통과)
  //    발간물 전체에서 ±60% 초과 "급등/급락/%" 패턴 검출 — 데이터 오류가 표시문에 도달했는지 최종 검증.
  log('\n## 비현실 수익률 % (±60% 초과)');
  {
    const flat = JSON.stringify(r);
    const crazy = [...flat.matchAll(/[+\-](\d{2,4}(?:\.\d+)?)%\s*(?:급등|급락|surge|plunge)/g)]
      .filter(m => parseFloat(m[1]) > 60).map(m => m[0]);
    if (crazy.length) {
      defects.push({ ticker: 'DATA', defect_type: 'unreal_return_pct',
        llm_value: crazy.slice(0, 3).join(', '), correct_value: '±60% 초과 = 데이터 오류 (OHLCV 오염/분할 미조정)', severity: 'high' });
      log(`  ❌ ${crazy.join(', ')}`);
    } else log('  ✅ 없음');
  }

  // 10. 매수∩매도 겹침 (2026-06-12 TSLA 양쪽 발간 사건 — rotation 이 경합심사 後 투입돼 미재심)
  log('\n## 매수∩매도 겹침 (양쪽 동시 발간 모순)');
  {
    const sellsAll = [...(r.sellRecommendations?.us ?? []), ...(r.sellRecommendations?.kr ?? [])].map(s => s.ticker);
    // 2026-06-12 v2: 파생 필드(portfolioByMarket)까지 검사 — 게이트가 portfolio 만 고치고 파생 필드에
    //   TSLA 잔존해 UI 가 양쪽 표시한 사건 (probe 가 portfolio 만 봐서 PASS 했던 자기결함 fix)
    const buyAll = new Set([
      ...(r.portfolio ?? []).map(p => p.ticker),
      ...(r.portfolioByMarket?.us ?? []).map(p => p.ticker),
      ...(r.portfolioByMarket?.kr ?? []).map(p => p.ticker),
    ]);
    const ov = [...buyAll].filter(t => sellsAll.includes(t));
    if (ov.length) {
      defects.push({ ticker: ov.join(','), defect_type: 'buy_sell_overlap',
        llm_value: `매수(파생필드 포함)+매도 양쪽 발간 ${ov.length}건`, correct_value: 'reconcile/final 게이트+재파생이 처리했어야', severity: 'high' });
      log(`  ❌ 겹침: ${ov.join(', ')}`);
    } else log('  ✅ 겹침 없음 (portfolio + portfolioByMarket 전수)');
  }

  // 11. 내러티브 그라운딩 (2026-06-16 라이브 noon 전수감사 — 검증이 포트폴리오 숫자만 보고 내러티브 텍스트는
  //     0% 검증하던 사각지대. 저장된 보고서 내부 대조만으로 4종 결함 detect: CJK누출·커브bp창작·수급방향역전·수익률→유입둔갑.)
  log('\n## 내러티브 그라운딩 (CJK누출/커브bp/수급방향/수익률-유입)');
  {
    const koFields = {
      thesis: r.thesis, macroAnalysis: r.macroAnalysis, technicalAnalysis: r.technicalAnalysis,
      fundamentalAnalysis: r.fundamentalAnalysis, topOpportunity: r.topOpportunity,
      hedgingSuggestion: r.hedgingSuggestion, portfolioRiskNote: r.portfolioRiskNote,
      'narrative.why': r.marketNarrative?.why, 'narrative.story': r.marketNarrative?.story,
    };
    const narrText = [r.thesis, r.marketNarrative?.why, r.marketNarrative?.story].filter(s => typeof s === 'string').join(' ');
    const krThesis = String(r.regionStances?.korea?.thesis ?? '');
    let nFound = 0;

    // (a) CJK 한자 누출 — 2026-07-01 제로톨러런스(사용자 "한자 나오면 안되 — 차라리 영어"): 국가약어(美中日韓)마저
    //   불허. sanitizeText 가 한글변환/스트립하므로 발간분은 클린이어야 — 살아남은 한자 1자라도 = 결함(닫힌루프).
    const HAN = /[\u2E80-\u2FDF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}]/gu;
    const HAN_ALLOW = new Set();
    const bleed = [];
    for (const [k, v] of Object.entries(koFields)) {
      if (typeof v !== 'string') continue;
      const hits = [...new Set((v.match(HAN) || []).filter(c => !HAN_ALLOW.has(c)))];
      if (hits.length) bleed.push(`${k}:${hits.join('')}`);
    }
    if (bleed.length) {
      defects.push({ ticker: 'NARRATIVE', defect_type: 'cjk_bleed',
        llm_value: bleed.slice(0, 4).join(' | '), correct_value: '한국어 텍스트에 중국어/일본어 한자 누출 — 한글로', severity: 'medium' });
      log(`  ❌ CJK누출: ${bleed.join(' | ')}`); nFound++;
    }

    // (b) 금리커브 bp 창작 — deterministic fingerprint(curveSlopePp)과 텍스트 bp 비교 (>25bp 괴리)
    const realSlopePp = r.marketVerdict?.analog?.fingerprint?.curveSlopePp ?? r.marketVerdict?.analog?.macroContext?.curveSlopePp;
    if (realSlopePp != null) {
      const realBp = Math.round(realSlopePp * 100);
      for (const [k, v] of Object.entries({ macroAnalysis: r.macroAnalysis, technicalAnalysis: r.technicalAnalysis, thesis: r.thesis })) {
        if (typeof v !== 'string') continue;
        const m = v.match(/(?:금리\s*(?:곡선|커브)|수익률\s*곡선|커브)[^0-9%]{0,14}(\d{1,3})\s*bp/);
        if (m && Math.abs(parseInt(m[1], 10) - realBp) > 25) {
          defects.push({ ticker: 'MACRO', defect_type: 'curve_slope_halluc',
            llm_value: `${k}: 금리곡선 ${m[1]}bp`, correct_value: `실제 ${realBp}bp (curveSlopePp ${realSlopePp})`, severity: 'medium' });
          log(`  ❌ 커브bp창작: ${k} ${m[1]}bp vs 실제 ${realBp}bp`); nFound++;
        }
      }
    }

    // (c) 수급 방향 역전 — regionStances.korea 가 "둔화/순매도/유출"인데 내러티브가 "순매수/유입" 주장.
    //   2026-06-18 정정: 기존 정규식은 "순매수 둔화가 지속"(=둔화 지속, 의미상 정상)을 오탐하고,
    //   "외국인 자금 유입 확대"(=진짜 역전)는 놓쳤음. → 매수/유입 주장을 잡되, 직후 둔화/감소 수식이
    //   붙은 경우(순매수 둔화)는 정상으로 제외.
    const krSell = /(둔화|순매도|감소|이탈|약화|유출)/.test(krThesis);
    const buyClaim = /외국인[^.]{0,16}(순유입|자금\s*유입|유입\s*확대|유입세|순매수\s*(지속|연속|이어|확대|기조|흐름))/.test(narrText);
    const slowdownQualified = /(순매수|유입)[^.]{0,6}(둔화|감소|축소|위축|약화)/.test(narrText);
    if (krSell && buyClaim && !slowdownQualified) {
      const inDir = krThesis.match(/(둔화|순매도|감소|이탈|약화|유출)/)?.[0];
      const claim = narrText.match(/외국인[^.]{0,16}(순유입|자금\s*유입|유입\s*확대|유입세|순매수\s*(?:지속|연속|이어|확대|기조|흐름))/)?.[0];
      defects.push({ ticker: 'NARRATIVE', defect_type: 'flow_direction_inversion',
        llm_value: `내러티브 "${claim}" vs 입력 "외국인 ${inDir}"`, correct_value: 'regionStances.korea 수급 방향과 일치', severity: 'high' });
      log(`  ❌ 수급방향역전: 입력 "${inDir}" → 내러티브 "${claim}"`); nFound++;
    }

    // (e) 라틴 bleed — 한글 토큰 안에 낀 소문자 라틴 (예: "스que이즈"=스퀴즈). 대문자(AI/NVDA)·약어 제외.
    const latinBleed = [];
    for (const [k, v] of Object.entries(koFields)) {
      if (typeof v !== 'string') continue;
      const hits = [...new Set((v.match(/[가-힣][a-z]{2,6}[가-힣]/g) || []))];
      if (hits.length) latinBleed.push(`${k}:${hits.join(',')}`);
    }
    if (latinBleed.length) {
      defects.push({ ticker: 'NARRATIVE', defect_type: 'latin_bleed',
        llm_value: latinBleed.slice(0, 4).join(' | '), correct_value: '한글 토큰에 라틴 문자 누출 — 한글로', severity: 'medium' });
      log(`  ❌ 라틴bleed: ${latinBleed.join(' | ')}`); nFound++;
    }

    // (d) 수익률→자금유입 둔갑 — KR 수익률/상승률 N% 가 내러티브에서 "유입/순매수 N%" 로 재사용
    const retPct = (krThesis.match(/(\d{1,2}(?:\.\d)?)\s*%\s*(?:상승|수익률|올라|return)/i)
      ?? krThesis.match(/4주[^%]{0,8}(\d{1,2}(?:\.\d)?)\s*%/))?.[1];
    if (retPct) {
      const re = new RegExp(`${retPct.replace('.', '\\.')}\\s*%[^.]{0,14}(유입|순매수)`);
      if (re.test(narrText)) {
        defects.push({ ticker: 'NARRATIVE', defect_type: 'return_as_flow',
          llm_value: `내러티브가 수익률 ${retPct}% 를 "유입/순매수 ${retPct}%" 로 둔갑`, correct_value: '수익률(return)≠자금유입(flow)', severity: 'high' });
        log(`  ❌ 수익률→유입둔갑: ${retPct}% (수익률) → "유입/순매수 ${retPct}%"`); nFound++;
      }
    }

    // (f) 수급 valence 모순 — 순매도 둔화/순매수 전환(매도압력 완화·매수 유입 = 긍정)을 '리스크/위험/제약'으로
    //     표기 (2026-06-17 사용자: noon thesis "외국인 순매도 둔화가 리스크로 작용" — 순매도 둔화는 긍정인데
    //     리스크로 뒤집힘. 리스크는 순매수 *둔화*·순매도 *확대* 여야 함). 전 내러티브 필드 스캔.
    const fullNarr = Object.values(koFields).filter(s => typeof s === 'string').join(' ');
    const valM = fullNarr.match(/(순매도|매도세)\s*둔화\s*[가이와과][^.]{0,24}(리스크|위험|제약)/)
      || fullNarr.match(/순매수\s*(전환|확대|유입)\s*[가이와과][^.]{0,20}(리스크|위험|제약)/);
    if (valM) {
      defects.push({ ticker: 'NARRATIVE', defect_type: 'flow_valence_contradiction',
        llm_value: `"${valM[0].slice(0, 44)}" — 긍정 수급(매도 둔화/매수 전환)을 리스크로 표기`,
        correct_value: '순매도 둔화=매도압력 완화(긍정). 리스크는 순매수 둔화·순매도 확대.', severity: 'high' });
      log(`  ❌ 수급valence모순: "${valM[0].slice(0, 44)}"`); nFound++;
    }

    // (g) 깨진 라틴 garble — 한글에 붙은 소문자 라틴 조각(예: "티gio","컨ti(","레지gio") — latin_bleed(양쪽
    //     한글) 이 못 잡는 끝/구두점 인접 케이스 (2026-06-17 사용자: macro "컨ti(gio 레지gio" 지적). 단위 제외.
    const UNIT_OK = /^(bp|ma|pe|ev|roe|roa|eps|yoy|qoq|etf|it|ai|us|kr|gpu|cpu|hbm|cpi|ppi|gdp|fx|oas|ig|hy)$/i;
    const garble = [];
    for (const [k, v] of Object.entries(koFields)) {
      if (typeof v !== 'string') continue;
      const frags = [...new Set([
        ...(v.match(/[가-힣][a-z]{2,6}(?![가-힣])/g) || []),     // 한글+라틴(뒤에 한글 아님 — latin_bleed 미포함분)
        ...(v.match(/(?<![가-힣A-Za-z])[a-z]{2,6}[가-힣]/g) || []),  // 라틴+한글 — 2026-07-03: 앞 라틴 제외(CamelCase "SoftBank의"→"ank" 오탐 fix)
      ].map(x => x.replace(/[가-힣]/g, '')).filter(lat => !UNIT_OK.test(lat)))];
      if (frags.length) garble.push(`${k}:${frags.slice(0, 4).join(',')}`);
    }
    if (garble.length) {
      defects.push({ ticker: 'NARRATIVE', defect_type: 'latin_garble',
        llm_value: garble.slice(0, 4).join(' | '), correct_value: '한글에 붙은 라틴 조각(번역/생성 깨짐) — 한글로 교정', severity: 'medium' });
      log(`  ❌ 라틴garble: ${garble.join(' | ')}`); nFound++;
    }

    // (h) 지수 절대값 환각 — KOSPI/KOSDAQ 절대 지수레벨 명시(2026-06-17 사용자가 글씨 정독해 catch한
    //     "KOSPI 8,864" — KOSPI 실값 ~2,500-3,200). 우리 ^KS11 피드는 절대값을 공급 안 함(null/unavailable)
    //     → 내러티브의 절대 지수레벨은 전부 ungrounded 환각(소스 없는 특정숫자=CLAUDE.md 환각). 상대지표(%·일선)는 정상.
    //     연도(19xx/20xx)·% ·일선·p 인접은 제외(상대표현/연도라 정상).
    const idxM = fullNarr.match(/(KOSPI|코스피|KOSDAQ|코스닥)\s*([0-9]{1,2},[0-9]{3}|[0-9]{4})(?!\s*(일|%|p\b|년|pt|선))/);
    if (idxM) {
      const num = parseInt(idxM[2].replace(/,/g, ''), 10);
      if (num >= 1000 && !(num >= 1990 && num <= 2099)) {  // 지수레벨(연도 제외)
        defects.push({ ticker: 'NARRATIVE', defect_type: 'index_value_fabrication',
          llm_value: `"${idxM[0]}" — 지수 절대레벨(^KS11 피드 null=ungrounded 환각)`,
          correct_value: '우리 데이터엔 KOSPI/KOSDAQ 절대값 없음 → 상대지표(200일선 대비%·20일변화%·고점대비%)만 사용. 절대 지수레벨 명시 금지.', severity: 'high' });
        log(`  ❌ 지수값환각: "${idxM[0]}"`); nFound++;
      }
    }

    if (!nFound) log('  ✅ 내러티브 그라운딩 이상 없음');
  }

  log(`\n## 종합 — 결함 ${defects.length}건`);
  return { defects, total: (r.portfolio||[]).length };
}

// CLI usage — robust Windows path 비교 (이전 isCLI 항상 false → 실행 안 됨)
// 2026-05-31: silent false pass 의 근본 원인 — argv[1] 와 import.meta.url 의 case/sep mismatch.
//   해결: argv[1] 의 basename 가 'verify-report.mjs' 이면 CLI 로 인식.
const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/').toLowerCase();
const isCLI = argv1.endsWith('/verify-report.mjs') || argv1.endsWith('verify-report.mjs');
if (isCLI) {
  const file = process.argv[2] || pickLatestReport();
  if (!file) {
    console.log('\n❌ FAIL — reports/ 에서 report-*.json 을 찾지 못함 (검증 대상 없음).');
    process.exit(1);
  }
  console.log(`검증 대상: ${file}`);
  const { defects } = await verifyReport(file);
  // verify-all.mjs 의 grep ❌/FAIL pattern 이 caller stdout 에 들어가도록 명시.
  if (defects.length > 0) {
    console.log(`\n❌ FAIL — ${defects.length} defects detected. Run \`node ${process.argv[1]} <file>\` for details.`);
  } else {
    console.log(`\n✅ PASS — 0 defects.`);
  }
  // 2026-06-12: process.exit() 금지 — probe 의 fetch keep-alive 소켓이 닫히기 전 exit 하면
  //   Windows libuv assertion crash (UV_HANDLE_CLOSING, exit -1073740791) → PASS 도 비정상 종료로 위장.
  //   exitCode 설정 후 자연 종료 (keep-alive ~4s 후 드레인).
  process.exitCode = defects.length > 0 ? 1 : 0;
}
