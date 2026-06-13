# FlowVium 보고서 — 섹션 전수 검토 요청 (외부 AI 자문용 프롬프트)

> 앞서 받은 PROBLEM_STATEMENT.md(엔진 아키텍처) 리뷰는 횡단 결함(게이트 순서·정량 환각·매수/매도/심판·
> 튜닝) 중심이었다. 이번엔 **보고서의 각 섹션을 하나씩** 검토해 달라. 동봉 zip 의 엔진코드
> (generate-report-local.mjs)·렌더링(ReportPage.tsx)·실제 보고서 JSON(report-*.json)·자체 섹션감사
> 결과(section-audit-output.txt)를 함께 보고, **섹션별로** 아래 5개 축으로 평가하라.

## 검토 축 (각 섹션마다)
1. **Grounding 적정성**: 이 섹션의 숫자/판정이 실데이터(결정론)인가, LLM 자유생성(환각위험)인가?
   LLM 생성이면 그 숫자를 deterministic 으로 바꿀 소스가 있는가?
2. **환각/오류 위험**: 이 섹션에서 발생 가능한 구체적 오류 유형 + 현재 방어가 충분한가?
3. **콘텐츠 유용성**: 투자자에게 실제 의사결정 가치가 있는가? 중복·공허·formulaic 하지 않은가?
4. **UX/표현**: 렌더링(ReportPage.tsx) 상 명확한가? i18n(16언어)·번역 안정성 문제는?
5. **공백/누락**: 빈 섹션의 근본원인은? 추가해야 할 섹션·필드는?

각 섹션에 대해 **(현 grounding 요약 1줄) → (가장 큰 리스크 1개) → (구체적 개선안 1개)** 형식으로,
마지막에 **섹션 우선순위(어디부터 고칠지)** 와 **누락 섹션 제안**을 달라.

---

## 보고서 섹션 지도 (28개, 자체 감사 분류 — section-audit-output.txt 참조)

| 섹션 | 생성 함수/소스 | grounding 분류 | 현 상태 |
|---|---|---|---|
| stance | stance-gate(earlyWarning cap) | 결정론 | ✅ |
| thesis | buildMacroPrompt LLM + isGarbage | LLM+가드 | ✅ |
| portfolio | buildBuyCandidates(4-stage 룰) + buildPortfolioPrompt LLM 선택 + fundamentalBasis deterministic render + validateGroundedNumbers + name/sector override | 혼합(룰+LLM+strip) | ✅ |
| buySellReconciliation | 양면 등급제 심판(buyConviction vs sellScore, hard/감점/통과) | 결정론 | ✅ |
| earlyWarning / reboundWatch | computeMacroEarlyWarning/computeReboundWatch(신용/VIX/금리커브/F&G/FX) | 결정론 | ✅ |
| marketVerdict (+krVerdict) | computeMarketVerdict + computeKrVerdict(US/KR 박스, 공포매수+유사국면) | 결정론 | ✅ |
| sectorAllocation | portfolio.sector 합산 fallback | 결정론 | ✅ |
| riskEvents | buildMacroPrompt LLM | LLM | ✅ |
| macroAnalysis | buildMacroPrompt LLM + FRED fact-check + enrichMacroAnalysis | LLM+가드 | ✅ |
| technicalAnalysis / fundamentalAnalysis | buildMacroPrompt LLM | LLM | ✅ |
| regionStances | buildRegionalPrompt LLM | LLM | ✅ |
| **shortSqueeze** | 외부 short-interest/options-flow | 외부 | **⚠️ 빈[0]** |
| **insiderSignals** | 외부 SEC Form4 | 외부 | **⚠️ 빈[0]** |
| topOpportunity | buildOpportunityPrompt LLM | LLM | ✅ |
| stopLossRationale | 포지션별 결정론 | 결정론 | ✅ |
| hedgingSuggestion | buildRiskMgmtPrompt LLM | LLM | ✅ |
| marketNarrative | buildNarrativePrompt LLM(why/watch/hotThemes) | LLM | ✅ |
| companyChanges | buildCompanyChangesPrompt Wave2 LLM + DART/SEC 공시 | LLM+공시 | ✅ |
| supplyChainChanges | DART/SEC 공급망 신호 결정론 추출 | 결정론+외부 | ✅ |
| portfolioOutcomes | DB evaluate-recommendations(전향적 hit/stop/NE) | DB | ✅ |
| sessionFocus | 세션별 결정론 | 결정론 | ✅ |
| sellRecommendations | buildSellCandidates 매도룰 + 역심판 action ladder(sell/partial/trail/hold) | 결정론+LLM문장 | ✅ |
| buyCandidateScoring | 4-stage 룰엔진 top30 | 결정론 | ✅ |
| etfStrategy | buildEtfStrategy(룰기반 broad/sector/thematic, batch price) | 결정론 | ✅ |
| stockDetail(병합) | buildStockDetailPrompt Wave2 LLM(catalysts/fundamentalBasis) + F23 fact-check | LLM+가드 | (portfolio 에 병합) |

## 이미 알고 있는 핵심 이슈 (중복 지적 말고 심화/반박해 달라)
- 빈 섹션 2개(insiderSignals·shortSqueeze)는 **외부 데이터 sparsity**(SEC Form4/short-interest 안 흐름)가 근본.
  룰발화 감사(check-rule-firing)의 micro_insider 0-발화와 동일 뿌리.
- 정량 환각 잔존: fundamentalBasis 는 deterministic render(실 fin) 하지만 catalysts numeric·LLM 섹션
  (macro/region/narrative)은 LLM 자유생성. validateGroundedNumbers 가 %/x/배/%p/건 strip 하나 절대금액·
  날짜는 부분.
- LLM 호출 8B 단일(qwen3:8b), cloud quota 소진으로 폴백 막힘 → 섹션 품질·번역 GPU 경합.

## 동봉
- `generate-report-local.mjs` — 전 섹션 생성 엔진. `src/components/pages/ReportPage.tsx` — 렌더링.
- `report-2026-06-14-*.json` — 실제 섹션 콘텐츠 샘플(검토 대상 실물).
- `section-audit-output.txt` — 자체 28섹션 감사 결과. `PROBLEM_STATEMENT.md` — 엔진 구조.
- `FEATURES.md`/`METRICS.md` — 섹션·지표 카탈로그.

**요청**: 위 28섹션 각각을 5축으로 검토 → 섹션별 (grounding/리스크/개선안) + 전체 우선순위 + 누락섹션 제안.
