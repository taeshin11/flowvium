@echo off
cd /d "C:\NoAddsMakingApps\FlowVium"
ollama list >nul 2>&1 || (echo Ollama not running & exit /b 1)
echo [%date% %time%] Generating... >> "C:\NoAddsMakingApps\FlowVium\logs\report.log"
"C:\Program Files\nodejs\node.exe" "C:\NoAddsMakingApps\FlowVium\scripts\generate-report-local.mjs" --model=ollama/qwen3:8b >> "C:\NoAddsMakingApps\FlowVium\logs\report.log" 2>&1
echo [%date% %time%] Done. >> "C:\NoAddsMakingApps\FlowVium\logs\report.log"
