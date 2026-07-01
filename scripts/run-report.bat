@echo off
setlocal enabledelayedexpansion
cd /d "C:\Flowvium"
set "LOG_FILE=C:\Flowvium\logs\report.log"
set "LOCK_DIR=C:\Flowvium\logs\report-pipeline.lock"

:: 2026-06-18: ASCII-only (no Korean) - cmd.exe on Korean Windows parses .bat in CP949; the C->D migration
::   left this file UTF-8 which mis-decoded Korean comments/echo -> for-loop parse break -> bat died mid-run
::   leaving only lock/no-report (evening/midnight 2026-06-17 missing reports). Keep this file ASCII + CRLF.

:: 0-pre. Concurrency mutex (atomic mkdir lock). Steal if stale >5min and no live gen proc.
::   Stale-lock + WMI infinite-wait once hung the wrapper before its first log line. Guard: age<5m fast skip;
::   alive-check bounded by -OperationTimeoutSec 10; WMI error/timeout -> catch -> steal (fail-safe, never hang).
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
::   GIT_TERMINAL_PROMPT=0 = never block on credential prompt; LOW_SPEED = abort after 30s stalled transfer.
set "GIT_TERMINAL_PROMPT=0"
set "GIT_HTTP_LOW_SPEED_LIMIT=1000"
set "GIT_HTTP_LOW_SPEED_TIME=30"
echo [%DATE% %TIME%] [INFO] git fetch origin master + checkout scripts/src/data ... >> "%LOG_FILE%"
git fetch --quiet origin master 2>> "%LOG_FILE%"
git checkout --quiet origin/master -- scripts/ src/ public/ messages/ data/dart-corp-codes.json data/candidate-tickers.json data/sp500-tickers.json data/kr-major-indexes.json package.json 2>> "%LOG_FILE%"
if errorlevel 1 (
  echo [%DATE% %TIME%] [WARN] git checkout failed - proceeding with current code >> "%LOG_FILE%"
)

:: 1. vLLM server health check -- wait-retry loop (up to ~12min = 36 x 20s) for boot-dependent startup.
set "VLLM_CODE="
for /l %%i in (1,1,36) do (
  for /f %%S in ('curl -s -o nul -w "%%{http_code}" http://127.0.0.1:8000/v1/models 2^>nul') do set "VLLM_CODE=%%S"
  if "!VLLM_CODE!"=="200" goto :vllm_ok
  echo [%DATE% %TIME%] [INFO] waiting for vLLM 8000 %%i/36 ^(http=!VLLM_CODE!^) >> "%LOG_FILE%"
  timeout /t 20 /nobreak >nul 2>&1
)
echo [%DATE% %TIME%] [ERROR] vLLM server (:8000) not responding after ~12min ^(http=!VLLM_CODE!^) >> "%LOG_FILE%"
rmdir "%LOCK_DIR%" 2>nul
exit /b 1
:vllm_ok

:: 2. Pre-flight data source health check (silent-failure guard). exit>=2 = critical, abort.
echo [%DATE% %TIME%] [INFO] Pre-flight: data source health check... >> "%LOG_FILE%"
"C:\Program Files\nodejs\node.exe" "C:\Flowvium\scripts\audit-data-sources.mjs" >> "%LOG_FILE%" 2>&1
if errorlevel 2 (
  echo [%DATE% %TIME%] [FATAL] Critical data source failed - aborting report generation >> "%LOG_FILE%"
  rmdir "%LOCK_DIR%" 2>nul
  exit /b 2
)

:: 2.5 Ingest business-report full text (DART/SEC) into filings DB - rotating cursor, non-fatal.
::   Feeds stock-selection (resale-mix forensic) + deep-chat business grounding. Bounded ~40 tickers/run.
echo [%DATE% %TIME%] [INFO] Ingesting filings (DART/SEC full text)... >> "%LOG_FILE%"
"C:\Program Files\nodejs\node.exe" "C:\Flowvium\scripts\ingest-filings.mjs" --limit=40 >> "%LOG_FILE%" 2>&1

:: 2.7 Analyze accumulated chat Q&A verification logs (defect rate/types -> logs/chat-verify-status.json).
echo [%DATE% %TIME%] [INFO] Analyzing chat QnA logs... >> "%LOG_FILE%"
"C:\Program Files\nodejs\node.exe" "C:\Flowvium\scripts\analyze-chat-logs.mjs" >> "%LOG_FILE%" 2>&1

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
