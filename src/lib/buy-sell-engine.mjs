// src/lib/buy-sell-engine.mjs — 매수/매도 룰 평가기 *단일 소스* (2026-06-19 통합).
//
// 챗(judge-engine.ts fireRules)과 보고서(generate-report-local.mjs)가 매수/매도엔진을 별도 구현해 drift —
//   룰셋·점수·거래량 유무가 달라 같은 종목에 다른 신호. 사용자 "보고서 엔진이 더 정확하니 그쪽으로 통합".
//   보고서 자동튜닝 룰(data/buy|sell-rules-tuned.json) + 이 평가기를 양쪽이 공유(accumulation-detector.mjs 패턴).
//   순수 함수(ctx+rule 만 참조). 데이터 없는 필드의 룰은 자동 skip(graceful) — 챗은 가진 데이터 룰만 발화.

// 2026-06-19(ChatGPT #8): forensic 룰 sector-aware 가드 — 업종별로 정상인 지표를 오탐 않게.
const _isFinancial = (s) => !!s && /financ|bank|insur|reit|estate|보험|은행|금융|증권|지주/i.test(s);
const _isDistribution = (s) => !!s && /retail|distribut|trad|wholesale|consumer\s*staple|유통|소매|상사|도매/i.test(s);
const _isFinUtil = (s) => _isFinancial(s) || (!!s && /utilit|reit|estate|유틸|전력|가스|부동산/i.test(s));

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
    // 2026-06-19 guru 확장 — 가치 4룰(Buffett·Lynch·Greenblatt·Graham) 편중 보완. doctrine 로스터의 모멘텀·
    //   역발상·성장주도 거장을 정량 룰화(복합조건 = 거장 프레임 전체 충족 시만 발화, 고확신).
    case 'druckTrend':        // Druckenmiller/Tudor/Soros: 정배열 추세추종(유동성 모멘텀)
      if (ctx.price != null && ctx.sma50 != null && ctx.sma200 != null && ctx.high52w != null &&
          ctx.price > ctx.sma50 && ctx.sma50 > ctx.sma200 && ctx.price >= ctx.high52w * (1 - (c.within_pct ?? 12) / 100)) {
        return `정배열(현재>50MA>200MA)+52주고가 ${(((ctx.high52w / ctx.price) - 1) * 100).toFixed(1)}% 이내 — Druckenmiller 추세추종`;
      }
      break;
    case 'marksCapitulation':  // Marks/Klarman: 극공포+저점근접+흑자 역발상 진입(안전마진)
      if (ctx.fgScore != null && ctx.low52w != null && ctx.price != null && ctx.roe != null &&
          ctx.fgScore <= (c.fg_lte ?? 25) && (ctx.price - ctx.low52w) / ctx.low52w * 100 <= (c.above_low_pct_lte ?? 15) && ctx.roe > 0) {
        return `극공포(F&G ${ctx.fgScore})+52주저점 ${(((ctx.price / ctx.low52w) - 1) * 100).toFixed(1)}% 위+흑자 — Marks/Klarman 역발상`;
      }
      break;
    case 'oneilCanslim':       // O'Neil CANSLIM: 신고가 돌파 + 고성장(성장 주도주)
      if (ctx.price != null && ctx.high52w != null && ctx.revenueGrowth != null &&
          ctx.price >= ctx.high52w * (1 - (c.within_pct ?? 5) / 100) && ctx.revenueGrowth >= (c.growth_pct_gte ?? 25)) {
        return `52주 신고가 ${(((ctx.high52w / ctx.price) - 1) * 100).toFixed(1)}% 이내 + 매출성장 ${ctx.revenueGrowth.toFixed(0)}% — O'Neil CANSLIM 성장주도`;
      }
      break;
    // forensic(이익의 질) — 2026-06-19 공유모듈로 이관(챗·보고서 공용, 데이터 없으면 skip).
    case 'cashConversionGood':
      if (ctx.ocf != null && ctx.netIncome != null && ctx.netIncome > 0 && ctx.ocf >= ctx.netIncome) return `이익의 질 양호(영업현금흐름≥순이익)`;
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
    // 2026-06-19 매도 대칭 보강(selflearn·guru 매도 갭): 매수쪽 ban penalty 의 매도 대칭 + 구루 매도 렌즈.
    case 'banListSell':                                   // selflearn: ban-list 보유 종목 → 청산(매수 banList 대칭)
      if (ctx.banListMember === true) return `BAN 보유(2+ stops/0 hits) — 청산 권고`;
      break;
    case 'marksEuphoria':                                 // guru(Marks): 극탐욕+과매수 도취 → 역발상 차익실현
      if (ctx.fgScore != null && ctx.rsi != null && ctx.fgScore >= (c.fg_gte ?? 78) && ctx.rsi >= (c.rsi_gte ?? 70)) {
        return `도취 국면(F&G ${ctx.fgScore} 극탐욕 + RSI ${ctx.rsi} 과매수) — Marks 역발상 차익실현`;
      }
      break;
    case 'druckTrendBreak':                               // guru(Druckenmiller): 50MA 이탈+모멘텀 약화 추세붕괴
      if (ctx.price != null && ctx.sma50 != null && ctx.price < ctx.sma50 && ctx.rsi != null && ctx.rsi < (c.rsi_lt ?? 45)) {
        return `50MA(${ctx.sma50.toFixed(2)}) 하향이탈 + RSI ${ctx.rsi} 모멘텀 약화 — Druckenmiller 추세붕괴`;
      }
      break;
    // forensic(이익의질·희석·되팔기·부채) — 2026-06-19 공유모듈 이관 + sector-aware(ChatGPT #8). 데이터 없으면 skip.
    case 'weakEarningsQuality':
      if (ctx.ocf != null && ctx.netIncome != null && ctx.netIncome > 0 && ctx.ocf >= 0 && ctx.ocf < ctx.netIncome * (c.ratio_lt ?? 0.85)) return `이익의 질 낮음(영업현금흐름<순이익)`;
      break;
    case 'negativeOcf':                                   // 비금융만 — 금융업 음수 OCF 는 사업특성
      if (ctx.ocf != null && ctx.ocf < 0 && !_isFinancial(ctx.sector)) return `영업현금흐름 적자(현금 미유입)`;
      break;
    case 'dilutionFinancing':                             // "외부자금 의존"(차입+증자 — 희석 단정 회피)
      if (ctx.financingCF != null && ctx.financingCF > 0 && ctx.ocf != null && ctx.financingCF > Math.max(0, ctx.ocf)) return `재무활동 외부자금 의존 증가(영업현금흐름 초과)`;
      break;
    case 'highResaleMix':                                 // 유통/상사 제외 — 되팔기가 정상사업
      if (ctx.resaleRatio != null && ctx.resaleRatio >= (c.ratio_gte ?? 0.4) && !_isDistribution(ctx.sector)) return `되팔기(상품매출) 비중 과다(제조사 기준)`;
      break;
    case 'overextended200ma':
      if (ctx.price != null && ctx.sma200 != null && ctx.sma200 > 0 && ctx.price > ctx.sma200 * (c.mult_gt ?? 1.6)) return `200일선 +${Math.round((ctx.price / ctx.sma200 - 1) * 100)}% 과대확장(되돌림 위험)`;
      break;
    case 'highDebt':                                      // 금융/유틸/REIT 제외 — 고부채가 사업구조
      if (ctx.debtRatio != null && ctx.debtRatio > (c.pct_gt ?? 150) && !_isFinUtil(ctx.sector)) return `부채비율 ${ctx.debtRatio}% 재무위험`;
      break;
  }
  return null;
}

import { readFileSync as _rf, existsSync as _ex, statSync as _st } from 'node:fs';
import { resolve as _rs, dirname as _dn } from 'node:path';
import { fileURLToPath as _fu } from 'node:url';
// data/ 해석: ① process.cwd()(보고서·Next root 실행 — 정상) ② 모듈 위치 fallback. cron-critical: cwd 가 root
//   아니면 0룰 → portfolio 붕괴. import.meta.url 은 Next 번들 시 .next/ 가리킬 수 있어 1순위 아님(2026-06-19).
function _resolveData(rel) {
  const cands = [_rs(process.cwd(), rel)];
  try { cands.push(_rs(_dn(_fu(import.meta.url)), '../..', rel)); } catch { /* */ }
  for (const p of cands) { try { if (_ex(p)) return p; } catch { /* */ } }
  return null;
}
// 2026-06-19(ChatGPT 지적): 룰 캐시 영구고정 → 주간 tuner 갱신 후 장기실행 Next worker 가 옛 룰 유지(drift 재발).
//   mtime 기반 hot-reload(30s 체크) + min-rule 검증(부분/빈 JSON 캐시 방지, 실패 시 *직전 good* 유지). Object.freeze.
const MIN_RULES = { buy: 30, sell: 18 };
const _state = { buy: { checkedAt: 0, mtimeMs: -1, rules: null }, sell: { checkedAt: 0, mtimeMs: -1, rules: null } };
function _loadRules(kind) {
  const s = _state[kind], now = Date.now();
  if (s.rules && now - s.checkedAt < 30_000) return s.rules;            // 30s 내 재확인 안 함
  s.checkedAt = now;
  try {
    const path = _resolveData(`data/${kind}-rules-tuned.json`);
    if (!path) throw new Error('path 없음');
    const mt = _st(path).mtimeMs;
    if (s.rules && mt === s.mtimeMs) return s.rules;                    // 파일 안 바뀜 → 캐시
    const j = JSON.parse(_rf(path, 'utf8'));
    const rules = j.rules || (Array.isArray(j) ? j : []);
    if (!Array.isArray(rules) || rules.length < MIN_RULES[kind]) throw new Error(`룰 수 부족 ${rules?.length ?? 0}<${MIN_RULES[kind]}`);
    for (const r of rules) if (!r.id || !r.condition?.type || !Number.isFinite(r.score)) throw new Error(`malformed: ${r?.id ?? '?'}`);
    s.rules = Object.freeze(rules); s.mtimeMs = mt;                     // 검증 통과분만 캐시
    return s.rules;
  } catch (e) {
    if (s.rules) return s.rules;                                        // 검증 실패 → 직전 good 유지(빈 []캐시 금지)
    try { const p = _resolveData(`data/${kind}-rules-tuned.json`); const j = JSON.parse(_rf(p, 'utf8')); return s.rules = Object.freeze(j.rules || j); } catch { return []; }
  }
}
export function loadBuyRules() { return _loadRules('buy'); }
export function loadSellRules() { return _loadRules('sell'); }
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

// 최종 심판(2026-06-19 통합) — buyScore vs sellScore + hard veto → 결정론 verdict. 챗·보고서 공유.
//   이전엔 챗이 최종 결론을 LLM 에 맡겨 점수와 어긋남("16 vs 3 인데 매도 우세"). 이제 코드가 단정, LLM 은 설명만.
//   hardSell = 치명 매도신호(데드크로스·200MA이탈·영업현금흐름 적자 등) → 점수 무관 매도 우선.
// 2026-06-19(ChatGPT 지적): tech_200ma_breach 제외 — price<200MA 단순 이탈(0.01%도)을 hard veto 하면
//   mean-reversion 매수룰(price_mean_reversion·Marks capitulation·52주저점 반등)과 정면충돌 + 정상변동 회피.
//   200MA 이탈은 *점수형 매도신호*(ma200Breach score)로 남기고, hard veto 는 데드크로스·OCF적자·손절이탈·계약해지만.
const HARD_SELL_IDS = new Set(['tech_dead_cross', 'price_stop_breach', 'forensic_negative_ocf', 'micro_supply_contract_loss']);
export function adjudicate(buyScore, sellScore, opts = {}) {
  const hardSell = opts.hardSell ?? false;
  const buyVeto = opts.buyVeto ?? null;  // 2026-06-23: hasHardBuyVeto() 사유(string) — 신규매수 차단(칼받기/과열).
  const coverage = opts.coverage;  // 종목별 데이터 카테고리 수(price/technical/fundamental 등). 부족 시 강verdict 제한.
  const net = (buyScore ?? 0) - (sellScore ?? 0);
  if (hardSell) return { verdict: 'avoid', action: '매도/회피', lean: 'hard-sell', net, coverage, reason: '치명 매도신호(veto) — 점수 무관 청산 우선' };
  let verdict, action;
  if (net >= 12) { verdict = 'buy'; action = '매수'; }
  else if (net >= 5) { verdict = 'accumulate'; action = '분할매수'; }
  else if (net > -5) { verdict = 'hold'; action = '관망'; }
  else if (net > -12) { verdict = 'reduce'; action = '비중축소'; }
  else { verdict = 'sell'; action = '매도'; }
  // 2026-06-19(ChatGPT #6): coverage gate — 종목별 데이터 <2 카테고리면 강한 매수/매도 금지(thin data 과확신 차단).
  //   동일 net 도 데이터 풍부도에 따라 confidence 다르므로 강verdict 를 분할/축소로 다운그레이드.
  let capped = false;
  if (coverage != null && coverage < 2) {
    if (verdict === 'buy') { verdict = 'accumulate'; action = '분할매수'; capped = true; }
    else if (verdict === 'sell') { verdict = 'reduce'; action = '비중축소'; capped = true; }
  }
  // 2026-06-23: 매수 veto — buyScore 가 아무리 높아도 칼받기/과열 종목은 신규매수 차단(buy/accumulate → 관망).
  //   이미 보유분 청산까지 강제하진 않음(그건 sell-side hardSell 영역). 신규 진입만 막음.
  let buyVetoed = false;
  if (buyVeto && (verdict === 'buy' || verdict === 'accumulate')) {
    verdict = 'hold'; action = '관망(신규매수 veto)'; buyVetoed = true;
  }
  const lean = net > 2 ? '매수 우세' : net < -2 ? '매도 우세' : '팽팽(관망권)';
  return { verdict, action, lean, net, coverage,
    ...(capped ? { coverageCapped: true } : {}),
    ...(buyVetoed ? { buyVetoed: true, buyVetoReason: buyVeto } : {}) };
}
// sell hits 에 치명 룰 포함 여부 — adjudicate 의 hardSell 판정용.
export function hasHardSell(sellHits) {
  return Array.isArray(sellHits) && sellHits.some(h => HARD_SELL_IDS.has(h.id));
}

// 매수쪽 hard veto (2026-06-23, 사용자: POSCO -27%/현대로템 -28% 를 하락 내내 매수한 사건) —
//   구루 규율(드러켄밀러 "추세 나쁘면 안 산다")을 *score→veto* 로 격상. 종전 buy-rules 는 가점만 하고
//   하락추세를 *벌점/차단* 안 해, mean-reversion 룰이 칼받기를 보상했음(blind-spot 감사 C1/H3).
//   ★중요(사용자 Q1 "떨어지는 중에도 분할매수 구간 있잖아?"): 지지/과매도/극공포 *앵커가 있는* 규율적
//   분할매수는 보존(veto 면제) — veto 는 *앵커 전무한 칼받기/무너진 주도주/과열 추격* 만.
//   chat(judge-engine)·보고서·보유 공유(adjudicate 경유). null=veto 없음, string=veto 사유.
export function hasHardBuyVeto(ctx) {
  if (!ctx || ctx.price == null) return null;
  const { price, sma50, sma200, rsi, low52w, high52w, fgScore } = ctx;
  const revYoY = ctx.revenueYoY ?? ctx.revenueGrowth ?? null;

  // 규율적 분할매수 앵커 — 하나라도 있으면 칼받기 아님 → veto 면제(accumulate/분할로 처리되게 둠).
  const oversold = rsi != null && rsi <= 35;                                        // 과매도 반등 zone
  const nearLow = low52w != null && (price - low52w) / low52w * 100 <= 15;          // 52주 저점 15% 내(지지)
  const capitulation = fgScore != null && fgScore <= 25 && (revYoY == null || revYoY >= 0); // 극공포+흑자 역발상
  if (oversold || nearLow || capitulation) return null;

  // (1) 칼받기 / 무너진 주도주: 50MA 아래 + 52주고점 대비 -18% 이상 하락 (앵커 없음 이미 확인).
  //   POSCO(356k, 50MA 417k, 고점442k=-19%)·현대로템(208k, 50MA 212k, 고점269k=-23%) 둘 다 포착.
  if (sma50 != null && price < sma50 && high52w != null && price <= high52w * 0.82) {
    const dd = ((1 - price / high52w) * 100).toFixed(0);
    const fin = revYoY != null && revYoY < 0 ? ` +매출 ${revYoY.toFixed(1)}% 역성장` : '';
    return `하락추세 신규매수 veto: 50MA 아래 + 52주고점 대비 -${dd}%${fin}, 지지/과매도/극공포 앵커 없음 (칼받기 차단 — 앵커 확인 후 분할매수)`;
  }
  // (2) 과열 추격: 200MA 대비 +50% 이상 parabolic → 신규 추격매수 금지(sell overextended200ma 의 매수쪽 대칭, H3).
  if (sma200 != null && price > sma200 * 1.5) {
    return `과열 추격 veto: 200MA 대비 +${((price / sma200 - 1) * 100).toFixed(0)}% 과확장(parabolic) — 신규 추격매수 금지`;
  }
  return null;
}
