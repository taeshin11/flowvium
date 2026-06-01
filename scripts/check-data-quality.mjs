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

  // [B] 뉴스 번역 (ko)
  {
    const r = await getJson('/api/news-cascade?locale=ko');
    const arts = (r.body?.articles || r.body?.events || r.body?.items || []).slice(0, 6);
    if (arts.length === 0) info.push('[B] news-cascade 기사 0');
    else {
      const titles = arts.map(a => a.title || a.headline || '').filter(Boolean);
      const koCount = titles.filter(t => /[가-힣]/.test(t)).length;
      const pct = titles.length ? Math.round(koCount / titles.length * 100) : 0;
      if (pct < 50) issues.push(`[B] 뉴스 번역 미완 — ko 제목 ${koCount}/${titles.length} 한글 (${pct}%). 예: "${(titles.find(t => !/[가-힣]/.test(t)) || '').slice(0, 40)}"`);
      else info.push(`[B] 뉴스 번역 ko ${koCount}/${titles.length} (${pct}%)`);
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

  const ts = new Date().toISOString().slice(0, 19);
  console.log(`\n[data-quality ${ts}]`);
  for (const i of info) console.log('  ✅', i);
  for (const i of issues) console.log('  🚨', i);
  console.log(issues.length === 0 ? '  → 종합: OK (데이터 품질 정상)' : `  → 종합: ${issues.length} 데이터 품질 결함`);
  process.exit(issues.length > 0 ? 1 : 0);
}
main();
