@echo off
REM run-monitor-deep.bat - dedicated scheduler for monitor-deep (2026-06-19, ChatGPT #17).
REM session-spotcheck detached spawn does not complete in production (157s) -> run as own 6h Task.
REM read-only (no vLLM impact). ASCII + CRLF (cmd CP949 safe).
cd /d "D:\Flowvium"
echo [%DATE% %TIME%] monitor-deep start >> "D:\Flowvium\logs\monitor-deep-task.log"
node scripts\monitor-deep.mjs --base=https://flowvium.net >> "D:\Flowvium\logs\monitor-deep-task.log" 2>&1
echo [%DATE% %TIME%] monitor-deep exit %ERRORLEVEL% >> "D:\Flowvium\logs\monitor-deep-task.log"