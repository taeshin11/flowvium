@echo off
:: TabbyAPI 시작 헬퍼 — FlowVium 의 .tabby-venv 사용 (.tabbyapi/venv 별도 생성 X)
:: 사용: scripts\start-tabbyapi.bat
::
:: Endpoint: http://localhost:5000/v1 (OpenAI-compatible)
:: 종료: Ctrl+C

cd /d "%~dp0\.."

if not exist ".tabby-venv\Scripts\python.exe" (
    echo ERROR: .tabby-venv not found. Run scripts/setup-tabbyapi.ps1 first.
    exit /b 1
)

if not exist ".tabbyapi\config.yml" (
    echo ERROR: .tabbyapi/config.yml missing. Copy config_sample.yml and set model_name.
    exit /b 1
)

call .tabby-venv\Scripts\activate.bat

cd .tabbyapi
python start.py %*
