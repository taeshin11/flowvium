# FlowVium AI 보고서 엔진 — 전체 동작 구조 + 현재 문제 상황 (외부 AI 자문용 프롬프트)

> 이 문서를 LLM(ChatGPT/Gemini/Claude)에 그대로 붙여넣고 "이 파이프라인의 논리적 약점·개선안을
> 우선순위와 함께 제시하라"고 요청하기 위한 자기서술 프롬프트다. 동봉 zip 의 코드와 함께 검토할 것.
> 최종 갱신: 2026-06-14 (KR 섹터 grounding · 유사국면 다요인 · 양면 등급제 심판 반영 후).

---

## 0. 시스템 개요
- **FlowVium** (flowvium.net): 글로벌 자금흐름·기관신호·AI 투자전략 일일 리포트. Next.js 14 App Router.
- **자가호스팅**: Cloudflare 터널 → RTX 4050(6GB VRAM) Windows 로컬 서버. pm2(web×2/cron/tunnel/redis/redis-shim).
  Vercel 사용 안 함. Redis 는 Upstash 쿼터 소진으로 **로컬 Memurai + REST shim** 으로 전환됨.
- **LLM**: 로컬 **Ollama qwen3:8b** (thinking 모델, `think:false`). cloud(groq/gemini/openrouter)는 quota
  소진 가정 → `LLM_LOCAL_ONLY=1` 로 cloud 폴백 차단. 즉 **모든 생성·번역이 단일 8B 로컬 모델**에 의존.
- **보고서 생성기**: `scripts/generate-report-local.mjs` (~7,900줄). 하루 5회 cron(midnight/morning/noon/
  afternoon/evening, KST) — Windows Task Scheduler → `run-report.bat` → 이 스크립트.
- **발간**: 생성 → 품질게이트 → 정시까지 sleep → 로컬 Redis 업로드(`investment-strategy` 키) → 발간後 verify.

---

## 1. 파이프라인 7단계 (generateViaOllama)

```
[1/7] 컨텍스트 수집  — 16+ 내부 API 병렬 fetch → ctxRaw (가격/F&G/자금흐름/매크로/공매도/내부자/
                       13F/뉴스cascade/공급망/섹터PE/변동성/수익률곡선/FedWatch/COT/원자재/KR수급)
[1.5] 매수 후보 4-stage 펀넬 (아래 §2)
[2/7] Wave1 — 5개 병렬 Ollama: macro / portfolio / regional / opportunity / narrative
[3/7] Wave2 — 병렬 Ollama: risk(리스크관리) / companyChanges(기업변화) / stockDetail(종목상세) /
                            sellRationale(매도근거 문장)
[4/7] Critique — 포트폴리오 자기비판 LLM 1회 (논리 구멍·과신 점검)
[5/7] 발간前 grounding + 양면 등급제 심판(아래 §3·§4) + 검증 게이트
[6/7] saveReport(SQLite + 파일) → 정시 발간 → Redis 업로드
[7/7] 발간後 verify-report → 결함 → hallucination_history (Karpathy, §7)
```

LLM 호출은 **단일 거대 프롬프트 금지**, 위처럼 섹션별로 잘게 쪼갠 다중 호출 구조 (8B 모델의 환각·형식붕괴
완화 목적). 프롬프트 빌더: `buildMacroPrompt`/`buildPortfolioPrompt`/`buildRegionalPrompt`/
`buildOpportunityPrompt`/`buildNarrativePrompt`/`buildRiskMgmtPrompt`/`buildCompanyChangesPrompt`/
`buildStockDetailPrompt`/`buildSellRationalePrompt`/`buildCritiquePrompt`.

---

## 2. 매수 종목 선정 (4-stage 펀넬, buildBuyCandidates)

풀: `data/candidate-tickers.json` 약 1,338 종목 (US ~873 + KR ~465 + ETF). 결정론적 룰 스코어링.

- **Stage 1 (light, 0비용)**: 전 종목에 `data/buy-rules-tuned.json` 37룰(price6/technical4/fundamental5/
  guru4/macro3/micro10/rotation3/selflearn2) 누적 점수. micro = 내부자매수·13F유입·뉴스긍정·공매도스퀴즈·
  공급계약수주·UOA콜편중 등. ctxRaw 의 맵(insiderMap/uoaMap/squeezeMap/newsSentimentMap/contractMap…)으로 평가.
- **Stage 2 (top 100)**: OHLCV fetch → RSI/50MA/200MA/거래량비. 기술 룰 재평가.
- **Stage 3 (top 50)**: company-financials fetch → ROE/PE/PEG/매출성장/Buffett moat.
- **Stage 4 (top 30)**: `buildPortfolioPrompt` 의 `[BUY CANDIDATES]` 블록에 주입 → LLM 이 최종 12 선택
  (US 6 + KR 6 강제). 점수 높은 것 우선 가이드.
- **2026-06-14 grounding**: 각 후보에 `businessOneLiner()`(company-business products → company-profiles
  Yahoo summary)를 프롬프트에 한 줄 주입 → LLM 이 "HPSP=반도체장비"를 알고 환각 thesis("차량 수요") 방지.

매수 = 정량 룰이 후보를 좁히고(코드), LLM 이 최종 선택 + rationale 문장(코드 주입 사실에만 근거).

---

## 3. 매도 종목 선정 (buildSellCandidates + evaluateSellRule)

- 대상: DB 의 과거 buy 추천 중 미종결 포지션 + 현 portfolio.
- `data/sell-rules-tuned.json` 23룰(price/technical/fundamental/guru/rotation/macro/micro 7카테고리).
  예: stop 돌파·target 근접·dead cross·200MA 이탈·RSI 과매수·op margin 악화(매출 hyper-growth 예외)·
  PEG 고평가·sector PE 프리미엄·내부자매도·13F 이탈·옵션 풋편중·공급계약 해지·부정뉴스·VIX 급등·F&G 극단.
- 매칭 룰 누적 score → urgency. `tune-sell-rules.mjs` 가 주1회 과거 outcome 으로 임계 자동 조정.
- 매도 근거 문장은 `buildSellRationalePrompt` 로 LLM 이 작성(분류·점수는 코드, 문장만 LLM).

---

## 4. 경합심사 = 양면 등급제 심판 (2026-06-14 전면 개편)

매수 후보와 매도 룰을 양방향 cross-examine 해 최종 포트폴리오 확정.

### 4-1. buy → sell 심판 (발간前 게이트)
각 매수 후보를 매도룰(fundamental/technical/guru/**micro**)로 재평가:
- **hard-sell**(stop·dead cross·200MA·마진붕괴·내부자매도·계약해지) → **매수확신 무관 즉시 탈락**(리스크 우선).
- **soft 신호**: 신호크기 가중(RSI 과열도·PE 프리미엄·마진하락폭, 최대 +3) 합산 = `softScore`.
- **매수확신 상쇄**: `buyDiscount = clamp((stage1Score−25)/5, 0, 4)`. 강한 매수일수록 soft 매도 상쇄.
  `netSoft = softScore − buyDiscount`.
- **거시 modifier**: `macroData.riskLevel='high'` 면 임계 −1(위험장 더 엄격).
- **등급 판정**: netSoft ≥ HIGH(7) → 탈락 / netSoft ∈ [MID(4),HIGH) → **감점 보류**(보유하되 확신 강등·
  비중 ×0.6·⚠️경고노트) / 그 외 통과.
- 시장별 최소 2석 미달 시 차순위 후보 재충원(refill). 전원 저촉 시 "의도적 공석" 명시(침묵 금지).

### 4-2. sell → buy 역심판 (adjudicateSellVsBuy)
매도 후보에 매수신호(RSI≤32 과매도·골든크로스·PEG<1) 있으면: hard-sell 이면 매도 유지, target 근접만이면
"전량매도 대신 trailing/부분익절"으로 충돌 surface.

### 4-3. trail
모든 판정(buyConviction·softScore·netSoft·tier·hits)을 `reports/reconciliation/reconcile-*.json` +
보고서 `buySellReconciliation` 필드에 보존(연구용).

---

## 5. 섹션별 작성법 · 뉴스 반영 · 유사국면

- **종합 판단(marketVerdict)**: 결정론 함수. 하락전조(earlyWarning: 신용/VIX/금리커브/F&G/FX composite)
  + 상승전조(reboundWatch) + 공포매수(F&G≤25·낙폭≥5%·VIX≥25, 버핏/템플턴) + **과거 유사국면**.
  US 박스 / KR 박스 분리(독립 verdict). stance-gate: earlyWarning severe/high 면 LLM stance 무관 bearish/neutral cap.
- **유사국면(computeHistoricalAnalog, 2026-06-14 다요인)**: ^GSPC+^VIX+^TNX(10Y)+^IRX(13주)+RSP+^KS11+^KQ11
  1990~ 일봉 라이브. **가중 거리 매칭** — 가격/변동성(VIX·낙폭·20일수익률) + **거시(10Y금리·수익률곡선
  기울기·금리3개월모멘텀)** 정규화 가중 유클리드 + 적응형 임계(8건 목표) → 1/3/6개월 forward 중앙값·상승확률
  실측. 신용스프레드·F&G 는 장기이력 부재 → 현재상태 overlay(macroContext).
- **뉴스 반영**: `/api/news-cascade` 기사 → `newsSentimentMap`(제목·요약 ↔ 종목명/티커 결정론 매칭 →
  pos/neg/negRatio). 매수 micro_news_positive · 매도 micro_news_negative 룰 + narrative 섹션 inject.
- **macroAnalysis/technicalAnalysis/fundamentalAnalysis/thesis**: `buildMacroPrompt` LLM(실 CPI/금리/스프레드
  숫자 주입, ≤150자 강제). **기술지표(RSI/MA)는 실데이터 주입 후 verbatim 강제**(환각 차단).
- **보고서 주요 필드**: stance·thesis·portfolio·buySellReconciliation·sectorAllocation·riskEvents·
  macroAnalysis·technicalAnalysis·fundamentalAnalysis·riskLevel·regionStances·shortSqueeze·insiderSignals·
  topOpportunity·hedgingSuggestion·marketNarrative·companyChanges·supplyChainChanges·portfolioOutcomes·
  portfolioByMarket(us/kr)·sellRecommendations(us/kr)·buyCandidateScoring.

---

## 6. DB(SQLite data/flowvium.db) 저장 + 적용 + 전향적 연구

테이블: reports / recommendations / recommendation_outcomes / sell_recommendations / sell_outcomes /
buy_candidates / endpoint_snapshots / news_archive / news_price_reactions / macro_snapshots /
short_squeeze_archive / earnings_archive / insider_archive / fg_archive / asset_flow_archive /
hallucination_history / company_segments.

- **endpoint_snapshots**: 발간 시 40+ 내부 API(`snapshot-endpoints.mjs`: fear-greed/capital-flows/
  macro-indicators/short-interest/insider-trades/nport-holdings/supply-chain/sector-pe/options-flow/
  cot-positions/… + 종목별 company-financials/price-history)를 스냅샷 → 시계열 audit + freshness probe.
- **전향적 연구 (prospective, Karpathy 양방향 학습)**:
  - `evaluate-recommendations.mjs`: 과거 buy 추천을 사후 가격으로 채점 → recommendation_outcomes
    (hit_target/sold/stop_loss/not_entered(NE)/still_holding) + pnl_pct.
  - `evaluate-sell-outcomes.mjs`: 매도 추천 사후 채점 → sell_outcomes.
  - 집계가 다음 보고서 프롬프트에 inject: **F22**(최근30일 승률·NE율 → portfolio 프롬프트), **F19/SkillOpt**
    (최근5보고서 품질·약점), **F26/AntiPattern**(hallucination_history 최근 환각 5건 → "이렇게 쓰지 마라").
    보고서 자체에도 `portfolioOutcomes` 필드로 사용자 노출.
  - `tune-buy-rules.mjs`/`tune-sell-rules.mjs`: outcome 기반 룰 임계·점수 주1회 자동 조정.

---

## 7. 검증 (Karpathy closed loop) + 발간前 안전망

- 발간後 `verify-report.mjs`: sector↔meta 환각 / ticker↔회사명 환각 / **sector-keyword 교차 환각**
  (반도체주에 "차량 수요" 등, INDUSTRY_TERMS+SECTOR_VOCAB) / 52주범위 / PE 중복 / copy-paste 동일수치 /
  RSI·지지선 일관성. 결함 → `hallucination_history` 적재 → F26 으로 다음 프롬프트 anti-pattern inject.
- 발간前: 4중 portfolio 안전망(ticker 풀 cross-check / livePrices 검증 / entryZone ±15% cutoff /
  ENTRY_CALIBRATION), name/sector meta override, RSI 라벨 실값 교정, 품질게이트(thesis garbage/portfolio count).
- 통합검증 `npm run verify` (audit-data-sources/audit-coverage/audit-company-pages/check-static-fallbacks/
  check-cron-cost/verify-latest-report) — pre-push hook.

---

## 8. 현재 남은 문제 (외부 AI 가 우선순위·개선안을 제시해 주길 바라는 지점)

1. **단일 8B 로컬 모델 의존**: 모든 생성+번역이 qwen3:8b 1개. GPU 6GB 한계로 동시성 낮고, 보고서 발간 5회/일 +
   페이지뷰 번역이 GPU 경합. cloud quota 소진으로 폴백도 막힘. → 모델 라우팅/양자화/배치 전략?

2. **비-가격 정량필드 환각 잔존 (최대 난제)**: 가격/기술(RSI/MA)은 실값 주입+verbatim 으로 grounded 이나,
   fundamentalBasis/catalysts 의 매출 YoY%·영업이익률%·내부자% 등은 LLM 자유생성 → 단일(비중복) 환각은
   실값 대조가 없음. 근본책 = 모든 정량필드를 [COMPUTED] 실값으로 주고 verbatim 강제(기술지표처럼).
   과거 사례: GOOGL 매출 "35% YoY"(실제 21.8%), "12.3% 인사이더"가 4종목 copy-paste.

3. **심판 엔진(§4) 추가 개선 여지**: 양면 등급제로 개편했으나 — (a) sell→buy 역심판이 아직 3개 하드코딩
   신호(RSI/골든크로스/PEG)뿐, 매수 룰 엔진 전체 미사용. (b) micro veto 가 옵션·뉴스만 — 내부자매도/13F는
   방향 데이터 신뢰도 문제로 hard 목록에만. (c) buyDiscount·임계(HIGH7/MID4)가 경험적 — outcome 기반 튜닝 부재.

4. **포트폴리오 수 부족·품질게이트 차단**: US6+KR6=12 목표가 자주 10으로 미달(후보 부족/심판 탈락).
   thesis 가 화살표체인("MSFT→NVDA→AMAT→LRCX")이면 isGarbage 오탐으로 발간 차단되는 false-positive 도 있음.

5. **번역 신뢰성**: 보고서는 ko 단일 발간 → 16개 언어는 클라이언트 `<T>`(/api/translate, 로컬 qwen)로 번역.
   GPU 경합 시 실패→원문 노출. 제품코드 모지바케는 가드 추가했으나 산문 번역 실패는 잔존.

6. **데이터 소스 단일성**: 가격은 Yahoo v7(crumb) 단일 의존(Stooq 봇차단 후). KR 소형주는 Yahoo
   assetProfile 404 → Naver WICS 폴백. 옵션 IV·DART EPS 는 KR 미제공.

7. **outcome 표본 부족**: 종결 승률 30%(30건) 수준 — 표본이 작고 NE(미진입)가 많아 룰 튜닝 신뢰구간이 큼.
   전향적 학습이 통계적으로 유의해지려면 누적 표본·기간 필요.

**요청**: 위 구조에서 (1) 논리적 결함·순환참조·사각지대, (2) 8B 로컬 제약 하의 현실적 개선 우선순위,
(3) 매수/매도/심판 3엔진의 정량적 엄밀성 강화 방안을 근거와 함께 제시해 달라.

---

## 9. 동봉 코드 파일 (zip)
- `scripts/generate-report-local.mjs` — 메인 엔진(전 파이프라인·심판 게이트·grounding·strip·analog).
- `scripts/verify-report.mjs` — 발간後 검증 프로브(환각 감지 → Karpathy).
- `scripts/lib/db.mjs` — SQLite 스키마(추천/outcome/hallucination_history/스냅샷).
- `scripts/lib/snapshot-endpoints.mjs` — endpoint_snapshots 대상 목록.
- `scripts/evaluate-recommendations.mjs` / `scripts/evaluate-sell-outcomes.mjs` — 전향적 outcome 채점.
- `scripts/enrich-sectors.mjs` — 섹터 grounding(US+KR, Yahoo+Naver).
- `data/buy-rules-tuned.json` / `data/sell-rules-tuned.json` — 매수/매도 룰.
- `src/app/api/investment-strategy/route.ts` — 보고서 타입·서빙.
- `src/components/pages/ReportPage.tsx` — 보고서 렌더링.
- `src/app/api/translate/route.ts` — 번역(모지바케 가드).
- `CLAUDE.md` — 프로젝트 규칙(동적소스·검증의무·grounding 원칙).
- `FEATURES.md` / `METRICS.md` — 기능·지표 카탈로그.
