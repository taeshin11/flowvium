@echo off
cd /d "C:\Flowvium"
set "LOG_FILE=C:\Flowvium\logs\report.log"
set "LOCK_DIR=C:\Flowvium\logs\report-pipeline.lock"

:: 0-pre. ?숈떆 ?ㅽ뻾 諛⑹? mutex (2026-06-11 ?좎꽕 ??6/7 hang 4???ㅼ슫 ?ш굔 ??StartWhenAvailable
::    遺??catch-up ?쒖꽦?? 遺??吏곹썑 5 ?몄뀡 task 媛 missed run ???숈떆 諛쒗솕?섎㈃ ?뚯씠?꾨씪??5媛쒓?
::    ??GPU ?먯꽌 寃쏀빀 ??怨쇰???hang ?꾪뿕. atomic mkdir lock + 5遺?誘몃쭔 ?먮뒗 ?댁븘?덈뒗 ?뚯씠?꾨씪??
::    ?덉쑝硫?skip(遺????fresh 蹂닿퀬??1媛쒕㈃ 異⑸텇). hang ?붿〈 lock ? ?쒓컙+?꾨줈?몄뒪 寃?щ줈 ?먮룞 steal.
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

:: 0. git fetch + 肄붾뱶 ?뚯씪留?selective checkout (2026-05-29 ?좎꽕).
::    batch 媛 ??肄붾뱶濡??ㅽ뻾?섏뼱 snapshot/DART 濡쒖쭅 ???ъ씠??lag ?ш굔 ?щ컻 諛⑹?.
::    data/flowvium.db, logs/, reports/ ??濡쒖뺄 runtime ?곗텧臾?????뼱?곗? ?딆쓬.
echo [%DATE% %TIME%] [INFO] git fetch origin master + checkout scripts/src/data/dart-corp-codes.json ... >> "%LOG_FILE%"
git fetch --quiet origin master 2>> "%LOG_FILE%"
git checkout --quiet origin/master -- scripts/ src/ public/ messages/ data/dart-corp-codes.json data/candidate-tickers.json data/sp500-tickers.json data/kr-major-indexes.json package.json 2>> "%LOG_FILE%"
if errorlevel 1 (
  echo [%DATE% %TIME%] [WARN] git checkout ?ㅽ뙣 ???꾩옱 肄붾뱶濡?吏꾪뻾 >> "%LOG_FILE%"
)

:: 1. Ollama ?ㅽ뻾 ?щ? ?뺤씤
ollama list >nul 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] [ERROR] Ollama is not running >> "%LOG_FILE%"
  rmdir "%LOCK_DIR%" 2>nul
  exit /b 1
)

:: 2. qwen3:8b 紐⑤뜽 議댁옱 ?щ? ?뺤씤
ollama list | findstr /I /C:"qwen3:8b" >nul 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] [ERROR] Model qwen3:8b not found in ollama list >> "%LOG_FILE%"
  rmdir "%LOCK_DIR%" 2>nul
  exit /b 1
)

:: 3a. ?몃? ?곗씠??source ?ъ쟾 泥댄겕 (silent failure 諛⑹?)
echo [%DATE% %TIME%] [INFO] Pre-flight: data source health check... >> "%LOG_FILE%"
"C:\Program Files\nodejs\node.exe" "C:\Flowvium\scripts\audit-data-sources.mjs" >> "%LOG_FILE%" 2>&1
if errorlevel 2 (
  echo [%DATE% %TIME%] [FATAL] Critical data source failed ??aborting report generation >> "%LOG_FILE%"
  rmdir "%LOCK_DIR%" 2>nul
  exit /b 2
)

:: 3b. 蹂닿퀬???앹꽦 + ?낅줈???ㅽ뻾
echo [%DATE% %TIME%] [INFO] Starting report pipeline... >> "%LOG_FILE%"
"C:\Program Files\nodejs\node.exe" "C:\Flowvium\scripts\generate-report-local.mjs" --model=qwen3:8b --auto-upload >> "%LOG_FILE%" 2>&1
set "PIPE_EXIT=%ERRORLEVEL%"

:: 4. ?깃났/?ㅽ뙣 濡쒓렇 湲곕줉
if "%PIPE_EXIT%"=="0" (
  echo [%DATE% %TIME%] [SUCCESS] Report pipeline completed successfully >> "%LOG_FILE%"
) else (
  echo [%DATE% %TIME%] [ERROR] Report pipeline failed with exit code %PIPE_EXIT% >> "%LOG_FILE%"
)

rmdir "%LOCK_DIR%" 2>nul
exit /b %PIPE_EXIT%
