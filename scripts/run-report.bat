@echo off
cd /d "C:\Flowvium"
set "LOG_FILE=C:\Flowvium\logs\report.log"
set "LOCK_DIR=C:\Flowvium\logs\report-pipeline.lock"

:: 0-pre. Concurrency mutex (atomic mkdir lock). Steal if stale >5min and no live gen proc.
mkdir "%LOCK_DIR%" 2>nul
if errorlevel 1 (
  powershell -NoProfile -Command "$d = Get-Item '%LOCK_DIR%' -ErrorAction SilentlyContinue; $age = if ($d) { ((Get-Date) - $d.CreationTime).TotalMinutes } else { 999 }; $alive = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'generate-report-local' }; if ($age -lt 5 -or $alive) { exit 1 } else { exit 0 }" >nul 2>&1
  if errorlevel 1 (
    echo [%DATE% %TIME%] [SKIP] another report pipeline running or just started - skip this session >> "%LOG_FILE%"
    exit /b 0
  )
  echo [%DATE% %TIME%] [WARN] stale pipeline lock detected - stealing >> "%LOG_FILE%"
  rmdir "%LOCK_DIR%" 2>nul
  mkdir "%LOCK_DIR%" 2>nul
)

:: 0. git fetch + selective checkout of code files (keep local runtime data: db, logs, reports).
echo [%DATE% %TIME%] [INFO] git fetch origin master + checkout scripts/src/data ... >> "%LOG_FILE%"
git fetch --quiet origin master 2>> "%LOG_FILE%"
git checkout --quiet origin/master -- scripts/ src/ public/ messages/ data/dart-corp-codes.json data/candidate-tickers.json data/sp500-tickers.json data/kr-major-indexes.json package.json 2>> "%LOG_FILE%"
if errorlevel 1 (
  echo [%DATE% %TIME%] [WARN] git checkout failed - proceeding with current code >> "%LOG_FILE%"
)

:: 1. vLLM server health check (2026-06-15 Ollama->vLLM migration; replaces 'ollama list' gate).
for /f %%S in ('curl -s -o nul -w "%%{http_code}" http://localhost:8000/v1/models 2^>nul') do set "VLLM_CODE=%%S"
if not "%VLLM_CODE%"=="200" (
  echo [%DATE% %TIME%] [ERROR] vLLM server (:8000) not responding ^(http=%VLLM_CODE%^) >> "%LOG_FILE%"
  rmdir "%LOCK_DIR%" 2>nul
  exit /b 1
)

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
