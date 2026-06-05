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
let CANDIDATE_META = {};
try {
  const data = JSON.parse(fs.readFileSync('data/candidate-tickers.json', 'utf8'));
  CANDIDATE_META = data.meta ?? {};
} catch { /* skip */ }

// 2026-06-03 CPRT→"Cypress Semiconductor" 사건: ticker↔회사명 검증이 전혀 없었음(검증 사각지대).
//   company-names.json(companies-batch*.ts 추출 ~499 실제명) 을 권위 소스로 name 환각 cross-check.
let COMPANY_NAMES = {};
try {
  COMPANY_NAMES = JSON.parse(fs.readFileSync('data/company-names.json', 'utf8'));
} catch { /* build-company-names.mjs 미실행 — name probe skip */ }

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
  '자동차','모빌리티','전기차','수소차','완성차',
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
  'automotive': ['자동차','모빌리티','전기차','수소차','완성차','배터리','2차전지','이차전지'],
  'transportation equipment': ['자동차','모빌리티','전기차','완성차','조선','항공','기계'],
  'transportation': ['항공','조선','자동차'],
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
  'consumer-discretionary': ['자동차','의류','패션','화장품','뷰티','유통','이커머스','게임','엔터','면세'],
  'consumer discretionary': ['자동차','의류','패션','화장품','뷰티','유통','게임','엔터'],
  'consumer-defensive': ['식품','음료','담배','유통'],
  'consumer staples': ['식품','음료','담배','유통'],
  'wholesale': ['유통','이커머스','식품'],
  'ev-battery': ['배터리','2차전지','이차전지','전기차','소재'],
  'battery': ['배터리','2차전지','이차전지','소재'],
  'real-estate': ['부동산','리츠','건설'],
};
const DEMAND_CTX = /(수요|시장|성장|업황|호황|특수|확대|반등|회복|모멘텀|테마|수혜)/;
/** text 의 산업어 중 sector 허용 어휘에 없고 demand 맥락인 첫 항목 반환 (cross-sector thesis 환각). 없으면 null. */
export function mismatchedIndustryTerm(text, sectorLower) {
  if (typeof text !== 'string' || !text) return null;
  const allowed = SECTOR_VOCAB[sectorLower];
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

export function verifyReport(file, { silent = false } = {}) {
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

  // 1. sector ↔ meta consistency (LLM 환각 vs candidate-tickers meta)
  log('\n## sector ↔ meta 일치 (LLM 환각 detect)');
  let secFix = 0;
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
    const m = (p.rationale||'').match(/52주\s*:\s*[₩$]?([\d,.]+)\s*-\s*[₩$]?([\d,.]+)/);
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
  for (const p of (r.portfolio||[])) {
    // 2026-06-06: ₩/$ 필수 + 근접(≤10자) — 종전 `[₩$]?`(통화 옵션)이 "50MA 돌파...매출 -4.9%"의
    //   -4.9 를 50MA 로 오인(005490 false ❌). 실 MA 는 "50MA 위(₩410,710)"처럼 통화기호 동반.
    const m50 = (p.rationale||'').match(/50MA[^₩$]{0,10}[₩$]([\d,.]+)/);
    const m200 = (p.rationale||'').match(/200MA[^₩$]{0,10}[₩$]([\d,.]+)/);
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
    let reason = null;
    if (divergence > 2.5) reason = `50MA↔200MA ${divergence.toFixed(1)}x 발산 (물리적 불가)`;
    else if (price != null && (v50 < price / 3 || v50 > price * 3 || v200 < price / 3 || v200 > price * 3))
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
  const pctByValue = new Map();
  for (const p of (r.portfolio || [])) {
    const text = (p.fundamentalBasis || '') + ' ' + (Array.isArray(p.catalysts) ? p.catalysts.join(' ') : '');
    const vals = new Set([...text.matchAll(/(\d+\.\d+)%/g)].map(m => m[1]));
    for (const v of vals) {
      if (parseFloat(v) < 1) continue; // 0.x% 잡음 제외
      const arr = pctByValue.get(v) ?? []; arr.push(p.ticker); pctByValue.set(v, arr);
    }
  }
  for (const [v, tks] of pctByValue) {
    const uniq = [...new Set(tks)];
    if (uniq.length >= 2) {
      log(`  ⚠️ 동일 ${v}% → ${uniq.length}종목(${uniq.join(', ')}) — 서로 다른 기업 동일수치 = copy-paste 환각`);
      defects.push({
        ticker: uniq.join('/'), defect_type: 'dup_pct_halluc',
        llm_value: `${v}% ×${uniq.length}`, correct_value: '종목별 실수치(인사이더/매출 grounded)', severity: 'medium',
      });
      dupPctBad++;
    }
  }
  if (dupPctBad === 0) log('  ✅ 종목간 동일 %수치 없음');

  // 7. 기술 일관성 — RSI/지지선 환각 detect (2026-06-05, 삼전 "RSI 45+과매도"(실제 58)·
  //    "120,000 지지"(실제가 327k) 환각 사건). report 내부만으로 판정(외부 fetch 불필요):
  //    (a) "RSI N" + "과매도"(N≥35) 또는 "과매수"(N≤65) 모순, (b) entryRationale 의 지지가격이
  //    entryZone 과 >25% 이탈(지지선 환각).
  log('\n## 기술 일관성 (RSI/지지선 환각 — 2026-06-05)');
  let techBad = 0;
  const parseWon = (s) => { const m = (s || '').replace(/[,₩\s]/g, '').match(/(\d{4,})/); return m ? +m[1] : null; };
  for (const p of (r.portfolio || [])) {
    const txt = `${p.technicalBasis || ''} ${p.entryRationale || ''} ${p.rationale || ''}`;
    const rsiM = txt.match(/RSI\s*([0-9]{1,3})/i);
    const rsi = rsiM ? +rsiM[1] : null;
    const oversold = /과매도|oversold/i.test(txt), overbought = /과매수|overbought/i.test(txt);
    if (rsi != null && oversold && rsi >= 35) {
      log(`  ⚠️ ${p.ticker} "RSI ${rsi}" + "과매도" 모순 (과매도는 RSI<35)`);
      defects.push({ ticker: p.ticker, defect_type: 'rsi_halluc', llm_value: `RSI ${rsi}+과매도`, correct_value: 'RSI<35 만 과매도', severity: 'medium' });
      techBad++;
    } else if (rsi != null && overbought && rsi <= 65) {
      log(`  ⚠️ ${p.ticker} "RSI ${rsi}" + "과매수" 모순 (과매수는 RSI>65)`);
      defects.push({ ticker: p.ticker, defect_type: 'rsi_halluc', llm_value: `RSI ${rsi}+과매수`, correct_value: 'RSI>65 만 과매수', severity: 'medium' });
      techBad++;
    } else if (oversold && rsi == null && /지지|과매도/.test(p.entryRationale || '')) {
      // RSI 값 없이 "과매도" 단언 — 근거 없는 환각
      log(`  ⚠️ ${p.ticker} RSI 값 없이 "과매도" 단언 (근거 미상)`);
      defects.push({ ticker: p.ticker, defect_type: 'rsi_halluc', llm_value: 'RSI값없이 과매도', correct_value: 'RSI 값 명시 또는 제거', severity: 'low' });
      techBad++;
    }
    // 지지선 vs entryZone 이탈 — entryRationale 의 가격이 entryZone 과 >25% 차이면 지지선 환각
    const ezLow = parseWon((p.entryZone || '').split(/[-~]/)[0]);
    const supW = parseWon(p.entryRationale);
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
  if (port.length > 0 && (allocSum < 95 || allocSum > 105)) {
    log(`  ⚠️ allocation 합 ${allocSum} (목표 100) — ${port.length}종목`);
    defects.push({
      ticker: 'PORTFOLIO', defect_type: 'allocation_sum',
      llm_value: `합 ${allocSum}% (${port.length}종목)`, correct_value: 'allocation 합 = 100', severity: 'medium',
    });
  } else if (port.length > 0) {
    log(`  ✅ allocation 합 ${allocSum} (${port.length}종목) 정상`);
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
  const { defects } = verifyReport(file);
  // verify-all.mjs 의 grep ❌/FAIL pattern 이 caller stdout 에 들어가도록 명시.
  if (defects.length > 0) {
    console.log(`\n❌ FAIL — ${defects.length} defects detected. Run \`node ${process.argv[1]} <file>\` for details.`);
  } else {
    console.log(`\n✅ PASS — 0 defects.`);
  }
  process.exit(defects.length > 0 ? 1 : 0);
}
