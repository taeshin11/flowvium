# 2026-07-10 — 전수검사 + US 히트맵 전멸 복구 + 지속결함 에스컬레이션 신설

사용자 요청: "보고서/채팅/엔드포인트/슬라이드 검수 전수검사" → 이어서 "자율 진행: 좀비 정리,
모니터 촘촘히(스톨감지), Karpathy 폐루프/하네스 점검, 사각지대 분석+검증체계, 코드/데이터 정리,
GPU 속도, 불변식 검증, 미루기 금지".

커밋: 383f5949 (히트맵+에스컬레이션) · fa371f91 (감사 레시피 동기화) · e931c7ea (ETF 오검사+챗 추세)

## 1. 전수검사 결과 (전부 정상)

- **보고서 발간**: 07-10 morning 6:41 / noon 11:42 / afternoon 15:42 — 정시(±2분), verify 0결함.
  스케줄: Morning 6:40 · Noon 11:40 · Afternoon 15:40 · Evening 21:10 · Midnight 23:40 (schtasks Last Result 전부 0).
- **라이브 슬라이드 검수**: 매 발간 후 reports/verify/*.json + 1h 주기 post-publish-recheck.
  afternoon recheck: 슬라이스 12장, portfolio 렌더대조 100%, thesis/narrative 대조 ✓, verdict ok.
- **채팅(judge-chat)**: 라이브 SSE 프로브 — 한글 답변 320자/11s, 한자 0.
  외부 대조: NVDA $202.78 = Yahoo 실값 정확 일치, F&G 47 = CNN 실값 일치.
- **엔드포인트 cron 15개**: 전부 스케줄대로 갱신. evaluate-signals/log-cascade-events 는
  주간(일요일)이라 07-05 실행이 정상 (26h 잣대 오탐 아님 — triage.mjs 주석 참조).
- **서비스**: pm2 5프로세스 online(07-08 크래시 복구 후 43h), vLLM :8000 / RAG :8100 / Redis :6379 / Web :3000 전부 alive.
- **지수 전일대비**: 실값 확인 (0.0% 버그 재발 없음 — f994566c 유지).

## 2. 🔴 사각지대: US 히트맵 전멸 — 하루종일 감지만 되고 방치

**증상**: `[K] market-heatmap 빈 param(silent): US` 가 20분 auto-monitor 에 07-10 내내
(60+ 사이클) 떠 있었는데 아무도 개입 안 함. US 히트맵 = 사용자 화면에서 빈 트리맵.

**원인 체인**:
1. iShares IVV CSV 는 종전대로 HTML 챌린지 차단 (알려진 상태) → Wikipedia 폴백 경로 진입.
2. **Wikipedia 가 S&P500 페이지를 Parsoid 마크업으로 변경** — href 가 class 보다 앞,
   `<td id="...">`, BRK.B/BF.B 는 `</a>` 뒤 HTML 주석(`<!-- DO NOT CHANGE THIS TICKER ... -->`).
3. 구 regex (class="external text" 가 href 앞 가정 + 무속성 `<td>` 가정) → **0매치** → holdings [].
4. route 298행: `unavailable = sectors.length===0 && country!=='US'` — US 는 정직 unavailable 도 못 받고 silent empty.
5. **빈 결과가 Redis 에 15분 캐시로 고정** (메모리 캐시에만 비어있음 가드가 있었고 Redis 경로엔 없었음).

**수정** (src/lib/ishares-holdings.ts + src/app/api/market-heatmap/route.ts):
- regex 재작성: 속성 순서 무관 + `<td[^>]*>` + 주석 허용 `(?:<!--[\s\S]*?-->|[^<])*`.
  라이브 검증 502/503 매치 (BRK.B/BF.B 포함 전 메가캡, dupes 0, 이상 섹터 0).
- 0매치 시 `wikipedia_parse_zero` warn 신설 (info 에 안 묻히게).
- Redis 캐시 가드: `cacheable = stocks.length>0 || unavailable===true` — silent-empty 는 캐시 금지.
- fix 후 실측: sectors 11 / stocks 200 / NVDA $4,912B 실시총 / changePct -0.66 live.
- 17:40 모니터 사이클에서 dataQuality OK · defects [] 확인 (완전 해소).

**검증체계 신설 — "모니터가 본다 ≠ fix" 의 구조적 해결** (scripts/cron-runner.mjs):
- 지속결함 에스컬레이션: 같은 결함 키가 6사이클(~2h) 연속 → 🚨🚨 escalation 로그 +
  `logs/escalations.json` 적재(최근 50), 지속 중 18사이클(~6h)마다 재알림.
- monitor-status.json 에 `checks.persistentDefects` (최장 streak) 노출 — 스팟체크가
  "새 결함"과 "방치된 만성 결함"을 구분.

## 3. 감사(audit) 자체의 결함 3건 — 검증체계가 거짓말하던 것들

1. **audit-data-sources ↔ 앱 drift**: 감사가 Wikipedia 구 regex + CNN minimal UA 를 복사해
   보유 → "Wikipedia 0 matches" / "CNN 418" false alarm. 앱(fear-greed/route.ts)은 이미 full
   browser 헤더로 200 받는 중이었음. → 앱 레시피와 동기화 (재실행: 504 tickers, score 47).
   **원칙: 감사 프로브의 fetch 레시피(UA/헤더/regex)는 앱 소비 경로와 항상 동기화.**
2. **ETF 오검사 → push 차단**: audit-coverage probe10 / audit-company-pages 의 회전 커서가
   ETF 블록(VUG/VTV/IWF/IWD/IWB/VIG)에 진입 → company-financials 6/6 404 → err → verify-all
   FAIL → **pre-push hook 이 push 를 차단** (이번 세션에서 2회 푸시 실패로 발견).
   ETF 는 재무제표 없는 게 정상(404=정답). 권위소스 `candidate-tickers.json meta[t].cap==='etf'`
   (193개, SPY/QQQ 포함 — etf-names.json 158개는 불완전)로 US 표본에서 제외.
   fix 후: audit-coverage exit 0 "0 결함", company-pages 표본 130/140 ok.
3. **챗 폐루프 추세 half-split 착시**: "악화 30.6% vs 10.9%" 는 hanja_leak 107건 + non_answer
   전부가 **07-06 하루**(vLLM 11h 다운 + 한자 버스트 사건일)에 몰린 것을 건수 절반 분할이
   "최근"으로 뭉갠 결과. 이후 4일간 결함 0 (라이브 프로브 포함). analyze-chat-logs 를 달력
   시간창(최근 7일 vs 이전, 각 최소 10건) 비교로 교체 — 사건이 7일 지나면 자동 이탈.

## 4. 자율 점검 항목별 결론

- **좀비 프로세스**: 없음. 전수 스윕 — pm2 6 node 전부 정상 귀속, 고아 cmd/powershell/모니터/
  워치독 없음, conhost 전부 살아있는 부모에 귀속. FlowVium-vLLM task "Running"은 정상(장기 실행 호스트).
  참고: SpinAi.HospitalNodeGui 2 인스턴스 (타 프로젝트, 무통보 재부팅 전력) — 소관 외, 보고만.
- **이벤트 로그**: 최근 3일 의도적 재부팅(1074) 0건. 07-08 20:35 Kernel-Power 41 hard crash 만
  (기존 메모리와 일치, 21:35 복구).
- **모니터 촘촘함**: 이미 4중 — auto-monitor 20분(check-stall + data-quality, execSync timeout
  hang 방지) / pm2-watchdog 15분 / DeepMonitor 6h / post-publish-recheck 1h. + 에스컬레이션 레이어 추가.
- **Karpathy 폐루프**: 작동 중 — hallucination_history 724행 (7일 321건 / 24h 71건),
  anti-pattern inject avg 4~5건, buy_candidates 3,788행 (avg 31/report), buy/sell rule 7카테고리 대칭 ✓.
- **하네스/불변식**: verify-all 17종 fail 0 — 매수 hard veto 4경로+H1 폐루프 배선(14 ok),
  한자가드 회귀, RAG 임베더 스코어(10 ok), LLM 라우팅 stale 가정 봉쇄(7 ok), 보고서 환각 44 probe,
  게이트 등록 래칫, 미루기 추적(check-deferrals) 전부 pass.
- **GPU/속도**: 변경 안 함이 최선 (증거: AWQ 94 tok/s, GPU_UTIL 0.92, 생성 중 97~98% 실측 사용,
  spec-decode 는 07-05 실측 역효과 194→95 롤백 이력). vLLM health OK, MAX_MODEL_LEN 32768.
- **용량**: C: 여유 533GB — 대규모 정리 불필요. 삭제: unsloth_compiled_cache (3.3MB, 자동 재생성
  컴파일 캐시, 내용 확인 후). Flowvium 저장소 ~1.3GB 전부 기능성 (.next 605MB / node_modules 470MB).
- **/loop · Claude cron**: 없음 (끌 것 없음).

## 5. 정당한 미루기로 남긴 것 (근거 명시)

- Stooq batch 감사 FAIL 1건: 영구 봇차단 확인, 앱은 lib/stooq.ts Yahoo v7 crumb 폴백으로 정상
  동작(히트맵 실시세 실측) — 소생 감시용으로 non-critical 유지.
- 한자가드 TRACKED 5건 (company-news/log-cascade-events/supply-chain-signals/blog-translate/
  translate-headlines): check-hanja-coverage 가 가시 추적 중, check-deferrals 기한 관리.
- iv empty 10/10 표본: 옵션 없는 리츠류(AVB/EQR/ARE 등) — empty 분류(error 아님), 정상.

## 다음 세션 참고

- 에스컬레이션 첫 발화는 어떤 결함이든 2h 지속 시 — `logs/escalations.json` 확인 습관.
- probe10/company-pages 커서가 ETF 제외로 배열이 줄어 커서 위치가 이동함 (모듈로라 무해).
- 챗 폐루프 지표는 07-13 까지 07-06 사건이 7일 창에 남아 "악화"로 표시될 수 있음 — 정상.
