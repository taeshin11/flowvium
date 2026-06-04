#!/usr/bin/env node
/**
 * scripts/check-data-quality.mjs — production 데이터 품질 모니터.
 *
 * 사용자 지적(2026-06-02): "보고서 검토할 때 엔드포인트 검토 다 같이 되고 있나? contango/
 * 뉴스 번역 같은 게 제대로 검토 안 되는 것 같다." → verify-report(환각)·check-stall(신선도)가
 * 못 보는 *데이터 품질* 사각지대를 production 실호출로 점검.
 *
 * 점검 항목:
 *   [A] 엔드포인트 헬스 — 핵심 endpoint 실호출, non-200 또는 body {error} 감지.
 *   [B] 뉴스 번역 — news-cascade?locale=ko 제목이 실제 한글인지 (영어면 번역 미완).
 *   [C] contango — commodity-curve 가 synthetic(carry-model) 인데 그 사실이 노출되는지.
 *
 * 사용: node scripts/check-data-quality.mjs   (exit 1 = 결함)
 */
const BASE = 'https://flowvium.net';
const issues = [];
const info = [];

async function getJson(path, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal, headers: { 'User-Agent': 'flowvium-dq' } });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch { /* non-json */ }
    return { status: res.status, body, text };
  } catch (e) { return { status: 0, body: null, text: String(e?.message || e) }; }
  finally { clearTimeout(t); }
}

// [A] 엔드포인트 헬스 — 핵심 endpoint 표본
const ENDPOINTS = [
  '/api/stock-price/AAPL', '/api/stock-price/005930.KS', '/api/price-history?ticker=005930.KS&days=30',
  '/api/company-financials/AAPL', '/api/company-financials/TSM', '/api/company-kr/005930',
  '/api/fear-greed', '/api/sector-pe', '/api/commodity-curve', '/api/news-cascade?locale=ko',
  '/api/yield-curve', '/api/economic-calendar',
];

async function main() {
  // [A]
  let ok = 0;
  for (const ep of ENDPOINTS) {
    const r = await getJson(ep);
    const errField = r.body && typeof r.body === 'object' && (r.body.error || (Array.isArray(r.body) && r.body.length === 0));
    if (r.status !== 200) issues.push(`[A] ${ep} → HTTP ${r.status}`);
    else if (errField) issues.push(`[A] ${ep} → 200 but body {error:"${r.body.error ?? 'empty'}"}`);
    else ok++;
  }
  info.push(`[A] 엔드포인트 ${ok}/${ENDPOINTS.length} 정상`);

  // [B] 뉴스 번역 — 2026-06-04: ko 만 보던 사각지대(ja/zh 영어 leak 미감지) → 다국어 검증.
  //   ko(한글) + ja(가나/한자) + zh-CN(한자). cron 401 로 다국어 warm 실패하던 것을 모니터가 잡도록.
  {
    const LOC = [{ l: 'ko', re: /[가-힣]/ }, { l: 'ja', re: /[぀-ヿ一-鿿]/ }, { l: 'zh-CN', re: /[一-鿿]/ }];
    for (const { l, re } of LOC) {
      const r = await getJson(`/api/news-cascade?locale=${l}`);
      const arts = (r.body?.articles || r.body?.events || r.body?.items || []);
      if (arts.length === 0) { info.push(`[B] news-cascade ${l} 기사 0`); continue; }
      const titles = arts.map(a => a.title || a.headline || '').filter(Boolean);
      const ok = titles.filter(t => re.test(t)).length;
      const pct = titles.length ? Math.round(ok / titles.length * 100) : 0;
      if (pct < 80) issues.push(`[B] 뉴스 번역 미완(${l}) — ${ok}/${titles.length} (${pct}%). 예: "${(titles.find(t => !re.test(t)) || '').slice(0, 35)}"`);
      else info.push(`[B] 뉴스 번역 ${l} ${ok}/${titles.length} (${pct}%)`);
    }
  }

  // [C] contango / commodity 추정 표시
  {
    const r = await getJson('/api/commodity-curve');
    const curves = r.body?.curves || [];
    if (curves.length === 0) issues.push('[C] commodity-curve 빈 응답');
    else {
      for (const c of curves) {
        // synthetic curve 인데 ticker 가 실제 데이터(FRED/Yahoo) 처럼 보이면 오인 소지 — 표시 점검
        const firstTicker = c.curve?.[0]?.ticker ?? '';
        const looksReal = /^(FRED|YAHOO|CME):/i.test(firstTicker);
        if (c.synthetic && looksReal) info.push(`[C] ${c.id} ${c.structure}(synthetic=true, label="${firstTicker}" — 추정인데 실데이터 라벨, UI 표시 점검)`);
        else info.push(`[C] ${c.id} ${c.structure}${c.synthetic ? '(synthetic)' : '(real)'}`);
      }
    }
  }

  // [E] 번역 엔드포인트 — /api/translate 가 실제 대상언어 출력을 내는지 (cloud quota 소진 시
  //     원문 영어 그대로 반환하던 사각지대. 2026-06-03 회사페이지 미번역 사건 후 신설).
  {
    try {
      const res = await fetch(`${BASE}/api/translate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Apple designs and sells smartphones, computers, and services worldwide.', targetLocale: 'ko' }),
        signal: AbortSignal.timeout(70000),
      });
      const j = await res.json().catch(() => ({}));
      const out = j.translated || '';
      const hasKo = /[가-힣]/.test(out);
      if (!hasKo) issues.push(`[E] /api/translate ko 미번역 — 출력에 한글 없음 (cloud quota 소진/Ollama 다운 의심). 예: "${String(out).slice(0, 50)}"`);
      else info.push(`[E] /api/translate ko OK (source=${j.source ?? '?'}${j.cached ? ',cached' : ''})`);
    } catch (e) { issues.push(`[E] /api/translate 호출 실패: ${String(e.message || e).slice(0, 50)}`); }
  }

  // [F] 동적성/freshness — 값이 실제로 갱신되는지(frozen/stale 캐시·고정상수 감지). 2026-06-04 신설.
  //     "출력이 맞나"(A~E)와 별개로 "계속 동적으로 업데이트되나"를 updatedAt/source 로 검증.
  {
    const now = Date.now();
    const ageH = (ts) => ts ? (now - new Date(ts).getTime()) / 3600000 : Infinity;
    // 1) 실시간 시세 — updatedAt 신선(라이브 갱신). 장중 캐시 고려 48h 임계.
    const sp = await getJson('/api/stock-price/AAPL');
    const spAge = ageH(sp.body?.updatedAt);
    if (spAge > 48) issues.push(`[F] stock-price updatedAt ${spAge.toFixed(0)}h 경과 — 시세 갱신 정지 의심(frozen)`);
    else info.push(`[F] stock-price 신선 (${spAge.toFixed(1)}h)`);
    // 2) F&G source=live (정적 폴백 아님)
    const fg = await getJson('/api/fear-greed');
    const fgSrc = fg.body?.source;
    if (fgSrc && fgSrc !== 'live') issues.push(`[F] fear-greed source=${fgSrc} (정적 폴백 — 크론 미갱신 의심)`);
    else info.push(`[F] fear-greed source=${fgSrc ?? '?'}`);
    // 3) ADR FX 변환 라이브 — 외국통화 ADR 재무가 환산되는지 + 라이브 FX
    const adr = await getJson('/api/company-financials/ASML', 25000);
    const adrSrc = adr.body?.source ?? '';
    if (adr.body?.latestAnnual?.revenueUSD == null) issues.push('[F] ASML(EUR ADR) 재무 누락 — 다통화/FX 경로 정지 의심');
    else info.push(`[F] ADR FX 변환 OK (ASML rev=$${(adr.body.latestAnnual.revenueUSD/1e9).toFixed(1)}B, ${adrSrc.replace('SEC EDGAR XBRL ','')})`);
  }

  // [D] 커버리지-차원 — "카테고리 0건 = 빨간불" 원칙. 최신 보고서에 KR portfolio 가 있는데
  //     companyChanges/supplyChain 에 KR 이 0 이면 침묵이 아니라 결함으로 surface.
  //     (US-우선 파이프라인이 KR 을 조용히 누락하던 사각지대 자동 감지.)
  try {
    const { readdirSync, readFileSync } = await import('fs');
    const dir = 'C:/NoAddsMakingApps/FlowVium/reports';
    const files = readdirSync(dir).filter(f => /^report-\d{4}-\d{2}-\d{2}-(midnight|morning|noon|afternoon|evening)-[a-z-]+\.json$/.test(f)).sort();
    const latest = files[files.length - 1];
    if (latest) {
      const d = JSON.parse(readFileSync(`${dir}/${latest}`, 'utf8'));
      const isKR = t => /\.(KS|KQ)$/.test(t || '');
      const krPortfolio = (d.portfolio || []).filter(p => isKR(p.ticker)).length;
      if (krPortfolio > 0) {
        const ccKr = (d.companyChanges || []).filter(x => isKR(x.ticker)).length;
        const scArr = d.supplyChainChanges || d.supplyChainSignals || [];
        const scKr = scArr.filter(x => isKR(x.ticker) || /삼성|하이닉스|현대|네이버|카카오|포스코|셀트리온/.test(JSON.stringify(x))).length;
        if (ccKr === 0) issues.push(`[D] companyChanges KR 0건 (portfolio KR ${krPortfolio}개 보유) — KR 기업변화 누락 의심 (${latest})`);
        else info.push(`[D] companyChanges KR ${ccKr}건`);
        if (scKr === 0) issues.push(`[D] supplyChain KR 0건 (portfolio KR ${krPortfolio}개) — KR 공급망 누락 의심`);
        else info.push(`[D] supplyChain KR ${scKr}건`);
      } else info.push('[D] 최신 보고서 KR portfolio 없음 (coverage 점검 skip)');
    }
  } catch (e) { info.push(`[D] coverage 점검 불가: ${String(e.message || e).slice(0, 50)}`); }

  // [G] 페이지 필드 완전성 — "endpoint 200 ≠ 필드 채워짐" 사각지대. 2026-06-04 신설.
  //     사용자가 직접 발견하던 빈칸(/earnings estimate, /insider 한국 기관)을 모니터가 사전 포착.
  //     원칙: 페이지가 *표시하는* 행의 핵심 필드 채움률이 임계 미만이면 결함.
  {
    // 1) /api/earnings — 표시 종목의 estimate 채움률 (CEF/마이크로캡 필터 후 ≥70% 기대).
    const ern = await getJson('/api/earnings', 25000);
    const cov = ern.body?.coverage;
    const arr = ern.body?.earnings ?? [];
    if (arr.length === 0) {
      issues.push('[G] /earnings 0건 — 캘린더 적재 정지 의심');
    } else {
      const est = cov?.estCoverage ?? Math.round(arr.filter(e => e.epsEstimate != null || e.revenueEstimate != null).length / arr.length * 100);
      if (est < 70) issues.push(`[G] /earnings estimate 채움률 ${est}% (<70%) — 빈칸 과다, 필터/소스 점검`);
      else info.push(`[G] /earnings estimate 채움률 ${est}% (${arr.length}건${cov?.droppedNoise != null ? `, 노이즈 ${cov.droppedNoise} 제거` : ''})`);
    }
    // 2) /api/korea-flow — 기관 순매수/매도 비공백 (KRX LOGOUT/파서버그로 0건 되던 사각지대).
    const kf = await getJson('/api/korea-flow?period=1d', 25000);
    const instBuy = kf.body?.topInstBuy?.length ?? 0;
    const instSell = kf.body?.topInstSell?.length ?? 0;
    if (instBuy === 0 && instSell === 0) {
      issues.push(`[G] /insider 한국 기관 순매수/매도 0건 (source=${kf.body?.source ?? '?'}) — KRX/Naver 기관 파싱 정지 의심`);
    } else {
      info.push(`[G] /insider 한국 기관 매수 ${instBuy}·매도 ${instSell}건 (source=${kf.body?.source ?? '?'})`);
    }
    // 2b) 기간 차별화 — 1d vs 4w 가 동일값이면 period 파라미터 무효(사용자 "1d=1w=4w=13w 똑같다" 버그).
    const kf4w = await getJson('/api/korea-flow?period=4w', 25000);
    const n1 = kf.body?.institutionNet, n4 = kf4w.body?.institutionNet;
    if (n1 != null && n4 != null && n1 === n4) {
      issues.push(`[G] /insider 기간 1d=4w 동일값(${n1}) — period 누적 미작동(Naver multi-day 정지 의심)`);
    } else if (n1 != null && n4 != null) {
      info.push(`[G] /insider 기간 차별화 OK (1d=${(n1/1e8|0)}억 ≠ 4w=${(n4/1e8|0)}억, 4w effDays=${kf4w.body?.effectiveTradingDays})`);
    }
  }

  // [H] OSINT 동적성 — social(트윗/뉴스)·crypto(거래내역)·sanctions(OFAC) 실데이터 흐르는지.
  //     2026-06-04 신설: 사용자가 /osint "변하는 게 없다" 지적 — 모니터가 OSINT 를 전혀 안 보던 사각지대.
  {
    // 1) social — 피드 살아있나 + 트윗(Nitter) degraded 여부 surface.
    const soc = await getJson('/api/osint/social', 25000);
    const newsCount = soc.body?.newsCount ?? 0;
    const tweetCount = soc.body?.tweetCount ?? 0;
    const socSrc = soc.body?.source ?? '?';
    if ((soc.body?.entries?.length ?? 0) === 0) issues.push('[H] /osint social 0건 — 피드 정지');
    else if (socSrc === 'news-only' || tweetCount === 0) info.push(`[H] /osint social 뉴스 ${newsCount}건 ⚠️ 트윗 0 (Nitter degraded — source=${socSrc})`);
    else info.push(`[H] /osint social 트윗 ${tweetCount}·뉴스 ${newsCount}건`);
    // 2) crypto — 활성 지갑(Vitalik) 거래내역이 살아있는지 (txCount=0 = ETH tx 파싱 정지).
    const cr = await getJson('/api/osint/crypto?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chain=eth', 25000);
    const bal = cr.body?.balance ?? null;
    const txc = cr.body?.txCount ?? 0;
    if (bal == null) issues.push('[H] /osint crypto 잔액 null — ETH 조회 정지');
    else if (txc === 0) issues.push(`[H] /osint crypto Vitalik txCount=0 (잔액 ${Number(bal).toFixed(1)}ETH는 OK) — ETH 거래내역 파싱 정지`);
    else info.push(`[H] /osint crypto OK (Vitalik ${Number(bal).toFixed(1)}ETH, tx ${txc})`);
    // 3) sanctions — OFAC SDN 적재.
    const sanc = await getJson('/api/osint/sanctions', 25000);
    const sGroups = sanc.body?.groups ? Object.keys(sanc.body.groups).length : 0;
    if (sGroups === 0) issues.push('[H] /osint sanctions 0 그룹 — OFAC SDN 적재 정지');
    else info.push(`[H] /osint sanctions ${sGroups} 그룹`);
  }

  // [K] 파라미터 차별화/완전성 — period/country/tf 등 파라미터 엔드포인트가 *값마다* 비어있지 않고
  //   서로 다른지 검사. 2026-06-04 신설: "기본 param 만 보던" 사각지대(heatmap country=US 만 OK,
  //   KR/JP 빈값 / korea-flow 1d=4w 동일값)를 사용자가 먼저 발견 → 모든 param 값 전수 검증.
  {
    const paramSets = [
      { name: 'market-heatmap', vals: ['US', 'KR', 'JP', 'CN', 'EU'], url: v => `/api/market-heatmap?country=${v}`, arr: b => b?.sectors, sig: b => (b?.sectors?.length ?? 0) },
      { name: 'daily-brief', vals: ['1w', '4w', '13w'], url: v => `/api/daily-brief?tf=${v}`, arr: b => [b?.outlook], sig: b => String(b?.outlook ?? '').slice(0, 40) },
      { name: 'korea-flow', vals: ['1d', '4w'], url: v => `/api/korea-flow?period=${v}`, arr: b => b?.topInstBuy, sig: b => b?.institutionNet ?? 0 },
    ];
    for (const ps of paramSets) {
      const results = await Promise.all(ps.vals.map(async v => ({ v, body: (await getJson(ps.url(v), 30000)).body })));
      // unavailable:true = 소스 차단 known(정직 표시) → silent-empty 결함과 구분.
      const known = results.filter(r => r.body?.unavailable === true).map(r => r.v);
      const empties = results.filter(r => !(ps.arr(r.body)?.length) && r.body?.unavailable !== true).map(r => r.v);
      const live = results.filter(r => ps.arr(r.body)?.length);
      const sigs = live.map(r => String(ps.sig(r.body)));
      const allSame = sigs.length > 1 && new Set(sigs).size === 1;
      if (empties.length) issues.push(`[K] ${ps.name} 빈 param(silent): ${empties.join('/')} — 값마다 데이터 있어야`);
      else if (allSame) issues.push(`[K] ${ps.name} 전 param 동일값 — 파라미터 무효(누적/필터 미작동)`);
      else info.push(`[K] ${ps.name} param 차별화 OK (live ${live.length}${known.length ? `, known-unavailable ${known.length}: ${known.join('/')}` : ''})`);
    }
  }

  // [I] 모니터 자가-커버리지 — "왜 사각지대가 반복됐나"의 근본 차단 (2026-06-04 신설).
  //     근본원인: 검증 프로브가 엔드포인트별 수동 추가 → 프로브 없는 페이지는 자동으로 사각지대였고,
  //     "무엇을 모니터해야 하나 vs 실제 모니터하나"를 대조하는 메커니즘이 없었음(news-gap·osint 사건).
  //     해결: 페이지가 fetch 하는 user-facing 엔드포인트 ∖ 이 모니터가 검사하는 엔드포인트 = 사각지대.
  //     새 페이지 추가 시 자동으로 여기 잡혀 프로브 추가를 강제 → 사각지대 재발 불가.
  try {
    const { readdirSync, readFileSync } = await import('fs');
    const PAGES_DIR = 'C:/NoAddsMakingApps/FlowVium/src/components/pages';
    const SELF = 'C:/NoAddsMakingApps/FlowVium/scripts/check-data-quality.mjs';
    // 동적성/완전성 프로브가 불필요한 인프라/유틸 (존재만으로 충분하거나 사용자 비노출).
    const EXCLUDE = new Set(['admin', 'cron', 'ai', 'batch-prices', 'translate', 'osint']); // osint 는 [H] 가 하위경로로 커버
    const epRe = /\/api\/([a-z0-9][a-z0-9-]*)/g;
    const pageEndpoints = new Set();
    for (const f of readdirSync(PAGES_DIR).filter(x => x.endsWith('.tsx'))) {
      const src = readFileSync(`${PAGES_DIR}/${f}`, 'utf8');
      let m; while ((m = epRe.exec(src))) pageEndpoints.add(m[1]);
    }
    const selfSrc = readFileSync(SELF, 'utf8');
    const monitored = new Set();
    let mm; const epRe2 = /\/api\/([a-z0-9][a-z0-9-]*)/g;
    while ((mm = epRe2.exec(selfSrc))) monitored.add(mm[1]);
    // [A] 헬스체크가 커버하는 엔드포인트도 "최소 alive 검증됨"으로 인정
    const uncovered = [...pageEndpoints].filter(e => !EXCLUDE.has(e) && !monitored.has(e)).sort();
    const total = [...pageEndpoints].filter(e => !EXCLUDE.has(e)).length;
    // 무검증 엔드포인트를 제네릭 auto-probe — bespoke 프로브가 없어도 최소 liveness+non-empty+freshness
    //   를 강제. param 엔드포인트는 샘플 URL. 이러면 "프로브 안 짠 페이지"도 자동 검증돼 사각지대 0.
    const SAMPLE = {
      'analyst-target': '/api/analyst-target/AAPL', 'company-news': '/api/company-news?ticker=AAPL',
      'company-recs': '/api/company-recs/AAPL', 'company-desc': null, // Ollama 느림 — skip
      'investment-strategy': null, // 보고서 대형 — verify-report 가 별도 검증
      'satellite-image': null, 'nport-holdings': '/api/nport-holdings?ticker=069500',
      'iv': '/api/iv/AAPL',
    };
    const SKIP = new Set(['company-desc', 'investment-strategy', 'satellite-image']);
    const probeOne = async (ep) => {
      if (SKIP.has(ep)) return { ep, skip: true };
      const path = SAMPLE[ep] ?? `/api/${ep}`;
      let r = await getJson(path, 12000);
      // 타임아웃(status 0) → 느린 엔드포인트일 수 있음. 긴 타임아웃 1회 재시도해 slow vs dead 구분.
      if (r.status === 0) {
        const r2 = await getJson(path, 30000);
        if (r2.status === 0 || r2.status >= 400) return { ep, dead: `HTTP ${r2.status}` };
        return { ep, slow: '응답 12s 초과(30s 내 OK) — 캐시/성능 점검 권장', skipBody: true };
      }
      if (r.status >= 400) return { ep, dead: `HTTP ${r.status}` };
      const b = r.body;
      if (b == null || (typeof b === 'object' && Object.keys(b).length === 0)) return { ep, dead: 'empty body' };
      if (b.error && !b.entries && !b.data) return { ep, dead: `error: ${String(b.error).slice(0, 30)}` };
      // configured===false = 유료 API 대기/미설정 (의도된 잠금, 결함 아님 — locked 로 분류).
      if (b.configured === false) return { ep, locked: true };
      // non-empty 데이터 흔적: 배열 길이 OR 스칼라 OR 구조 객체(market/outlook 등) 존재.
      const arrLen = ['entries', 'data', 'results', 'signals', 'movers', 'items', 'companies', 'holdings', 'alerts', 'events', 'trades', 'rows', 'curve', 'sectors']
        .reduce((n, k) => n + (Array.isArray(b[k]) ? b[k].length : 0), 0);
      const objKeys = ['market', 'outlook', 'capital', 'company', 'summary', 'consensus', 'byCountry', 'byAsset'];
      const hasObj = objKeys.some(k => b[k] != null && (typeof b[k] !== 'object' || Object.keys(b[k]).length > 0));
      const hasScalar = b.score != null || b.value != null || b.probability != null || b.balance != null || b.total > 0 || typeof b.updatedAt === 'string' || typeof b.generatedAt === 'string';
      if (arrLen === 0 && !hasScalar && !hasObj && !Array.isArray(b)) return { ep, weak: '빈 배열/스칼라/구조 없음 — 정적/정지 의심' };
      return { ep, ok: true };
    };
    const probed = await Promise.all(uncovered.map(probeOne));
    const dead = probed.filter(p => p.dead);
    const weak = probed.filter(p => p.weak);
    const slow = probed.filter(p => p.slow);
    const okN = probed.filter(p => p.ok).length;
    const skipN = probed.filter(p => p.skip).length;
    const lockedN = probed.filter(p => p.locked).length;
    if (dead.length) issues.push(`[I] 무검증 엔드포인트 중 DEAD ${dead.length}: ${dead.map(d => `${d.ep}(${d.dead})`).join(', ')}`);
    if (weak.length) issues.push(`[I] 무검증 엔드포인트 중 빈데이터 ${weak.length}: ${weak.map(w => w.ep).join(', ')}`);
    if (slow.length) info.push(`[I] ⚠️ 느린 엔드포인트 ${slow.length}: ${slow.map(s => s.ep).join(', ')} (live, 12s 초과 — 캐시 점검)`);
    info.push(`[I] 자가-커버리지: bespoke ${monitored.size}개 + auto-probe ${okN + slow.length}/${uncovered.length} live (locked ${lockedN}, skip ${skipN}, slow ${slow.length}, dead ${dead.length}, weak ${weak.length}) — page 엔드포인트 ${total}개 전수 검증`);
  } catch (e) { info.push(`[I] 자가-커버리지 점검 불가: ${String(e.message || e).slice(0, 50)}`); }

  // [J] 세션 enum drift 가드 — "왜 아직도 하드코딩" 의 검증 (2026-06-04 신설).
  //   보고서 세션이 여러 파일에 하드코딩돼 슬롯 추가 시 한 곳만 빠뜨리면 보고서가 silent 미서빙됨.
  //   data/report-sessions.json(단일 소스)의 세션을 critical 파일들이 모두 참조하는지 검사 → 누락 시 🚨.
  try {
    const { readFileSync } = await import('fs');
    const ROOT = 'C:/NoAddsMakingApps/FlowVium';
    const cfg = JSON.parse(readFileSync(`${ROOT}/data/report-sessions.json`, 'utf8'));
    const sessionIds = cfg.sessions.map(s => s.id);
    const drift = [];
    for (const rel of cfg.criticalFiles) {
      let src = '';
      try { src = readFileSync(`${ROOT}/${rel}`, 'utf8'); } catch { drift.push(`${rel}(읽기실패)`); continue; }
      const missing = sessionIds.filter(id => !new RegExp(`['"\`]${id}['"\`]|\\b${id}\\b`).test(src));
      if (missing.length) drift.push(`${rel.split('/').pop()}(누락: ${missing.join(',')})`);
    }
    if (drift.length) issues.push(`[J] 세션 enum drift — ${sessionIds.length}슬롯 미반영 파일: ${drift.join(' · ')}`);
    else info.push(`[J] 세션 enum 정합 — ${sessionIds.length}슬롯(${sessionIds.join('/')}) critical ${cfg.criticalFiles.length}파일 모두 반영`);
  } catch (e) { info.push(`[J] 세션 drift 점검 불가: ${String(e.message || e).slice(0, 50)}`); }

  const ts = new Date().toISOString().slice(0, 19);
  console.log(`\n[data-quality ${ts}]`);
  for (const i of info) console.log('  ✅', i);
  for (const i of issues) console.log('  🚨', i);
  console.log(issues.length === 0 ? '  → 종합: OK (데이터 품질 정상)' : `  → 종합: ${issues.length} 데이터 품질 결함`);
  process.exit(issues.length > 0 ? 1 : 0);
}
main();
