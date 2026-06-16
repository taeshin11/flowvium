# 2026-06-17 — 스케줄 보고서 미발행 진단 + 좀비 hang 근본수리 (A/B/C)

## 사용자 질문
"보고서가 정해진 시간에 안 나오는데, 시간이 오래 걸리면 차라리 작성 시작시간을 더 일찍 해야 되는 거 아냐?"

## 진단 — 전제가 틀림: "느려서"가 아니라 "안 돌아가서"
1. **생성은 빠름 (~3-5분)**: smoke 실측 Wave1 34s + Wave2 26s + critique 5s + fact-check 12종 각 1s + 스냅샷 3.2s.
   → 시작시각을 당겨도 무의미.
2. **스케줄 보고서가 사실상 미발행**: report.log 마지막 성공이 **5월 8일**. 오늘 보인 "정시 보고서"(noon 15:00,
   afternoon 16:08)는 실은 내 세션 smoke/test 런이 우연히 만든 것 — 06:40/11:40/15:40 schedule 과 불일치.
3. **wscript 래퍼 좀비**: 3개 발견(최대 10h), 전부 **node 자식 없음** = node 는 이미 종료됐는데 **wscript 가
   안 죽음**. 좀비가 report.log 핸들/락을 물고 → 다음 스케줄 런 cascade stall.
4. 발견 시점 라이브가 **afternoon 16:08 에서 11시간 정체** (evening 21:10 + midnight 23:40 둘 다 실패).

## 수리 (A/B/C 전부) + 즉시 발행
### A. generate-report-local.mjs — 발간 후 process.exit(0) 강제
- main 진입(IS_MAIN_MODULE)에서 `generateViaOllama()` resolve 후 명시적 종료가 없었음 → undici(fetch)
  keep-alive 소켓(vLLM/Yahoo/Upstash 풀)이 event loop 를 살려둬 node 미종료 가능 → 래퍼 무한대기.
  `done.then(()=>process.exit(0))` 로 결정론적 종료. post-publish-recheck 는 detached+unref 라 독립 생존.

### B. Task Scheduler 5개 보고서 태스크 (machine config, git 외부)
- `ExecutionTimeLimit=PT30M`: hung wscript 트리를 30분 후 강제 종료(생성 5분+정시sleep≤25분 커버, 다년 hang 차단).
- `MultipleInstances=IgnoreNew`: 이전 인스턴스 실행 중이면 새 트리거 무시(스택 방지).
- 적용: Morning/Noon/Afternoon/Evening/Midnight.

### C. run-report.bat — vLLM health check 즉시-abort → wait-retry 루프
- `setlocal enabledelayedexpansion` + `for /l (1,1,36)` 20s 간격 최대 ~12분 200 대기. morning 06:40 트리거가
  vLLM 기동(부팅 의존, 오늘 08:32 기동) 전이어도 즉시 누락 안 하고 대기. 그래도 안 뜨면 abort.
- isolation 테스트: `VLLM_OK code=200 exit=0` ✓.

### 즉시 발행
- KST 03:31 현재 세션=midnight. `node generate-report-local --auto-upload` → **발행 성공**:
  라이브 `session=midnight gen=03:33 KST source=Qwen3-30B-AWQ`. 11h 정체 해소.
- 좀비 4개(누적) kill 완료. 최종 wscript=0, gen node 깔끔히 종료 확인.

## 후속(미해결, 별도)
- 왜 wscript 가 간헐적으로 안 죽는지(Windows WshShell.Run bWaitOnReturn 잔류) 정확 메커니즘 — B 의
  ExecutionTimeLimit 가 안전망이라 운영상 해소. 결정론적 재현 시 wrapper 를 PowerShell Start-Process -Wait 로 교체 검토.
- vLLM 부팅 자동기동(현재 08:32 수동/logon 의존) — boot 트리거 확인 필요(morning 06:40 보장).
