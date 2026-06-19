// src/lib/buy-sell-engine.mjs — 매수/매도 룰 평가기 *단일 소스* (2026-06-19 통합).
//
// 챗(judge-engine.ts fireRules)과 보고서(generate-report-local.mjs)가 매수/매도엔진을 별도 구현해 drift —
//   룰셋·점수·거래량 유무가 달라 같은 종목에 다른 신호. 사용자 "보고서 엔진이 더 정확하니 그쪽으로 통합".
//   보고서 자동튜닝 룰(data/buy|sell-rules-tuned.json) + 이 평가기를 양쪽이 공유(accumulation-detector.mjs 패턴).
//   순수 함수(ctx+rule 만 참조). 데이터 없는 필드의 룰은 자동 skip(graceful) — 챗은 가진 데이터 룰만 발화.

export function evaluateBuyRule(rule, ctx) {
  const c = rule.condition;
  switch (c.type) {
    // 가격
    case 'priceGapDown':
      if (ctx.change1d != null && ctx.change1d <= (c.change1d_lte ?? -3)) return `1d ${ctx.change1d}% drop`;
      break;
    case 'near52wLow':
      if (ctx.low52w && ctx.price &&
          (ctx.price - ctx.low52w) / ctx.low52w * 100 <= (c.above_pct_lte ?? 5)) {
        return `52w 저점 ${(((ctx.price / ctx.low52w) - 1) * 100).toFixed(1)}% 위 (지지 반등)`;
      }
      break;
    case 'near50MA':
      if (ctx.sma50 && ctx.price &&
          Math.abs(ctx.price - ctx.sma50) / ctx.sma50 * 100 <= (c.deviation_pct_lte ?? 2)) {
        return `50MA pullback (${(((ctx.price / ctx.sma50) - 1) * 100).toFixed(1)}%)`;
      }
      break;
    case 'below200MA':
      if (ctx.sma200 && ctx.price && ctx.price < ctx.sma200 &&
          (ctx.sma200 - ctx.price) / ctx.sma200 * 100 >= (c.below_pct_gte ?? 5)) {
        return `200MA ${(((ctx.price / ctx.sma200) - 1) * 100).toFixed(1)}% (mean reversion)`;
      }
      break;
    case 'above20dHigh':
      if (ctx.high20d && ctx.price && ctx.price > ctx.high20d) return `20d 신고가 돌파 (${ctx.high20d.toFixed(2)})`;
      break;
    // 회전
    case 'sectorRotateIn':
      if (ctx.sectorStance === (c.stance ?? 'overweight') &&
          ctx.peRatio && ctx.sectorPe &&
          (ctx.sectorPe - ctx.peRatio) / ctx.sectorPe * 100 >= (c.pe_discount_pct_gte ?? 10)) {
        return `sector overweight + P/E ${((1 - ctx.peRatio / ctx.sectorPe) * 100).toFixed(0)}% 할인`;
      }
      break;
    case 'defensiveRotation':
      if (ctx.macroRiskLevel === (c.risk_level ?? 'high') &&
          Array.isArray(c.sectors) && c.sectors.some(s => ctx.sector?.toLowerCase()?.includes(s.toLowerCase()))) {
        return `defensive sector (${ctx.sector}) + macro risk=high`;
      }
      break;
    case 'newHighAfterFlat':
      if (ctx.consolidationWeeks != null && ctx.high20d && ctx.price &&
          ctx.consolidationWeeks >= (c.consolidation_weeks_gte ?? 4) && ctx.price > ctx.high20d) {
        return `${ctx.consolidationWeeks}주 횡보 후 신고가 돌파 (Stage 2 advance)`;
      }
      break;
    // 기술
    case 'rsiOversold':
      if (ctx.rsi != null && ctx.rsi <= (c.rsi_lte ?? 35)) return `RSI ${ctx.rsi} 과매도`;
      break;
    case 'goldenCross':
      // 2026-06-13: deadCross 와 대칭 — 최소 1% 갭 (flat MA 노이즈 제외)
      if (ctx.sma50 && ctx.sma200 && ctx.sma50 > ctx.sma200 * 1.01) return `50MA > 200MA golden cross`;
      break;
    case 'ma200Reclaim':
      if (ctx.sma200 && ctx.price > ctx.sma200 &&
          (ctx.price - ctx.sma200) / ctx.sma200 * 100 <= (c.above_pct_lte ?? 5)) {
        return `200MA reclaim (${(((ctx.price / ctx.sma200) - 1) * 100).toFixed(1)}% 위)`;
      }
      break;
    case 'volumeSurge':
      if (ctx.volPct != null && ctx.change1d != null &&
          ctx.volPct >= (c.vol_pct_gte ?? 50) && ctx.change1d >= (c.price_up_gte ?? 2)) {
        return `volume +${ctx.volPct}% & 1d +${ctx.change1d}% accumulation`;
      }
      break;
    // 기본
    case 'roeAbove':
      if (ctx.roe != null && ctx.roe >= (c.roe_pct_gte ?? 15)) return `ROE ${ctx.roe.toFixed(1)}%`;
      break;
    case 'opMarginExpand':
      if (ctx.opMarginExpand != null && ctx.opMarginExpand >= (c.expand_pp_gte ?? 2)) {
        return `op margin YoY +${ctx.opMarginExpand.toFixed(1)}%p`;
      }
      break;
    case 'peBelowSector':
      if (ctx.peRatio && ctx.sectorPe && ctx.peRatio / ctx.sectorPe <= 1 - (c.discount_pct_gte ?? 20) / 100) {
        return `P/E ${ctx.peRatio.toFixed(1)} vs sector ${ctx.sectorPe.toFixed(1)} 저평가`;
      }
      break;
    case 'revenueYoY':
      if (ctx.revenueGrowth != null && ctx.revenueGrowth >= (c.growth_pct_gte ?? 15)) {
        return `revenue YoY +${ctx.revenueGrowth.toFixed(1)}%`;
      }
      break;
    // 구루
    case 'lynchPeg':
      if (ctx.peg != null && ctx.peg > 0 && ctx.peg <= (c.peg_lte ?? 1.0)) {
        return `Lynch PEG ${ctx.peg.toFixed(2)} 성장대비 저평가`;
      }
      break;
    case 'buffettMoat':
      if (ctx.roe != null && ctx.opMargin != null &&
          ctx.roe >= (c.roe_pct_gte ?? 15) && ctx.opMargin >= (c.op_margin_pct_gte ?? 20)) {
        return `Buffett moat (ROE ${ctx.roe.toFixed(0)}% + opMgn ${ctx.opMargin.toFixed(0)}%)`;
      }
      break;
    case 'greenblattMagic':
      if (ctx.earningsYield != null && ctx.roic != null &&
          ctx.earningsYield >= (c.earnings_yield_gte ?? 10) && ctx.roic >= (c.roic_pct_gte ?? 25)) {
        return `Greenblatt magic (EY ${ctx.earningsYield.toFixed(1)}% + ROIC ${ctx.roic.toFixed(0)}%)`;
      }
      break;
    case 'grahamValue':
      if (ctx.peRatio && ctx.pbRatio &&
          ctx.peRatio <= (c.pe_lte ?? 15) && ctx.pbRatio <= (c.pb_lte ?? 1.5)) {
        return `Graham deep value (P/E ${ctx.peRatio.toFixed(1)} P/B ${ctx.pbRatio.toFixed(2)})`;
      }
      break;
    // 거시
    case 'macroRisk':
      if (ctx.macroRiskLevel === (c.risk_level ?? 'low')) return `macro risk=${ctx.macroRiskLevel} (risk-on)`;
      break;
    case 'vixLow':
      if (ctx.vix != null && ctx.vix <= (c.vix_lte ?? 14)) return `VIX ${ctx.vix.toFixed(1)} 안정`;
      break;
    case 'fgRecovery':
      if (ctx.fgScore != null && ctx.fgScore >= (c.fg_gte ?? 25) && ctx.fgScore <= (c.fg_lte ?? 50)) {
        return `F&G ${ctx.fgScore} 회복기`;
      }
      break;
    // 미시
    case 'sectorStance':
      if (ctx.sectorStance === (c.stance ?? 'overweight')) return `sector overweight`;
      break;
    case 'regionStance':
      if (ctx.regionStance === (c.stance ?? 'bullish')) return `region bullish`;
      break;
    case 'newsPositive':
      if (ctx.newsPosRatio != null && ctx.newsPosRatio >= (c.pos_ratio_gte ?? 0.6) &&
          ctx.newsArticleCount >= (c.min_articles ?? 3)) {
        return `news +${(ctx.newsPosRatio * 100).toFixed(0)}% (${ctx.newsArticleCount}건)`;
      }
      break;
    case 'near52wHigh':
      // 2026-06-12 (한미반도체 미포착 사건): 시장중립 모멘텀 — 52주 고가 3% 이내 = 추세 주도주.
      //   stage-1 평가 가능(livePrices 52w 데이터) → KR 모멘텀주도 stage-2 기술룰 진입 기회 확보.
      if (ctx.high52w && ctx.price && ctx.price >= ctx.high52w * (1 - (c.within_pct ?? 3) / 100)) {
        return `52주 신고가 ${(((ctx.high52w / ctx.price) - 1) * 100).toFixed(1)}% 이내 (추세 주도)`;
      }
      break;
    case 'newsGap':
      // 2026-06-12: /api/news-gap (기관 IB활동 高 + 미디어 저커버 = 정보 갭) — 사용자 "뉴스갭
      //   종목 매수엔진 반영". gapScore 는 결정론 산출(ibActivityScore-mediaScore 계열).
      if (ctx.newsGapScore != null && ctx.newsGapScore >= (c.gap_score_gte ?? 60)) {
        return `news-gap ${ctx.newsGapScore} (기관활동 高·미디어 저커버)`;
      }
      break;
    case 'optionsCallFlow': {
      // 2026-06-13: UOA call 편중 (Yahoo 체인 vol/OI 파생) — 콜 프리미엄 절대량 + 콜 비중
      const tot = (ctx.optionsCallPrem ?? 0) + (ctx.optionsPutPrem ?? 0);
      if (tot >= (c.total_prem_gte ?? 2e6) && (ctx.optionsCallPrem ?? 0) / tot >= (c.call_share_gte ?? 0.7)) {
        return `옵션 콜 편중 $${((ctx.optionsCallPrem) / 1e6).toFixed(1)}M (${Math.round((ctx.optionsCallPrem / tot) * 100)}%)`;
      }
      break;
    }
    case 'volumeBurst':
      // 2026-06-13: 5분봉 거래량 버스트(상방) — 기관성 매집 의심 proxy
      if ((ctx.burstUpNotional ?? 0) >= (c.notional_gte ?? 5e7)) {
        return `거래량 버스트 $${(ctx.burstUpNotional / 1e6).toFixed(0)}M (상방)`;
      }
      break;
    case 'backlogGrowth':
      // 2026-06-13: 수주잔고(RPO) 증가 — 향후 매출 가시성 (방산·건설·제조·SaaS). YoY 임계.
      if (ctx.backlogYoYPct != null && ctx.backlogYoYPct >= (c.yoy_pct_gte ?? 10)) {
        return `수주잔고 YoY +${ctx.backlogYoYPct}% (향후 매출 가시성↑)`;
      }
      break;
    case 'supplyContractWin': {
      // 2026-06-13: 신규 공급·수주 계약 — *영향도*(연매출 대비 %)가 핵심 (사용자 "계약 자체보다
      //   어떤 영향인지"). 매출대비 ≥ 임계(기본 5%) 일 때만 발화 — 거대기업의 소액계약 노이즈 차단.
      const cw = ctx.contractWin;
      if (!cw) break;
      const rev = cw.revenuePct;
      // 매출대비 추출됐으면 임계로 판정; 미추출이면 conviction fallback(보수적, 약신호)
      if (rev != null) {
        if (rev < (c.revenue_pct_gte ?? 5)) break;  // 영향 미미 → 미발화
        const a = cw.amountWon;
        const amt = a ? ` ${a >= 1e12 ? (a / 1e12).toFixed(1) + '조' : Math.round(a / 1e8) + '억'}원` : '';
        return `신규 공급계약${amt} — 연매출 대비 ${rev}% (${rev >= 30 ? '전환적' : rev >= 10 ? '유의미' : '보강'} 매출 기여)`;
      }
      if ((cw.conviction ?? 0) >= (c.conviction_gte ?? 82)) return `신규 공급·수주 계약 체결 (매출 기여, 규모 미공개)`;
      break;
    }
    case 'insiderBuy':
      if (ctx.insiderFilings != null && ctx.insiderFilings >= (c.filings_gte ?? 3)) {
        return `insider ${ctx.insiderFilings}건 매수`;
      }
      break;
    case 'squeezeScore':
      if (ctx.squeezeScore != null && ctx.squeezeScore >= (c.score_gte ?? 50)) {
        return `squeeze ${ctx.squeezeScore}`;
      }
      break;
    case 'cascadeUpstream':
      if (ctx.cascadeUpstream === true) return `cascade upstream beneficiary`;
      break;
    case 'boostList':
      if (ctx.boostListMember === true) return `boost-list (과거 avg_pnl ≥ 5%)`;
      break;
    case 'banList':
      if (ctx.banListMember === true) return `BAN: 2+ stops/0 hits`;
      break;
  }
  return null;
}

export function evaluateSellRule(rule, ctx) {
  const c = rule.condition;
  switch (c.type) {
    // 2026-06-13: 공급·수주 계약 해지/취소 (DART KR / SEC US) — 매출 감소 신호
    case 'supplyContractLoss':
      if (ctx.contractLoss && (ctx.contractLoss.conviction ?? 0) >= (c.conviction_gte ?? 70)) {
        return '공급·수주 계약 해지·취소 (매출 감소 신호)';
      }
      break;
    // 2026-06-13: UOA put 편중 (보유 종목에 풋 프리미엄 집중 = 하방 베팅 증가)
    case 'optionsPutFlow': {
      const tot = (ctx.optionsCallPrem ?? 0) + (ctx.optionsPutPrem ?? 0);
      if (tot >= (c.total_prem_gte ?? 2e6) && (ctx.optionsPutPrem ?? 0) / tot >= (c.put_share_gte ?? 0.7)) {
        return `옵션 풋 편중 $${((ctx.optionsPutPrem) / 1e6).toFixed(1)}M (${Math.round((ctx.optionsPutPrem / tot) * 100)}%)`;
      }
      break;
    }
    // ── 가격 ──────────────────────────────────────────────────────────────────
    case 'stopBreach':
      if (ctx.stop && ctx.price < ctx.stop * (c.ratio_lt ?? 1.0)) {
        return `stop 하향 돌파 (${ctx.price.toFixed(2)} < ${ctx.stop})`;
      }
      break;
    case 'stopProximity':
      if (ctx.stop && ctx.price / ctx.stop <= (c.ratio_lte ?? 1.05) && ctx.price >= ctx.stop) {
        return `stop 근접 (${(((ctx.price / ctx.stop) - 1) * 100).toFixed(1)}% 위)`;
      }
      break;
    case 'targetProximity':
      if (ctx.target && ctx.price / ctx.target >= (c.ratio_gte ?? 0.9)) {
        return `target ${((ctx.price / ctx.target) * 100).toFixed(0)}% 도달`;
      }
      break;
    case 'heldWithPnl':
      if (ctx.heldDays >= (c.min_days ?? 14) && ctx.pnl != null) {
        if (c.pnl_gte != null && ctx.pnl >= c.pnl_gte) return `보유 ${Math.round(ctx.heldDays)}일 +${ctx.pnl.toFixed(1)}% 익절`;
        if (c.pnl_lte != null && ctx.pnl <= c.pnl_lte) return `보유 ${Math.round(ctx.heldDays)}일 ${ctx.pnl.toFixed(1)}% 손절`;
      }
      break;
    case 'heldOnly':
      if (ctx.heldDays >= (c.min_days ?? 14)) return `보유 ${Math.round(ctx.heldDays)}일 회전`;
      break;
    // ── 기술적 ────────────────────────────────────────────────────────────────
    case 'deadCross':
      // 2026-06-13 fix: 최소 갭 요건 — 50MA 가 200MA 보다 *1% 이상* 아래일 때만 dead cross.
      //   기존엔 0.008% 차이(50MA 1,022,573 vs 200MA 1,022,661, 사실상 동일=추세 평탄)도 dead cross
      //   판정 → 경합심사가 KR 후보 전원 spurious 탈락(noon 보고서 KR 0 사건). flat MA = 노이즈, 추세 아님.
      if (ctx.sma50 && ctx.sma200 && ctx.sma50 < ctx.sma200 * 0.99) {
        return `50MA(${ctx.sma50.toFixed(2)}) < 200MA(${ctx.sma200.toFixed(2)}) dead cross (${((ctx.sma50 / ctx.sma200 - 1) * 100).toFixed(1)}%)`;
      }
      break;
    case 'ma200Breach':
      if (ctx.sma200 && ctx.price < ctx.sma200) {
        return `현재 ${ctx.price.toFixed(2)} < 200MA ${ctx.sma200.toFixed(2)}`;
      }
      break;
    case 'rsiOverbought':
      if (ctx.rsi != null && ctx.rsi >= (c.rsi_gte ?? 75)) return `RSI ${ctx.rsi} 과매수`;
      break;
    case 'volumeDrop':
      if (ctx.volPct != null && ctx.change1d != null &&
          ctx.volPct <= (c.vol_pct_lte ?? -30) && ctx.change1d <= (c.price_drop_pct_lte ?? -3)) {
        return `volume ${ctx.volPct}% & 1d ${ctx.change1d}% distribution`;
      }
      break;
    // ── 기본적 ────────────────────────────────────────────────────────────────
    case 'opMarginDecline':
      if (ctx.opMarginDecline != null && ctx.opMarginDecline >= (c.decline_pp_gte ?? 2)) {
        // 2026-06-06 consensus 개선: 매출 hyper-growth(+25%↑) + 마진 완만하락(-5%p 미만)은 재투자/
        //   램프 효과지 moat 약화 아님. NVDA(+65% rev, -2%p margin=Blackwell 램프)가 hard-veto(7)
        //   되어 매수 탈락하던 사건. 심한 하락(-5%p↑)은 성장중에도 fire(진짜 수익성 붕괴).
        if (ctx.revenueYoY != null && ctx.revenueYoY >= 25 && ctx.opMarginDecline < 5) return null;
        return `op margin YoY -${ctx.opMarginDecline.toFixed(1)}%p 악화`;
      }
      break;
    case 'peVsSector':
      if (ctx.peRatio && ctx.sectorPe && ctx.peRatio / ctx.sectorPe >= 1 + (c.premium_pct_gte ?? 30) / 100) {
        return `P/E ${ctx.peRatio.toFixed(1)} vs sector ${ctx.sectorPe.toFixed(1)} 고평가`;
      }
      break;
    // 2026-06-06: 내부자 매도 (매수룰 micro_insider_buying 대칭) — Form4 매도 cluster.
    case 'insiderSell':
      if (ctx.insiderSells != null && ctx.insiderSells >= (c.sell_count_gte ?? 2) &&
          (ctx.insiderSellToBuyRatio ?? 99) >= (c.sell_to_buy_ratio_gte ?? 2)) {
        return `내부자 매도 ${ctx.insiderSells}건 (매수 ${ctx.insiderBuys ?? 0}건 대비 우위)`;
      }
      break;
    // 2026-06-06: 13F 기관 이탈 (분기 수급 — 느린 신호).
    case 'institutionalExit':
      if (ctx.instReducers != null && (ctx.instReducers - (ctx.instAdders ?? 0)) >= (c.net_reducers_gte ?? 3) && (ctx.instNetShares ?? 0) < 0) {
        return `13F 기관 순감소 (reducers ${ctx.instReducers} vs adders ${ctx.instAdders ?? 0}, 순주식 ${Math.round((ctx.instNetShares ?? 0) / 1e6)}M)`;
      }
      break;
    // ── 구루 ──────────────────────────────────────────────────────────────────
    case 'lynchPeg':
      if (ctx.peg != null && ctx.peg >= (c.peg_gte ?? 2)) return `Lynch PEG ${ctx.peg.toFixed(1)} 성장대비 고평가`;
      break;
    // ── 거시 ──────────────────────────────────────────────────────────────────
    case 'macroRisk':
      if (ctx.macroRiskLevel === (c.risk_level ?? 'high')) return `macro risk=${ctx.macroRiskLevel} (defensive 회전)`;
      break;
    case 'vixSpike':
      if (ctx.vix != null && ctx.vix >= (c.vix_gte ?? 25)) return `VIX ${ctx.vix.toFixed(1)} 변동성 급등`;
      break;
    case 'fgExtreme':
      if (ctx.fgScore != null && ctx.fgScore <= (c.fg_lte ?? 20)) return `F&G ${ctx.fgScore} extreme fear`;
      break;
    // ── 미시 (sector / region / news) ────────────────────────────────────────
    case 'sectorStance':
      if (ctx.sectorStance === (c.stance ?? 'underweight')) return `sector ${ctx.sector ?? ''} stance=${ctx.sectorStance}`;
      break;
    case 'regionStance':
      if (ctx.regionStance === (c.stance ?? 'bearish')) return `region ${ctx.market ?? ''} stance=${ctx.regionStance}`;
      break;
    case 'newsNegative':
      if (ctx.newsNegRatio != null && ctx.newsNegRatio >= (c.neg_ratio_gte ?? 0.6) &&
          ctx.newsArticleCount >= (c.min_articles ?? 3)) {
        return `최근 7d news ${(ctx.newsNegRatio * 100).toFixed(0)}% 부정 (${ctx.newsArticleCount}건)`;
      }
      break;
  }
  return null;
}

import { readFileSync as _rf, existsSync as _ex } from 'node:fs';
import { resolve as _rs, dirname as _dn } from 'node:path';
import { fileURLToPath as _fu } from 'node:url';
// data/ 해석: ① process.cwd()(보고서 root 실행·Next root 실행 — 정상) ② 모듈 위치 기준 fallback(cwd 비정상 시).
//   cron-critical: cwd 가 root 아니면 0룰 → portfolio 붕괴. import.meta.url 은 Next 번들 시 .next/ 가리킬 수
//   있어 1순위 아님, cwd 실패 때만 fallback(2026-06-19 견고화).
function _readData(rel) {
  const cands = [_rs(process.cwd(), rel)];
  try { cands.push(_rs(_dn(_fu(import.meta.url)), '../..', rel)); } catch { /* */ }
  for (const p of cands) { try { if (_ex(p)) return _rf(p, 'utf8'); } catch { /* */ } }
  return null;
}
let _buyRules = null, _sellRules = null;
export function loadBuyRules() {
  if (_buyRules) return _buyRules;
  try { const t = _readData('data/buy-rules-tuned.json'); const j = t ? JSON.parse(t) : {}; _buyRules = j.rules || (Array.isArray(j) ? j : []); } catch { _buyRules = []; }
  return _buyRules;
}
export function loadSellRules() {
  if (_sellRules) return _sellRules;
  try { const t = _readData('data/sell-rules-tuned.json'); const j = t ? JSON.parse(t) : {}; _sellRules = j.rules || (Array.isArray(j) ? j : []); } catch { _sellRules = []; }
  return _sellRules;
}
export function scoreBuy(ctx, rules = loadBuyRules()) {
  const hits = [];
  for (const r of rules) { const reason = evaluateBuyRule(r, ctx); if (reason) hits.push({ id: r.id, score: r.score, desc: r.description || reason, category: r.category, reason }); }
  return { score: hits.reduce((a, h) => a + h.score, 0), hits };
}
export function scoreSell(ctx, rules = loadSellRules()) {
  const hits = [];
  for (const r of rules) { const reason = evaluateSellRule(r, ctx); if (reason) hits.push({ id: r.id, score: r.score, desc: r.description || reason, category: r.category, urgency: r.urgency, reason }); }
  return { score: hits.reduce((a, h) => a + h.score, 0), hits };
}
