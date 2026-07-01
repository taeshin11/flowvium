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

async function getJson(path, ms = 12000, retryOnConnFail = true) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal, headers: { 'User-Agent': 'flowvium-dq' } });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch { /* non-json */ }
    return { status: res.status, body, text };
  } catch (e) {
    // 2026-06-05: HTTP 0 = 연결레벨 실패(타임아웃/리셋) — 순간 부하 시 endpoint 마다 false 🚨 churn
    //   유발(yield-curve/economic-calendar 번갈아). 진짜 죽은 라우트는 4xx/5xx 반환하지 retry 도 실패.
    //   → 연결실패 1회 한정 재시도(긴 타임아웃). 실제 장애는 여전히 잡음.
    if (retryOnConnFail) {
      clearTimeout(t);
      await new Promise(r => setTimeout(r, 1500));
      return getJson(path, Math.max(ms, 20000), false);
    }
    return { status: 0, body: null, text: String(e?.message || e) };
  }
  finally { clearTimeout(t); }
}

// [A] 엔드포인트 헬스 — 핵심 endpoint 표본
const ENDPOINTS = [
  '/api/stock-price/AAPL', '/api/stock-price/005930.KS', '/api/price-history?ticker=005930.KS&days=30',
  '/api/company-financials/AAPL', '/api/company-financials/TSM', '/api/company-kr/005930',
  '/api/fear-greed', '/api/sector-pe', '/api/commodity-curve', '/api/news-cascade?locale=ko',
  '/api/yield-curve', '/api/economic-calendar',
  // 2026-06-17: KR 내부자 지분공시(DART) + US 작전주 매집(거래량) 신규 엔드포인트
  '/api/insider-kr/005930', '/api/insider-kr', '/api/accumulation-watch?market=us',
];

async function main() {
  // [A]
  let ok = 0;
  for (const ep of ENDPOINTS) {
    const r = await getJson(ep);
    // 2026-06-17 전수조사 C1: 빈 배열 [] 을 결함으로 보던 절 제거 — economic-calendar(한가한 날)·news 등
    //   정상 무데이터 상태를 상시 오탐(accumulation-watch/[I] 와 동일 클래스). 비-200/top-level error 는 유지.
    const errField = r.body && typeof r.body === 'object' && !Array.isArray(r.body) && r.body.error;
    if (r.status !== 200) issues.push(`[A] ${ep} → HTTP ${r.status}`);
    else if (errField) issues.push(`[A] ${ep} → 200 but body {error:"${r.body.error}"}`);
    else ok++;
  }
  info.push(`[A] 엔드포인트 ${ok}/${ENDPOINTS.length} 정상`);

  // [B] 뉴스 번역 — 2026-06-04: ko 만 보던 사각지대(ja/zh 영어 leak 미감지) → 다국어 검증.
  //   ko(한글) + ja(가나/한자) + zh-CN(한자). cron 401 로 다국어 warm 실패하던 것을 모니터가 잡도록.
  {
    const LOC = [{ l: 'ko', re: /[가-힣]/ }, { l: 'ja', re: /[\u3040-\u30FF\u4E00-\u9FFF]/ }, { l: 'zh-CN', re: /[\u4E00-\u9FFF]/ }];
    for (const { l, re } of LOC) {
      const r = await getJson(`/api/news-cascade?locale=${l}`);
      const arts = (r.body?.articles || r.body?.events || r.body?.items || []);
      if (arts.length === 0) { info.push(`[B] news-cascade ${l} 기사 0`); continue; }
      const titles = arts.map(a => a.title || a.headline || '').filter(Boolean);
      const ok = titles.filter(t => re.test(t)).length;
      const pct = titles.length ? Math.round(ok / titles.length * 100) : 0;
      // 2026-06-05: JP/CN 네이티브 피드 유지(사용자 결정) + 로컬 8B 가 CJK cross-translate·배치 번역을
      //   100% 못 하는 한계 인지. <50%=콜드캐시/파이프라인 결함(🚨, warm 필요) / 50-80%=8B 부분번역
      //   (인지됨 — 영어 base 보다 나음) / ≥80%=정상.
      if (pct < 50) issues.push(`[B] 뉴스 번역 ${l} ${ok}/${titles.length} (${pct}%) — 콜드캐시/파이프라인(warm 필요). 예: "${(titles.find(t => !re.test(t)) || '').slice(0, 35)}"`);
      else if (pct < 80) info.push(`[B] 뉴스 번역 ${l} ${ok}/${titles.length} (${pct}%) — 8B 부분번역(CJK 한계 인지됨)`);
      else info.push(`[B] 뉴스 번역 ${l} ${ok}/${titles.length} (${pct}%)`);
      // [B6] 2026-06-18: U+FFFD(�) 깨짐 검사 — vLLM AWQ 모델이 한국어 음절을 byte-fallback 으로 �로
      //   출력하던 사건(/report '주요 뉴스' 에 "스�페이스X" / "TD 유��" 라이브 노출, ko 만 ja/en 정상).
      //   번역 출력(title/summary)에 � 있으면 깨진 텍스트가 사용자에게 보이는 것 → 🚨. (재발방지 가드.)
      const fffd = arts.filter(a => /�/.test(a.title || a.headline || '') || /�/.test(a.summary || ''));
      if (fffd.length) issues.push(`[B6] 번역 깨짐(U+FFFD �) ${l} ${fffd.length}건 — byte-fallback 깨짐 라이브 노출. 예: "${(fffd[0].title || fffd[0].headline || fffd[0].summary || '').slice(0, 35)}"`);
      // [B5] 중국어 bleeding 하네스 (2026-06-07): qwen(중국계)이 ko 출력에 한자 누출. ko 제목에
      //   한자 2개+ 있으면 bleed. (ja 는 한자 정상이라 제외. zh 는 중국어 정상.)
      if (l === 'ko') {
        // 2026-06-13: bleed = *한글과 한자/가나가 혼재*하는 반쪽 번역만 (qwen 누출의 실형태).
        //   순수 외국어 원문(번역 실패 시 정직한 원문 유지)은 bleed 가 아니라 [B] 커버리지 소관 —
        //   나고야 기사(순수 일어)가 "qwen 누출"로 오분류되던 것 교정.
        const bleeds = titles.filter(t => /[가-힣]/.test(t) && ((t.match(/[\u4E00-\u9FFF]/g) || []).length >= 2 || /[ぁ-ヿ]/.test(t)));
        if (bleeds.length) issues.push(`[B5] 혼종 번역(bleed) ko ${bleeds.length}건 — 한글+한자/가나 혼재. 예: "${bleeds[0].slice(0, 30)}"`);
        else info.push('[B5] 혼종 번역 없음 (ko bleed 0)');
      }
    }
  }

  // [B2] 뉴스 국가 커버리지 (2026-06-05 신설) — 사용자 "각 국가 뉴스가 다 들어가나?".
  //   news-cascade 가 US 영어 피드만이던 사각지대 → KR/JP/CN 네이티브 피드 추가 + region 쿼터.
  //   article.source 로 region 판정: KR 소스 0건이면 KR 피드 끊김/쿼터 미작동 → 결함.
  {
    const r = await getJson('/api/news-cascade?locale=ko');
    const arts = (r.body?.articles || []);
    const srcs = arts.map(a => a.source || '');
    const krN = srcs.filter(s => /연합|한국경제|매일경제|매경|머니투데이/.test(s)).length;
    const jpN = srcs.filter(s => /Japan|日|Nikkei/i.test(s)).length;
    const cnN = srcs.filter(s => /SCMP|China|中/i.test(s)).length;
    if (arts.length === 0) {
      info.push('[B2] news-cascade 기사 0 — 커버리지 점검 불가');
    } else if (krN === 0) {
      issues.push(`[B2] 뉴스 KR 커버리지 0 — 연합/한경/매경 피드 끊김 또는 region 쿼터 미작동 (총 ${arts.length}건, jp=${jpN} cn=${cnN})`);
    } else {
      info.push(`[B2] 뉴스 국가 커버리지 KR=${krN} JP=${jpN} CN=${cnN} (총 ${arts.length})`);
    }
  }

  // [B3] 뉴스 신선도 (2026-06-06 신설) — 사용자 "주요뉴스가 왜 18h 전꺼야? 하네스에 안잡혀?".
  //   최신 기사 age 점검. 주말(시장 휴장)엔 뉴스 sparse → 임계 완화(평일 18h / 주말 48h). genuinely
  //   끊긴 피드(평일 18h+)는 잡되 주말 정상은 통과. age 를 info 로 항상 노출.
  {
    const r = await getJson('/api/news-cascade?locale=ko');
    const arts = (r.body?.articles || []);
    const times = arts.map(a => { const t = a.publishedAt || a.pubDate || a.date || a.isoDate; const ms = t ? Date.parse(t) : NaN; return Number.isFinite(ms) ? ms : null; }).filter(x => x != null);
    if (times.length) {
      const ageH = (Date.now() - Math.max(...times)) / 3600000;
      const weekend = [0, 6].includes(new Date().getUTCDay());
      const limit = weekend ? 48 : 18;
      if (ageH > limit) issues.push(`[B3] 뉴스 최신 ${ageH.toFixed(0)}h 전 (>${limit}h, ${weekend ? '주말' : '평일'}) — 피드 갱신 정지 의심`);
      else info.push(`[B3] 뉴스 신선도 OK (최신 ${ageH.toFixed(0)}h 전, ${weekend ? '주말' : '평일'} 임계 ${limit}h)`);
    } else info.push('[B3] 뉴스 timestamp 파싱 불가 — 신선도 점검 skip');
  }

  // [B4] RSS 피드 *소스* 건강도 (2026-06-06 신설) — "왜 사각지대?" 근본: 종전 검증은 "endpoint 200"
  //   만 봤지 외부 RSS 소스가 *살아있는지/신선한지* 안 봤음. WSJ RSS 가 200+유효XML 이지만 Jan 2025
  //   frozen, Reuters fetch fail 인데 못 잡았음(소스 decay 사각지대). → 각 피드 최신기사 age 직접 점검.
  try {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/api/news-cascade/route.ts', 'utf8');
    const m = src.match(/RSS_FEEDS[^=]*=\s*\[([\s\S]*?)\];/);
    const feeds = [...(m?.[1] || '').matchAll(/url:\s*['"]([^'"]+)['"][^}]*source:\s*['"]([^'"]+)/g)].map(x => ({ url: x[1], src: x[2] }));
    let dead = 0;
    const deadList = [];
    // 2026-06-15: "200 + 날짜X" 는 dead 가 아니라 rate-limit transient 일 때가 많음 — Yahoo 피드 4개를
    //   병렬 fetch 하면 동일 IP per-IP rate-limit 으로 그중 하나가 빈 응답을 줌(단건은 정상). dead 로
    //   단정하지 말고 날짜0 이면 sequential 1회 재시도(stagger). 진짜 dead 는 재시도도 0 → 그때만 flag.
    const datesOf = async (url) => {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return { http: r.status, ds: [] };
      const t = await r.text();
      const ds = [...t.matchAll(/<pubDate>([^<]+)<\/pubDate>/g), ...t.matchAll(/<published>([^<]+)<\/published>/g)].map(x => Date.parse(x[1])).filter(Number.isFinite).sort((a, b) => b - a);
      return { http: 200, ds };
    };
    await Promise.all(feeds.map(async f => {
      try {
        let { http, ds } = await datesOf(f.url);
        if (http !== 200) { dead++; deadList.push(`${f.src}(HTTP${http})`); return; }
        if (!ds.length) {   // 날짜0 = rate-limit 의심 → sequential 재시도(빈 응답 transient 확인)
          await new Promise(r => setTimeout(r, 1500));
          ({ ds } = await datesOf(f.url));
        }
        const ageH = ds.length ? (Date.now() - ds[0]) / 3600000 : null;
        if (ageH == null || ageH > 168) { dead++; deadList.push(`${f.src}(${ageH == null ? '날짜X' : Math.round(ageH) + 'h'})`); }
      } catch { dead++; deadList.push(`${f.src}(fetch실패)`); }
    }));
    if (dead > 0) issues.push(`[B4] RSS 죽은/stale 피드 ${dead}/${feeds.length}: ${deadList.join(', ')} — 소스 교체 필요`);
    else info.push(`[B4] RSS 피드 ${feeds.length}개 전부 신선(≤7d)`);
  } catch (e) { info.push(`[B4] RSS 피드 점검 skip: ${String(e.message).slice(0, 40)}`); }

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
    const { readdirSync, readFileSync, statSync } = await import('fs');
    const dir = 'C:/Flowvium/reports';
    // 2026-06-12: "최신" 을 이름 sort 로 뽑던 버그 — 알파벳상 noon 이 항상 마지막이라 evening/afternoon
    //   발간 후에도 noon 을 검사 ([D] supplyChain KR 이 fix 후에도 stale 하게 재발하던 원인). mtime 기준.
    const files = readdirSync(dir).filter(f => /^report-\d{4}-\d{2}-\d{2}-(midnight|morning|noon|afternoon|evening)-[a-z-]+\.json$/.test(f));
    const latest = files.map(f => ({ f, m: statSync(`${dir}/${f}`).mtimeMs })).sort((a, b) => b.m - a.m)[0]?.f;
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

  // [G0b] 13F 기관 지분율 무결성 (2026-06-13 신설 — "AAPL Berkshire 13행/지분 0%" 사건). root cause:
  //   pctOfShares 가 placeholder 0 으로 *적재 후 표시단에서 채워지지 않던* 안티패턴 + CUSIP 미합산
  //   중복행 + v7 crumb 누락. 검출: 같은 기관 중복행 / pctOfShares 전부 0 / 합 비현실(>100%).
  try {
    const r = await getJson('/api/stock-supply?ticker=AAPL', 30000);
    const o = r.body?.ownership13F ?? [];
    if (o.length === 0) {
      info.push('[G0b] 13F 지분율: AAPL 데이터 없음 (라이브 미적재 — cron 점검)');
    } else {
      const insts = o.map(x => x.institution);
      const dup = insts.length - new Set(insts).size;
      const pctSum = o.reduce((s, x) => s + (x.pctOfShares ?? 0), 0);
      const allZero = o.every(x => !x.pctOfShares);
      if (dup > 0) issues.push(`[G0b] 13F 같은 기관 중복행 ${dup}건 (CUSIP/기관 미합산 회귀)`);
      else if (allZero) issues.push('[G0b] 13F pctOfShares 전부 0 (sharesOutstanding 누락/placeholder 회귀)');
      else if (pctSum > 100) issues.push(`[G0b] 13F 지분율 합 ${pctSum.toFixed(0)}% (비현실 — 발행주식수 오류)`);
      else info.push(`[G0b] 13F 지분율 무결 OK (AAPL ${o.length}기관, 합 ${pctSum.toFixed(1)}%)`);
    }
  } catch (e) { info.push(`[G0b] 13F 지분율 점검 불가: ${String(e.message || e).slice(0, 40)}`); }

  // [G0] 히트맵 시총 진위 (2026-06-13 신설 — "가짜 시총" 사건): Wikipedia 폴백이 알파벳 proxy 시총을
  //     부여해 빅테크 탈락 + 타일 균일. 검출: ① NVDA/AAPL/MSFT 중 2+ 부재 ② 상위-하위 시총 격차 <15%
  //     (실제 S&P500 은 NVDA ~5T vs 200위 ~50B = 100배). 둘 다 "200 OK + 데이터 있음" 인데 가짜인 형태.
  {
    const hm = await getJson('/api/market-heatmap?country=US', 60000);
    const stocks = (hm.body?.sectors ?? []).flatMap(s => s.stocks ?? []);
    if (stocks.length >= 50) {
      const mega = ['NVDA', 'AAPL', 'MSFT'].filter(t => stocks.some(s => s.ticker === t)).length;
      const caps = stocks.map(s => s.marketCap).filter(Number.isFinite).sort((a, b) => b - a);
      const spread = caps.length > 10 ? (caps[0] - caps[caps.length - 1]) / caps[0] : 1;
      if (mega < 2) issues.push(`[G0] 히트맵 US 메가캡 부재 (NVDA/AAPL/MSFT 중 ${mega}개) — 구성종목 폴백 알파벳 잘림 의심`);
      else if (spread < 0.15) issues.push(`[G0] 히트맵 US 시총 균일(상하위 격차 ${(spread * 100).toFixed(0)}%) — proxy 가짜 시총 의심`);
      else info.push(`[G0] 히트맵 US 시총 진위 OK (메가캡 ${mega}/3, 격차 ${(spread * 100).toFixed(0)}%)`);
    }
  }

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
    const PAGES_DIR = 'C:/Flowvium/src/components/pages';
    const SELF = 'C:/Flowvium/scripts/check-data-quality.mjs';
    // 동적성/완전성 프로브가 불필요한 인프라/유틸 (존재만으로 충분하거나 사용자 비노출).
    const EXCLUDE = new Set(['admin', 'cron', 'ai', 'batch-prices', 'translate', 'osint', 'member']); // osint 는 [H] 가 하위경로로 커버; member 는 인증(데이터 소스 아님)
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
      'nport-holdings': '/api/nport-holdings?ticker=069500',
      'iv': '/api/iv/AAPL',
      'company-business': '/api/company-business/AAPL',  // 2026-06-07: [ticker] 동적 라우트 sample
      'company-signals': '/api/company-signals/NVDA',    // 2026-06-13: [ticker] 동적 — base path 는 404
      'manipulation-risk': '/api/manipulation-risk/NVDA', // 2026-06-13: [ticker] 동적 작전주 스코어
    };
    const SKIP = new Set(['company-desc', 'investment-strategy']);
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
      // 2026-06-13: 빈 배열 []는 dead 아님 — 리스트 엔드포인트(cascade-events 등)의 정상 '데이터 없음'
      //   상태. Object.keys([]).length===0 이 [] 를 'empty body' 로 오탐하던 것 차단(아래 weak 검사가
      //   !Array.isArray 로 이미 배열 면제). {} (빈 객체)만 dead.
      if (b == null || (typeof b === 'object' && !Array.isArray(b) && Object.keys(b).length === 0)) return { ep, dead: 'empty body' };
      if (b.error && !b.entries && !b.data) return { ep, dead: `error: ${String(b.error).slice(0, 30)}` };
      // configured===false = 유료 API 대기/미설정 (의도된 잠금, 결함 아님 — locked 로 분류).
      if (b.configured === false) return { ep, locked: true };
      // non-empty 데이터 흔적: 배열 길이 OR 스칼라 OR 구조 객체(market/outlook 등) 존재.
      const arrLen = ['entries', 'data', 'results', 'signals', 'movers', 'items', 'companies', 'holdings', 'alerts', 'events', 'trades', 'rows', 'curve', 'sectors']
        .reduce((n, k) => n + (Array.isArray(b[k]) ? b[k].length : 0), 0);
      const objKeys = ['market', 'outlook', 'capital', 'company', 'summary', 'consensus', 'byCountry', 'byAsset'];
      const hasObj = objKeys.some(k => b[k] != null && (typeof b[k] !== 'object' || Object.keys(b[k]).length > 0));
      // 2026-06-17: 스캐너/리스트 엔드포인트(accumulation-watch 등)는 신호 0건이 *정상*(작전주 무신호).
      //   source:'live' + asOf/scanned 메타가 있으면 '살아있는 스캔이 0건 반환' → alive (company-signals
      //   조용한 종목 케이스와 동일 원리). asOf(타임스탬프)·scanned(스캔수)를 liveness 마커로 인정.
      const hasScalar = b.score != null || b.value != null || b.probability != null || b.balance != null || b.total > 0 || typeof b.updatedAt === 'string' || typeof b.generatedAt === 'string' || typeof b.asOf === 'string' || typeof b.scanned === 'number';
      // company-signals: ticker별 시그널 — 조용한 종목은 uoa/burst/contract 전부 비어도 *정상*(잘못 아님).
      //   200 + 정상 shape(ticker echo + uoa 배열 키 존재)면 alive 로 인정 (empty≠dead).
      const hasSignalShape = typeof b.ticker === 'string' && 'uoa' in b && Array.isArray(b.uoa);
      if (hasSignalShape) return { ep, ok: true };
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
    const ROOT = 'C:/Flowvium';
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

  // [L] live/static 비율 — mixed-source 엔드포인트가 mostly-static 로 degrade 감지 (2026-06-04 신설).
  //   사용자가 macro 탭 "정적" 발견 — macro-indicators 11/13 static(staticAsOf 한달전). endpoint 가
  //   200·source 있어도 *대부분 stale static* 이면 사용자에겐 정적. liveCount/staticCount 보고하는
  //   엔드포인트의 static 우위를 flag. (FRED/외부소스 차단 시 조용히 static fallback 되던 사각지대.)
  {
    const checks = [
      { name: 'macro-indicators', path: '/api/macro-indicators', live: 'liveCount', stat: 'staticCount', asOf: 'staticAsOf' },
    ];
    for (const c of checks) {
      const r = await getJson(c.path, 20000);
      const live = r.body?.[c.live], stat = r.body?.[c.stat];
      if (typeof live === 'number' && typeof stat === 'number') {
        const total = live + stat;
        const pct = total ? Math.round((live / total) * 100) : 0;
        if (stat > live) issues.push(`[L] ${c.name} live ${live}/${total} (${pct}%) — 대부분 정적(${r.body?.[c.asOf] ?? '?'}), 외부소스 차단 의심`);
        else info.push(`[L] ${c.name} live ${live}/${total} (${pct}%)`);
      }
    }
  }

  // [L2] credit-balance 국가별 recoverable vs structural 분류 (2026-06-05 신설).
  //   "왜 최선의 방법(라이브 소스)을 시행 안 했나" 를 자동 포착 — 단순 ratio 가 아니라,
  //   *fetcher 가 있는데 silent 하게 static 반환*(recoverable=즉시 fix 대상) 과
  //   *무료 집계소스 부재*(structural=구조적 불가, 인지됨) 를 구분. 전자만 🚨, 후자는 ℹ️.
  //   EXPECTED_LIVE = 작동 의도된 fetcher 보유. 이 중 "(static est.)" 면 회귀/소스사멸 → 결함.
  {
    const EXPECTED_LIVE = { us: 'FRED', tw: 'TWSE', cn: 'Eastmoney' };
    // kr: KRX data.krx.co.kr 가 server-side 요청을 anti-scrape 로 차단(쿠키 동반해도 400 LOGOUT, 2026-06-05
    //   테스트 확인) + BOK ECOS 는 증권 신용거래융자 series 미보유 → live 구조적 차단. static-estimated 유지.
    const STRUCTURAL = { jp: 'JPX .xls 미파싱', in: 'NSE 차단', eu: 'ESMA 단일집계 미발행', kr: 'KRX anti-scrape(LOGOUT)+BOK 미보유' };
    const r = await getJson('/api/credit-balance', 20000);
    const countries = r.body?.countries;
    if (Array.isArray(countries)) {
      const isStatic = (c) => c.liveData === false || /static est\./i.test(c.source || '');
      const recoverableBroken = countries.filter(c => EXPECTED_LIVE[c.id] && isStatic(c)).map(c => c.id);
      const structuralStatic = countries.filter(c => STRUCTURAL[c.id] && isStatic(c)).map(c => c.id);
      const liveOk = countries.filter(c => EXPECTED_LIVE[c.id] && !isStatic(c)).map(c => c.id);
      if (recoverableBroken.length) {
        issues.push(`[L2] credit-balance recoverable-but-static: ${recoverableBroken.map(id => `${id}(${EXPECTED_LIVE[id]})`).join(', ')} — fetcher 있는데 라이브 실패, 즉시 fix 대상`);
      }
      info.push(`[L2] credit-balance live ${liveOk.join('/')||'없음'}; structural-static(인지됨) ${structuralStatic.map(id => `${id}(${STRUCTURAL[id]})`).join(', ') || '없음'}`);
    }
  }

  // [M] narratives intensity 라이브 검증 (2026-06-05 신설).
  //   narratives 탭은 8개 구조적 테마 정의(정적 정당) + 라이브 intensity overlay(관련 종목 모멘텀
  //   + 섹터 자금흐름). 헤더가 약속한 "AI-generated analysis" 동적 레이어가 미구현이던 사각지대를
  //   intensity 로 구현 → source=live + liveCount(8개 중 신호 수신) 검증. static 이면 시세소스 끊김.
  {
    const r = await getJson('/api/narratives', 20000);
    const src = r.body?.source, liveCount = r.body?.liveCount, total = (r.body?.intensities ?? []).length;
    if (src === 'live' && typeof liveCount === 'number') {
      if (liveCount < total) issues.push(`[M] narratives intensity ${liveCount}/${total} — 일부 테마 시세/섹터 신호 미수신`);
      else info.push(`[M] narratives intensity live ${liveCount}/${total} 테마`);
    } else if (src === 'static') {
      issues.push(`[M] narratives source=static — 시세(stooq)·섹터흐름 전부 실패, intensity 미산출 (정의만 렌더)`);
    } else {
      info.push(`[M] narratives 점검 불가 (응답 ${r.status})`);
    }
  }

  // [N] 엔드포인트 DB 커버리지 (2026-06-05) — 사용자 "모든 페이지/탭/엔드포인트가 업데이트마다 DB 저장돼야".
  //   route.ts 를 전수 열거 → TRACKED_ENDPOINTS(endpoint_snapshots 적재 목록)와 대조. 데이터 라우트인데
  //   미추적이면 ❌(DB 시계열 누락 사각지대). 미래 신규 엔드포인트도 자동 포착 = "왜 검토 안 됐나" 방지.
  //   제외: admin/cron(쓰기·대시보드)·유틸(ai/translate 등)·per-ticker([)·param 필수(ALLOW).
  {
    try {
      const { readdirSync } = await import('fs');
      const { fileURLToPath } = await import('url');
      const { TRACKED_ENDPOINTS } = await import('./lib/snapshot-endpoints.mjs');
      const apiDir = fileURLToPath(new URL('../src/app/api', import.meta.url));
      const routes = [];
      const walk = (dir, prefix) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(`${dir}/${e.name}`, `${prefix}/${e.name}`);
          else if (e.name === 'route.ts') routes.push(prefix || '/');
        }
      };
      walk(apiDir, '');
      const trackedSet = new Set(TRACKED_ENDPOINTS.map(e => e.replace(/^\/api/, '').split('?')[0]));
      // admin/cron(쓰기), 유틸, per-ticker([) 제외
      const EXCLUDE = /^\/(admin|cron)(\/|$)|^\/(ai|translate|collect|institutional-refresh|batch-prices|member)$|\[/;
      // param 필수(per-ticker 성격) 또는 시계열 불필요(list/history) — 의도적 미추적.
      //   /judge-chat·/judge-chat/share = 심판엔진 채팅 POST(per-user 대화·스냅샷) — 시계열 데이터 소스가 아니라
      //   endpoint_snapshots 추적 대상 아님(2026-06-19). 자체 검증로그(judge-chat:verify)+폐루프로 별도 추적.
      const ALLOW_UNTRACKED = new Set(['/company-news', '/stock-supply', '/osint/corporate', '/company-kr/list', '/investment-strategy/history', '/paper-trading', '/judge-chat', '/judge-chat/share']);
      const untracked = routes.filter(r => !EXCLUDE.test(r) && !trackedSet.has(r) && !ALLOW_UNTRACKED.has(r));
      if (untracked.length) {
        issues.push(`[N] DB 미추적 데이터 엔드포인트 ${untracked.length}개: ${untracked.join(', ')} — TRACKED_ENDPOINTS 추가 필요`);
      } else {
        info.push(`[N] 엔드포인트 DB 커버리지 OK — 데이터 라우트 전부 TRACKED (${trackedSet.size} tracked / route ${routes.length}개, util·per-ticker 제외)`);
      }
    } catch (e) { info.push(`[N] 커버리지 점검 불가: ${String(e.message || e).slice(0, 60)}`); }
  }

  // [O] 문서-코드 동기화 (2026-06-05) — 모니터가 런타임 데이터만 보고 *문서가 코드와 일치하는지* 는
  //   안 보던 메타-사각지대(FEATURES "ETF 193"/실제 30, "1,210 종목"/실제 1338). check-doc-sync 스폰.
  {
    try {
      const { execSync } = await import('child_process');
      const { fileURLToPath } = await import('url');
      const script = fileURLToPath(new URL('./check-doc-sync.mjs', import.meta.url));
      try {
        execSync(`node "${script}"`, { stdio: 'pipe' });
        info.push('[O] 문서-코드 동기화 OK (UNIVERSE_COUNT/ETF/언어 일치)');
      } catch (e) {
        const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
        const bad = out.split('\n').filter(l => l.includes('🚨')).map(l => l.replace(/.*🚨\s*/, '').trim());
        issues.push(`[O] 문서-코드 불일치: ${bad.join(' | ') || '상세는 check-doc-sync 실행'}`);
      }
    } catch (e) { info.push(`[O] doc-sync 점검 불가: ${String(e.message || e).slice(0, 50)}`); }
  }

  // [P] FX 동적 소스 (2026-06-05) — USD/KRW 가 KR 추천 risk 핵심인데 macro 에 없던 갭(오늘 KR 급락
  //   미감지 → Kia/POSCO 손실). Yahoo KRW=X 직접(외부 권위·하드코딩 아님) — 소스 alive 검증 +
  //   원화 ±1.5% 급변 시 KR-risk surface(보고서 FX 반영 확인용).
  {
    try {
      const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1d&range=5d', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      const m = (await r.json())?.chart?.result?.[0]?.meta;
      const px = m?.regularMarketPrice, prev = m?.chartPreviousClose;
      if (px == null) issues.push('[P] FX USD/KRW 소스 죽음 (Yahoo KRW=X null) — KR risk 미반영');
      else {
        const chg = prev ? (px - prev) / prev * 100 : 0;
        if (Math.abs(chg) >= 1.5) info.push(`[P] ⚠️ USD/KRW=${Math.round(px)} ${chg > 0 ? '+' : ''}${chg.toFixed(1)}% 급변 — KR 주식 ${chg > 0 ? '약세압력(원화급락)' : '우호(원화강세)'}. 보고서 FX 반영 확인`);
        else info.push(`[P] FX live USD/KRW=${Math.round(px)} (${chg > 0 ? '+' : ''}${chg.toFixed(1)}%)`);
      }
    } catch (e) { issues.push(`[P] FX 소스 점검 실패: ${String(e.message || e).slice(0, 40)}`); }
  }

  // [R] 동적 세그먼트 커버리지 — 전 종목(US 873) 동적 데이터 검토 (2026-06-07 "1300+ 다 동적검토").
  //   cron(2h/6) 이 DB company_segments 를 점진 확장. 모니터가 매 사이클 커버리지/신선도 surface.
  try {
    const { getSegmentCoverageStats } = await import('./lib/db.mjs');
    const { readFileSync: rfs } = await import('fs');
    const cand = JSON.parse(rfs('data/candidate-tickers.json', 'utf8')).tickers || [];
    const usN = cand.filter(t => !/\.(KS|KQ)$/.test(t)).length || 873;
    const st = getSegmentCoverageStats();
    const pct = Math.round(st.covered / usN * 100);
    if (st.covered === 0) issues.push('[R] 동적 세그먼트 0 — 추출 파이프라인 정지 의심(cron segments-refresh 확인)');
    else info.push(`[R] 동적 세그먼트 커버리지 ${st.covered}/${usN} (${pct}%) · stale>35d ${st.stale} · ${JSON.stringify(st.bySource)} · cron 매시6 확장중`);
  } catch (e) { info.push(`[R] 세그먼트 커버리지 점검 skip: ${String(e.message || e).slice(0, 40)}`); }

  const ts = new Date().toISOString().slice(0, 19);
  console.log(`\n[data-quality ${ts}]`);
  for (const i of info) console.log('  ✅', i);
  for (const i of issues) console.log('  🚨', i);
  console.log(issues.length === 0 ? '  → 종합: OK (데이터 품질 정상)' : `  → 종합: ${issues.length} 데이터 품질 결함`);
  process.exit(issues.length > 0 ? 1 : 0);
}
// 2026-06-17 전수조사 A2: main() 에 .catch 부재 — 중간 probe 가 throw 하면 process.exit(1) 우회 + 그때까지
//   🚨 없으면 cron-runner 가 'clean pass' 로 오기록(CLAUDE.md "main entry 는 반드시 process.exit(1)"). onFatal 추가.
main().catch((e) => { console.error('[data-quality FATAL]', e?.stack ?? e?.message ?? e); process.exit(1); });
