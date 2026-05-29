@echo off
cd /d "C:\NoAddsMakingApps\FlowVium"
set "LOG_FILE=C:\NoAddsMakingApps\FlowVium\logs\report.log"

:: 0. git fetch + 코드 파일만 selective checkout (2026-05-29 신설).
::    batch 가 옛 코드로 실행되어 snapshot/DART 로직 한 사이클 lag 사건 재발 방지.
::    data/flowvium.db, logs/, reports/ 는 로컬 runtime 산출물 — 덮어쓰지 않음.
echo [%DATE% %TIME%] [INFO] git fetch origin master + checkout scripts/src/data/dart-corp-codes.json ... >> "%LOG_FILE%"
git fetch --quiet origin master 2>> "%LOG_FILE%"
git checkout --quiet origin/master -- scripts/ src/ public/ messages/ data/dart-corp-codes.json data/candidate-tickers.json data/sp500-tickers.json data/kr-major-indexes.json package.json 2>> "%LOG_FILE%"
if errorlevel 1 (
  echo [%DATE% %TIME%] [WARN] git checkout 실패 — 현재 코드로 진행 >> "%LOG_FILE%"
)

:: 1. Ollama 실행 여부 확인
ollama list >nul 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] [ERROR] Ollama is not running >> "%LOG_FILE%"
  exit /b 1
)

:: 2. qwen3:8b 모델 존재 여부 확인
ollama list | findstr /I /C:"qwen3:8b" >nul 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] [ERROR] Model qwen3:8b not found in ollama list >> "%LOG_FILE%"
  exit /b 1
)

:: 3a. 외부 데이터 source 사전 체크 (silent failure 방지)
echo [%DATE% %TIME%] [INFO] Pre-flight: data source health check... >> "%LOG_FILE%"
"C:\Program Files\nodejs\node.exe" "C:\NoAddsMakingApps\FlowVium\scripts\audit-data-sources.mjs" >> "%LOG_FILE%" 2>&1
if errorlevel 2 (
  echo [%DATE% %TIME%] [FATAL] Critical data source failed — aborting report generation >> "%LOG_FILE%"
  exit /b 2
)

:: 3b. 보고서 생성 + 업로드 실행
echo [%DATE% %TIME%] [INFO] Starting report pipeline... >> "%LOG_FILE%"
"C:\Program Files\nodejs\node.exe" "C:\NoAddsMakingApps\FlowVium\scripts\generate-report-local.mjs" --model=qwen3:8b --auto-upload >> "%LOG_FILE%" 2>&1
set "PIPE_EXIT=%ERRORLEVEL%"

:: 4. 성공/실패 로그 기록
if "%PIPE_EXIT%"=="0" (
  echo [%DATE% %TIME%] [SUCCESS] Report pipeline completed successfully >> "%LOG_FILE%"
) else (
  echo [%DATE% %TIME%] [ERROR] Report pipeline failed with exit code %PIPE_EXIT% >> "%LOG_FILE%"
)

exit /b %PIPE_EXIT%
