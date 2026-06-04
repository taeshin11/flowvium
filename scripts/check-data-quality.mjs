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
    const files = readdirSync(dir).filter(f => /^report-\d{4}-\d{2}-\d{2}-(morning|afternoon|evening)-[a-z-]+\.json$/.test(f)).sort();
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

  const ts = new Date().toISOString().slice(0, 19);
  console.log(`\n[data-quality ${ts}]`);
  for (const i of info) console.log('  ✅', i);
  for (const i of issues) console.log('  🚨', i);
  console.log(issues.length === 0 ? '  → 종합: OK (데이터 품질 정상)' : `  → 종합: ${issues.length} 데이터 품질 결함`);
  process.exit(issues.length > 0 ? 1 : 0);
}
main();
