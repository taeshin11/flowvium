@echo off
cd /d "C:\NoAddsMakingApps\FlowVium"
set "LOG_FILE=C:\NoAddsMakingApps\FlowVium\logs\report.log"

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

:: 3. 보고서 생성 + 업로드 실행
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
