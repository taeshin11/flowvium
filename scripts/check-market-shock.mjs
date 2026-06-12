#!/usr/bin/env node
/**
 * scripts/check-market-shock.mjs — 시장 쇼크 즉시 감지 (2026-06-12 신설).
 *
 * 배경(사용자): "트럼프 트윗·기사가 주가/심리에 영향 — 즉각즉각 고려돼야".
 *   보고서는 하루 5회 — 사이 시간대의 정책쇼크/급변에 무반응이던 갭을 메움.
 *   cron-runner 가 10분마다 실행 → 임계 초과 시 비정기 보고서 트리거(쿨다운+mutex 보호).
 *
 * 감지 채널 (전부 결정론 — LLM 무관):
 *   [A] 속보 임팩트: news-cascade 최근 기사 키워드 가중 스코어 (관세/Fed/전쟁/제재/정책발언).
 *       트윗 원문 실시간은 유료(X API) — 주요 발언은 수분 내 기사화되므로 RSS 가 무료 최선 프록시.
 *   [B] VIX 인트라데이: Yahoo ^VIX regularMarketPrice vs 전일 종가 (미국 장중용)
 *   [C] KOSPI/원화: ^KS11 당일 등락 + USD/KRW 급변 (한국 장중용)
 *
 * 출력: stdout JSON { shock: bool, score, signals[] } / exit 0 (감지 자체는 항상 성공)
 * 사용: node scripts/check-market-shock.mjs            (점검만)
 *       cron-runner 가 shock=true 시 run-report.bat 트리거
 */

const UA = { 'User-Agent': 'Mozilla/5.0' };
const PORT = process.env.PORT || 3000;

// 키워드 임팩트 사전 (가중치) — 정책/지정학/매크로 쇼크 어휘. 평이한 시황어는 제외(노이즈).
const SHOCK_KEYWORDS = [
  // 정책/정치 (트럼프 트윗류는 수분 내 기사화)
  { re: /tariff|관세/i, w: 3 },
  { re: /trump.{0,40}(announce|order|threat|impose|sign|say)|트럼프.{0,30}(발표|명령|위협|부과|서명)/i, w: 3 },
  { re: /executive order|행정명령/i, w: 2 },
  { re: /sanction|제재/i, w: 2 },
  // 연준/금리
  { re: /fed (cut|hike|emergency)|연준.{0,20}(인하|인상|긴급)|fomc.{0,30}(surprise|emergency)/i, w: 3 },
  { re: /powell.{0,40}(say|warn|signal)|파월.{0,30}(발언|경고)/i, w: 2 },
  // 지정학
  { re: /war|invasion|strike[s]? on|missile|전쟁|침공|미사일|공습/i, w: 3 },
  { re: /north korea|북한.{0,20}(발사|도발)/i, w: 2 },
  // 시장 구조
  { re: /circuit breaker|trading halt|서킷브레이커|거래중단/i, w: 4 },
  { re: /crash|plunge|급락|폭락/i, w: 2 },
  { re: /default|bankrupt|디폴트|파산/i, w: 2 },
  // 2026-06-13: KR 국내 정책 (사용자 "이재명 대출 조인다 같은 뉴스도 cascade 분석되나?" —
  //   종전엔 미국/지정학만 있어 국내 금융정책 속보가 쇼크 감지에서 누락되던 사각지대)
  { re: /대출.{0,12}(규제|조이|총량|제한|중단)|DSR|LTV.{0,10}(강화|하향)/i, w: 3 },
  { re: /한(국은행|은).{0,20}(인상|인하|긴급|동결깜짝)|기준금리.{0,15}(인상|인하)/i, w: 3 },
  { re: /부동산.{0,15}(대책|규제|안정화)|금융위.{0,20}(발표|대책)|금감원.{0,20}(조치|검사)/i, w: 2 },
  { re: /공매도.{0,12}(금지|재개|전면)|증시.{0,10}안정(기금|화)/i, w: 3 },
  { re: /(추경|추가경정).{0,15}(편성|발표)|재정.{0,10}긴축/i, w: 2 },
];

async function yahooQuote(sym) {
  for (const host of ['query1', 'query2']) {
    try {
      const j = await (await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`, { headers: UA, signal: AbortSignal.timeout(8000) })).json();
      const m = j?.chart?.result?.[0]?.meta;
      if (m?.regularMarketPrice != null && m?.chartPreviousClose != null) {
        return { price: m.regularMarketPrice, prevClose: m.chartPreviousClose, chgPct: (m.regularMarketPrice / m.chartPreviousClose - 1) * 100 };
      }
    } catch { /* 다음 host */ }
  }
  return null;
}

const signals = [];
let score = 0;
const add = (pts, msg) => { score += pts; signals.push(msg); };

// [A] 속보 키워드 임팩트 — 최근 90분 기사
try {
  const j = await (await fetch(`http://localhost:${PORT}/api/news-cascade`, { signal: AbortSignal.timeout(15000) })).json();
  const arts = (j?.articles ?? []).filter(a => {
    const t = new Date(a.pubDate ?? a.publishedAt ?? 0).getTime();
    return t > Date.now() - 90 * 60 * 1000;
  });
  let kwScore = 0; const hits = [];
  for (const a of arts) {
    const text = `${a.title ?? ''} ${a.summary ?? a.description ?? ''}`;
    for (const k of SHOCK_KEYWORDS) {
      if (k.re.test(text)) { kwScore += k.w; if (hits.length < 3) hits.push((a.title ?? '').slice(0, 60)); break; }
    }
  }
  if (kwScore >= 8) add(3, `속보 임팩트 ${kwScore} (최근 90분): ${hits.join(' / ')}`);
  else if (kwScore >= 5) add(2, `속보 경계 ${kwScore}: ${hits.join(' / ')}`);
} catch { signals.push('(news-cascade 미가용 — 키워드 채널 skip)'); }

// [B] VIX 인트라데이 급변 (미국 장중)
const vix = await yahooQuote('^VIX');
if (vix) {
  if (vix.chgPct >= 20) add(4, `VIX 인트라데이 +${vix.chgPct.toFixed(0)}% (${vix.prevClose.toFixed(1)}→${vix.price.toFixed(1)})`);
  else if (vix.chgPct >= 12) add(2, `VIX +${vix.chgPct.toFixed(0)}% 급등 중`);
}

// [C] KOSPI / 원화 (한국 장중)
const ks = await yahooQuote('^KS11');
if (ks && ks.chgPct <= -3) add(3, `KOSPI 당일 ${ks.chgPct.toFixed(1)}%`);
else if (ks && ks.chgPct <= -2) add(1, `KOSPI ${ks.chgPct.toFixed(1)}%`);
const krw = await yahooQuote('KRW=X');
if (krw && Math.abs(krw.chgPct) >= 1.5) add(2, `USD/KRW 당일 ${krw.chgPct > 0 ? '+' : ''}${krw.chgPct.toFixed(1)}% 급변`);

// 종합: score>=4 = shock (보고서 트리거 권고). 단일 약신호로는 미발동 — 과발간 방지.
const shock = score >= 4;
console.log(JSON.stringify({ shock, score, signals, asOf: new Date().toISOString() }));
