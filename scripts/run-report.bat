@echo off
setlocal enabledelayedexpansion
cd /d "C:\Flowvium"
set "LOG_FILE=C:\Flowvium\logs\report.log"
set "LOCK_DIR=C:\Flowvium\logs\report-pipeline.lock"

:: 0-pre. Concurrency mutex (atomic mkdir lock). Steal if stale >5min and no live gen proc.
:: 2026-06-17 (afternoon 15:40 좀비 래퍼 54m 사건): 스테일 락 존재 시 Get-CimInstance(WMI)가 *타임아웃 없이*
::   무한대기 → run-report.bat 가 첫 로그 전에 hang → wscript 좀비(로그 0). 근본수정: ① age<5m 는 WMI 전에
::   빠르게 판정(skip) ② alive 체크는 -OperationTimeoutSec 10 으로 바운드 ③ WMI 오류/타임아웃 시 catch→steal
::   (hang 대신 진행=fail-safe). 락이 절대 파이프라인을 silent hang 시키지 못하게.
mkdir "%LOCK_DIR%" 2>nul
if errorlevel 1 (
  powershell -NoProfile -Command "$d = Get-Item '%LOCK_DIR%' -ErrorAction SilentlyContinue; $age = if ($d) { ((Get-Date) - $d.CreationTime).TotalMinutes } else { 999 }; if ($age -lt 5) { exit 1 }; try { $alive = Get-CimInstance Win32_Process -OperationTimeoutSec 10 -ErrorAction Stop | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'generate-report-local' }; if ($alive) { exit 1 } else { exit 0 } } catch { exit 0 }" >nul 2>&1
  if errorlevel 1 (
    echo [%DATE% %TIME%] [SKIP] another report pipeline running or just started - skip this session >> "%LOG_FILE%"
    exit /b 0
  )
  echo [%DATE% %TIME%] [WARN] stale pipeline lock detected - stealing >> "%LOG_FILE%"
  rmdir "%LOCK_DIR%" 2>nul
  mkdir "%LOCK_DIR%" 2>nul
)

:: 0. git fetch + selective checkout of code files (keep local runtime data: db, logs, reports).
:: 2026-06-17: hang 가드 (morning 06:40 누락 사건 — git fetch 가 자격증명 프롬프트/정체 전송에서 ~26분 무한대기
::   → Task Scheduler 시간제한 종료(267014) → 보고서 미발행). GIT_TERMINAL_PROMPT=0 = 프롬프트에 멈추지 않고
::   즉시 실패→로컬코드로 진행. LOW_SPEED = 전송 30s 정체 시 abort. 아래 errorlevel 가드가 실패를 흡수.
set "GIT_TERMINAL_PROMPT=0"
set "GIT_HTTP_LOW_SPEED_LIMIT=1000"
set "GIT_HTTP_LOW_SPEED_TIME=30"
echo [%DATE% %TIME%] [INFO] git fetch origin master + checkout scripts/src/data ... >> "%LOG_FILE%"
git fetch --quiet origin master 2>> "%LOG_FILE%"
git checkout --quiet origin/master -- scripts/ src/ public/ messages/ data/dart-corp-codes.json data/candidate-tickers.json data/sp500-tickers.json data/kr-major-indexes.json package.json 2>> "%LOG_FILE%"
if errorlevel 1 (
  echo [%DATE% %TIME%] [WARN] git checkout failed - proceeding with current code >> "%LOG_FILE%"
)

:: 1. vLLM server health check — wait-retry loop (2026-06-17 신설; 기존 즉시-abort 는 morning 06:40 트리거가
::    vLLM 기동(부팅 의존) 전이면 보고서 누락 → 최대 ~12분 대기(36회 x 20s)하며 200 대기. 그래도 안 뜨면 abort.
set "VLLM_CODE="
for /l %%i in (1,1,36) do (
  for /f %%S in ('curl -s -o nul -w "%%{http_code}" http://localhost:8000/v1/models 2^>nul') do set "VLLM_CODE=%%S"
  if "!VLLM_CODE!"=="200" goto :vllm_ok
  echo [%DATE% %TIME%] [INFO] vLLM(:8000) 대기 %%i/36 ^(http=!VLLM_CODE!^) >> "%LOG_FILE%"
  timeout /t 20 /nobreak >nul 2>&1
)
echo [%DATE% %TIME%] [ERROR] vLLM server (:8000) not responding after ~12min ^(http=!VLLM_CODE!^) >> "%LOG_FILE%"
rmdir "%LOCK_DIR%" 2>nul
exit /b 1
:vllm_ok

:: 2. Pre-flight data source health check (silent-failure guard).
echo [%DATE% %TIME%] [INFO] Pre-flight: data source health check... >> "%LOG_FILE%"
"C:\Program Files\nodejs\node.exe" "C:\Flowvium\scripts\audit-data-sources.mjs" >> "%LOG_FILE%" 2>&1
if errorlevel 2 (
  echo [%DATE% %TIME%] [FATAL] Critical data source failed - aborting report generation >> "%LOG_FILE%"
  rmdir "%LOCK_DIR%" 2>nul
  exit /b 2
)

:: 3. Generate report + upload (generate-report-local uses vLLM via VLLM_URL in .env.local).
echo [%DATE% %TIME%] [INFO] Starting report pipeline... >> "%LOG_FILE%"
"C:\Program Files\nodejs\node.exe" "C:\Flowvium\scripts\generate-report-local.mjs" --model=qwen3:8b --auto-upload >> "%LOG_FILE%" 2>&1
set "PIPE_EXIT=%ERRORLEVEL%"

if "%PIPE_EXIT%"=="0" (
  echo [%DATE% %TIME%] [SUCCESS] Report pipeline completed successfully >> "%LOG_FILE%"
) else (
  echo [%DATE% %TIME%] [ERROR] Report pipeline failed with exit code %PIPE_EXIT% >> "%LOG_FILE%"
)

rmdir "%LOCK_DIR%" 2>nul
exit /b %PIPE_EXIT%
