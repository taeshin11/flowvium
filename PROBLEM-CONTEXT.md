# FlowVium — 매수/매도/심판 엔진 + 챗 + 보고서 검증체계 현황 (2026-06-19)

## 시스템 개요
- **FlowVium** (flowvium.net): 자가호스팅 한국어 AI 투자 플랫폼. Windows 11 + WSL Ubuntu 24.04.
- **LLM**: WSL vLLM(:8000)가 `Qwen3-30B-A3B-Instruct-2507-AWQ`(MoE, GPU 전용, RTX 4090 24GB) 구동. cloud LLM은 fallback.
- **임베딩**: bge-m3(:8100) — RAG용. **Redis**: 로컬 Memurai(:6379) + rest-shim(:8079). cloud Upstash 소진.
- **앱**: Next.js 14 (pm2 cluster, `next start`). 보고서 생성: `scripts/generate-report-local.mjs` (Node, run-report.bat cron 5회/일: morning/noon/afternoon/evening/midnight).

## A. 매수엔진 / 매도엔진 / 심판엔진 (2026-06-19 단일화 완료)
**문제였던 것(해결됨)**: 챗(`src/lib/judge-engine.ts` `fireRules`)과 보고서(`generate-report-local.mjs`)가
매수/매도/심판 엔진을 *별도 구현* → 같은 종목에 다른 점수·결론(drift).

**현재 아키텍처 (단일 소스)**:
- `src/lib/buy-sell-engine.mjs` (+`.d.ts`) — **공유 룰 평가기**(accumulation-detector.mjs 패턴). Node(보고서)·Next(챗) 양쪽 import.
  - `evaluateBuyRule(rule, ctx)` / `evaluateSellRule(rule, ctx)`: switch(condition.type) 순수 평가기.
  - `scoreBuy(ctx)` / `scoreSell(ctx)`: tuned 룰 전체 채점 → {score, hits}.
  - `adjudicate(buyScore, sellScore, {hardSell})`: **결정론 최종 심판** → net 임계 ±5/±12 → 매수/분할매수/관망/비중축소/매도, hardSell(데드크로스·200MA이탈·OCF적자) veto → 매도/회피.
  - `loadBuyRules/loadSellRules`: data/buy|sell-rules-tuned.json 읽기. _readData = cwd 우선 + 모듈위치 fallback(cron-critical 0룰 방지).
- **룰셋**: `data/buy-rules-tuned.json`(40룰) / `data/sell-rules-tuned.json`(26룰). `tune-buy-rules.mjs`/`tune-sell-rules.mjs`가 주1회 실현 edge 기반 **score 자동조정**(룰 추가/삭제 안 함 → 수동 룰 영속).
  - 카테고리 7+selflearn: price/technical/fundamental/guru/macro/micro/rotation/selflearn.
  - **거래량**: 매수 tech_volume_surge(거래량+50%&상승)·micro_volume_burst / 매도 tech_volume_dry(거래량폭증하락=분산). buyScore/sellScore에 직접 기여 → action 결정.
  - **guru 7매수**(Buffett·Lynch·Greenblatt·Graham 가치 + Druckenmiller/Tudor 추세 + Marks/Klarman 역발상 + O'Neil 성장) / **3매도**(Lynch과대·Marks도취·Druckenmiller추세붕괴). 복합조건=프레임 전체 충족 시만 발화.
- **챗 적용**(`fireRules`): TickerCtx → EngineCtx 매핑(relVol→volPct, peg 계산 등) → scoreBuy/scoreSell + **forensic 보강**(이익의질 OCF<순이익·희석·되팔기·과대확장·부채 — tuned 미포함 안전망, 챗만 재무 fetch라 발화) → adjudicate로 "🔨심판=OOO" 결정론 결론을 프롬프트에 주입. **LLM은 그 결론을 설명만, 뒤집기 금지**(이전 "매수16점vs매도3점인데 매도우세" LLM 모순 차단).
- **보고서 적용**: 동일 evaluateBuyRule/SellRule import. buildBuyCandidates(후보선정) + adjudication(sell-veto → veto/downgrade/pass tier, netSoft≥HIGH(7)/MID(4)). *후보 필터링* 목적이라 챗의 verdict와 결정 맥락은 다르나 *같은 엔진 점수 + 같은 adjudicate* 사용.
- **데이터 차이(graceful skip)**: 챗은 단일종목 실시간 fetch(섹터PE·옵션flow·내부자·보유맥락 없음) → 해당 룰 자동 skip. 보고서 후보스캔은 그 데이터 보유. 같은 평가체계, 데이터 유무로 자연 분기.

## B. 챗 — 매수·매도 심판엔진(AISVI)
- `src/app/api/judge-chat/route.ts` (POST SSE 스트리밍) + `src/lib/judge-engine.ts`.
- 모드: AISVI(1800tok) / AISVI+RAG(2600, 버핏서한·투자고전 bge-m3 의미검색) / **AISVI 심층(3800, 기본)** — 2-pass(리서치브리프→판단) + 사업보고서 본문(DART/SEC) grounding.
- grounding: 시세·재무·거시·뉴스·사업보고서 본문·작전주(accumulation 매집봉) + 엔진 판정 + 오늘 리포트.
- **챗 학습 폐루프**: `flowvium:judge-chat:verify`(per-answer 검증로그) → `recentChatAntiPatterns`(반복결함 집계) → buildSystemPrompt "🔁 최근 반복된 실수" 주입. `analyze-chat-logs.mjs`가 효과 추적(최근vs과거 결함률·교정율·persistent유형).
- **결정론 sanitize**(`sanitizeAnswer`): 점수태그·룰ID·<3%급락·미특정 엔진점수날조 자동제거.
- **vLLM 전역 세마포어**(`src/lib/llm-gate.ts`): Redis ZSET, MAX 4, 초과 시 대기안내+큐.
- 회원: fv_member HMAC 쿠키(CRON_SECRET 서명), per-user 히스토리 Redis.
- 300 스트레스 테스트(`stress-test-chat.mjs`): 최근 결함률 **2.0%**(폐루프 효과로 13.9%→2.0%, 잔여 stale_year ETF).

## C. 보고서 검증체계
- **verify-report.mjs**: 발행 직후 자동 — sector/52w/MA/fact-check + latin_bleed/garble·curve bp·magnitude·통화mix 등 결함 검출 → `hallucination_history`(Karpathy) 적재 + 다음 프롬프트 anti-pattern inject.
- **결정론 corrector**(`scripts/lib/narrative-fix.mjs`): 검출만 하고 안 고치던 dead-end 해소 — 커브bp 실값교정·orphan원·콘탱고·FedWatch 차기회의 날짜주입·지수등락 실값대조. `latin-repair.mjs`: 한글내 로마자 누출(포osi가=포지션)을 vLLM targeted 재작성(숫자보존 검증).
- **pre-publish gate**: latin_garble/latin_bleed/index_fabrication 등 critical 결함 → 자동 발간 차단(이전 클린본 유지). latin-repair가 gate 前 자가복구.
- **audit-coverage.mjs**: DB NULL·endpoint manifest·portfolio↔snapshot·buy/sell 7카테고리 대칭·Karpathy 재발추세(≥5회 critical)·entryZone gap.
- **주기 모니터**(`cron-runner.mjs` runMonitor 20분): stall·dataQuality·gpu·fallbackPurge·cronFails·artifactFresh·**publishRecheck verdict**(2026-06-19 통합 — 이전엔 session-spotcheck 수동에만 있어 놓침).
- **session-spotcheck.mjs**: 발행후재검 verdict·deep감사·LoRA학습 결과·wipe-risk surface.
- **post-publish-recheck**(`scripts/visual/audit-pages.mjs` + recheck): member 인증 라이브 페이지 슬라이스+probe → recheck-status.json(verdict/liveConfirmed/defects).
- **verify-all.mjs**: 6 검증 일괄(data-sources·coverage·company-pages·static-fallbacks·cron-cost·verify-report). git pre-push hook.

## D. 반복 안티패턴 (이 시스템의 구조적 교훈)
**"detector는 차단/flag하는데 corrector가 없어 stuck"** — 이번 세션 반복: ① 챗 검증로그 dead-end ② curve_slope 검출만 ③ won_label 오탐 ④ latin gate 차단만(corrector 없어 보고서 9h stale) ⑤ maint overdue 검출만 ⑥ recheck verdict 미surface. 각각 corrector/소비처를 채워 닫음. **"exit 0 = 성공" 함정**(SFT batch가 학습 실패해도 0x0)도 spot-check surface로 차단.

## E. 현재 열린 문제 / 검토 요청 사항
1. **심판 통합 잔여**: 보고서 held-position action(trail/partial/sell, line ~7130)이 아직 adjudicate 미사용 — 후보 필터링과 별개 로직. adjudicate로 통일 검토.
2. **검출기 과민(오탐)**: dup_riskevent_exposure(NFP+FOMC 둘 다 "금리민감"=정당한데 중복 flag), won_label류 — "구별되는 이벤트는 동일 exposure 허용" 튜닝 필요.
3. **stale_year 2%**: ETF(QQQ/IEFA) 챗 답변이 과거 연도를 최신처럼 — 폐루프 점감 중이나 결정론 sanitize 추가 검토.
4. **보안**: MEMBER_SECRET를 CRON_SECRET과 분리(blast radius) — 미적용(교체 시 기존 회원 쿠키 무효).
5. **monitor-deep**: detached spawn이 Windows 프로덕션서 완주 못 함(157s 소요) — 전용 스케줄task 검토.
6. **SFT/LoRA**: QLoRA 30B device_map CPU offload 실패 fix 후 재무장(06-20 02:00) — 미검증.
7. **엔진 정합성 검토 요청**: 매수40/매도26 룰의 score 균형, adjudicate 임계(±5/±12)의 적정성, guru 복합조건 발화빈도, forensic 보강이 tuned와 중복/충돌 없는지.

## 핵심 파일 (이 zip 포함)
- 엔진: buy-sell-engine.mjs/.d.ts, buy-rules-tuned.json, sell-rules-tuned.json, accumulation-detector.mjs, tune-buy-rules.mjs, tune-sell-rules.mjs
- 챗: judge-engine.ts, judge-chat/route.ts, llm-gate.ts, analyze-chat-logs.mjs, stress-test-chat.mjs
- 검증: verify-report.mjs, audit-coverage.mjs, narrative-fix.mjs, latin-repair.mjs, check-data-quality.mjs, session-spotcheck.mjs, cron-runner.mjs, audit-pages.mjs, verify-all.mjs
