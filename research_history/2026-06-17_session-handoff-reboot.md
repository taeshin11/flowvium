# 2026-06-17 세션 인계장 (재부팅 전 핸드오프)

사용자가 컴퓨터 잠깐 껐다 켜야 함. 이 세션에서 한 일 + 재부팅 후 복구 절차 인계.

## 1. 이 세션에서 한 작업 (전부 커밋+푸시 완료 — origin/master 동기화 확인됨)

| 커밋 | 내용 |
|---|---|
| c4dbb6a | **④ KR 내부자 지분공시(DART elestock/majorstock)** — `src/lib/dart-insider.ts`, `/api/insider-kr[/ticker]`, `scan-insider-kr.mjs`, InsiderPage korea 탭, 16-lang. **⑤ US 작전주 매집** — `build-us-smallcap-universe.mjs`(Yahoo screener), `scan-accumulation --us`, `/api/accumulation-watch?market=us`, ScreenerPage 🇺🇸 카드. accumulation-detector volumeOnlyWatch tier + liquidity opt |
| a1cb482 | audit-coverage portfolio↔snapshot 게이트 = 신선(<36h)만 err, historical=warn |
| 51510b5→5e11cc9 | `.gitattributes` autocrlf wipe-risk 오발 수정 (messages/data JSON eol=lf 로 한정, autocrlf=true 유지) |
| bcc18a0 | verify-metrics 수정: stale 캐시키(short-interest v5→v6, market-caps v2→v3) + locked 유료API(options-flow/block-trades) 'skipped' + cron-fail detector 가 verify-metrics 헬스리포트 오분류 안 하게(top-level error 만) |
| 029650c | 보고서 공급계약 카드 **공시일 라벨**(📅 공시 MM-DD, DART rcept_dt) + **발간 前 critical 결함 게이트**(generate-report-local: PUBLISH_BLOCKING semantic 결함 시 auto-upload 차단) |
| a3e8355 | session-spotcheck [1] 라이브 재검 (wipe-risk→[8] 위임, HTTP 5xx 라이브 재확인해 회복분 drop) |
| d34c503 | **run-report.bat WMI hang 근본수정** — 락-스틸 Get-CimInstance 무한대기 → afternoon 좀비 54m. age<5m 빠른skip + -OperationTimeoutSec 10 + catch→steal |

## 1b. 추가 작업 (KOSPI 환각 + 사각지대 — 종료 직전 배치)

| 커밋 | 내용 |
|---|---|
| cb99e3b | **KOSPI 8,864 절대값 환각** 3중 방어 — verify-report probe(h) index_value_fabrication + PUBLISH_BLOCKING + **stripFabricatedIndexLevels()**(발간前 결정론 제거, krTickerToName 패턴). 모델이 앵커링으로 같은 8,864 반복 → 결정론 strip 만 보장. buildIndexLevelsBlock 결측지수 명시금지(가드에서 "8,864"예시 제거=자가강화 차단). **harness→학습루프(health audit 사각지대#5)**: harness silent 교정(이름/가격/레벨/통화/강등)을 hallucination_history(harness_*) 적재→anti-pattern 주입→모델학습. check-stall/audit-coverage 회귀추세는 harness_* 제외 |
| c24e8d8 | audit-coverage: render_audit_log.tab(탭별 결함전용 선택 NULL) STRUCTURAL_NULLS ack — verify-all 복구 |

- **라이브 afternoon 정리**: 라이브(07:37, 8,864×2)를 Redis 에서 pull→지수 strip→재발간. 재스캔 0 결함(8864/티커/garble/valence 전부 클린). (strip 잔여 "KOSPI를 기록" 약간 어색하나 거짓 아님.)
- **health audit 결과**: Karpathy loop·harness(24cat)·stall·모니터(전부 timeout 가드) 전부 WORKING. 잔여 사각지대(다음 세션): #1 S&P/Nasdaq 등 비-KR 지수 절대값 probe(현재 KOSPI/KOSDAQ만), #2 내러티브↔구조데이터 교차일치, #3 날짜/최신성 그라운딩, #4 섹터로테이션 방향. (KOSPI+harness 가 최고가치라 우선 처리.)
- **정리**: C: 795GB free(85%, 공간압박 없음 — 대형 모델캐시는 이미 정리됨). May 보고서 26개·verify 트레일 trim(12 유지) 경량 hygiene.

## 2. 인시던트 처리 (afternoon 미발행)
- 15:40 afternoon Task 의 wscript 래퍼가 54m 좀비(로그 0). 근본원인 = run-report.bat 의 WMI Get-CimInstance 무한대기(스테일 락 시). kill + 수동 재생성 발행(100/100) + 근본수정(d34c503).
- **Qwen3-30B-A3B 는 MoE(3B active)라 생성 ~2분 — 느린 적 없음, hang 이 늘 원인.** PT30M→PT2H 는 증상만 가렸던 것.

## 3. ★ 재부팅 후 복구 절차 ★

**자동 복구되는 것 (조치 불요):**
- **Memurai(Redis)**: Windows 서비스 Automatic → 부팅 시 자동. (6379)
- **Windows Task Scheduler** (보고서 5개 + Backup + vLLM + pm2-resurrect + pm2-watchdog): 전부 영속, 재부팅 생존.

**★ 단 하나 필수 수동 단계: 로그인 ★**
- **자동로그인 OFF (AutoAdminLogon=0)**. 재부팅 후 **사용자가 Windows 에 로그인**해야 onlogon 태스크(vLLM·pm2)가 발동한다.
- 로그인하면:
  - `FlowVium-vLLM` (onlogon) → WSL 에서 vLLM serve.sh 시작 (30B 모델 로드 ~1-2분).
  - `FlowVium-pm2-resurrect` (onlogon) → pm2 5개(web×2, cron, tunnel, redis-shim) 부활.
  - `FlowVium-pm2-watchdog` (15분 주기) → pm2 누락 시 백업 부활.

**로그인 후 검증 (안 떴으면 수동):**
```bash
# 1) vLLM 헬스 (200 떠야 함; 안 뜨면 ~2분 더 기다리거나 수동시작)
curl -s -o /dev/null -w "vLLM=%{http_code}\n" http://localhost:8000/v1/models
#    수동시작: schtasks //run //tn FlowVium-vLLM   (또는 WSL: pkill -f 'vllm serve' 후 재실행)
# 2) pm2 5개 online 확인
pm2 list
#    누락 시: pm2 resurrect
# 3) Memurai
powershell -NoProfile -Command "(Get-Service Memurai).Status"   # Running 이어야
# 4) 사이트
curl -s -o /dev/null -w "site=%{http_code}\n" https://flowvium.net
# 5) 종합 헬스
node D:/Flowvium/scripts/session-spotcheck.mjs   # OK 떠야 정상
```

## 4. ★ 모니터(폰 알림) 재가동 — 새 Claude 세션 필요 ★
- **session-spotcheck 의 폰 PushNotification 은 이 Claude 세션이 살아있을 때만 동작** (CronCreate 가 session-only, 마이그레이션 메모리 기록).
- **파일 기반 모니터(pm2 flowvium-cron 이 20분마다 logs/monitor-status.json 갱신 + auto-warm/fbPurge self-heal)는 pm2 부활하면 자동 재가동** — 폰 알림 없이도 돌아감.
- **폰 알림을 다시 받으려면**: 재부팅+로그인 후 **새 Claude(remote-control) 세션을 열고**, 거기서 주기적으로 `node D:/Flowvium/scripts/session-spotcheck.mjs` 를 돌리는 스팟체크 프롬프트를 재개하면 됨. (이 세션의 반복 프롬프트와 동일)

## 5. 미해결/추적 (다음 세션)
- verify-metrics 잔여 3 결함(기존, ④⑤ 무관): caps.live 10/30(market-caps 라이브 커버리지 설계), strategy.quality(thesis 길이), osint.sanctions(소스 구조). verify-metrics 가 계속 surface, [cron] 오발은 안 함.
- 다음 정규 발간: evening 21:10 KST 트리거 → 21:30 발간. run-report.bat WMI fix 적용 후 첫 정규실행이니 정상 발행 확인 권장.
- **발간/재생성마다 라이브 슬라이드 육안검열 의무** ([[report-publish-visual-verify]] 메모리).
