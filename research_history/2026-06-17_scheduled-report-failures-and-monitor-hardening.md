# 2026-06-17 — 스케줄 보고서 누락 근본원인 + 모니터 2차 전수조사

## 1. 스케줄 보고서 누락 (morning 06:40 + noon 11:40) — 근본원인 = Task 시간제한

**증상:** FlowVium-Morning(06:40) / FlowVium-Noon(11:40) 둘 다 `LastTaskResult 267014`
(= 0x41306 = SCHED_S_TASK_TERMINATED). 보고서 파일·Redis 세션키 미생성. 사이트는 직전 세션 서빙.

**근본원인:** 5개 report Task 의 `ExecutionTimeLimit = PT30M(30분)`. vLLM Qwen3-30B 풀파이프라인
생성이 30분을 초과하면 Windows Task Scheduler 가 매 세션 중도 강제종료. (midnight 는 30분 내
완료돼 발행됐지만 morning/noon 은 초과 → 죽음. 생성시간이 임계 근처라 세션마다 들쭉날쭉.)

**조치 (⚠️ 비-repo = Windows 스케줄러 설정, 머신 재구성 시 되돌아갈 수 있음):**
```powershell
foreach($n in 'FlowVium-Morning','FlowVium-Noon','FlowVium-Afternoon','FlowVium-Evening','FlowVium-Midnight'){
  $s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Set-ScheduledTask -TaskName $n -Settings $s
}
```
PT30M → **PT2H**. 트리거/액션 보존 확인.

**미해결 가능성:** noon 의 경우 report.log 에 git-fetch 라인조차 없음(morning 은 git-fetch 후 hang).
30분 한도가 1차 원인이지만, 로그 흔적 0 은 wscript 래퍼(run-report-hidden.vbs, sh.Run wait=True) 자체
hang 가능성도 시사. **검증: afternoon(15:40) 정규 실행이 PT2H 로 정상 발행되는지 확인.** 그래도 실패 시
Task Action 을 wscript → run-report.bat 직접 실행으로 전환(2차 fix).

**복구:** morning·noon 모두 `node scripts/generate-report-local.mjs --auto-upload` 직접 경로로 수동
재생성(스케줄러·wscript 우회). 둘 다 발행 완료(라이브 슬라이드 검증, 결함 0).

**관련 코드 fix (커밋됨):** `scripts/run-report.bat` git fetch hang 가드(GIT_TERMINAL_PROMPT=0 +
LOW_SPEED) — morning 의 git-fetch hang 대응(9c15b19). 단 이건 noon(git 전 hang)엔 무효 → 시간제한이 본질.

## 2. 모니터 2차 전수조사 — "검증자 자체가 조용히 안 도는" 클래스 (A+B+C)

VIX 프로브 early-return 이 verify-metrics accuracy stack 27→8 truncation. 메타근본: 결과 회계가
자기참조적이고 실패가 조용히 green. 수정: B 메타검증(기대 probe 레지스트리+그룹 floor→meta.* error,
metrics-db stale 부활 차단), A 제어흐름(audit-coverage bare probe try/catch, check-data-quality
main().catch, check-static-fallbacks exit code), C detector(빈배열 오탐, REAL-source 데이터손실 반전,
fedwatch substr, verify-report/audit-pages 튜닝). 커밋: baw1mcd4j.

## 3. Karpathy 회귀 경보 평균→중앙값 (21f4cf0)
midnight 보고서 1건 환각 15건(52w/ma_halluc) outlier 가 3개 평균을 왜곡 → 중앙값으로 outlier-robust화.

## 4. 쏠림(consensus crowding) 역발상 렌즈 (d894982)
buildNarrativePrompt + buildRiskMgmtPrompt 에 집단 행동 역학 역발상 지침. noon 보고서 첫 적용 확인
("인기 테마주 과밀로 인한 컨센서스 쏠림").
