@echo off
REM FlowVium self-host launcher - next start (web) + cron-runner (cron), together.
REM 2026-06-02 moved off Vercel. Prereq: npm run build once. For always-on use pm2 (MIGRATION-selfhost.md).
REM 2026-06-18: ASCII-only - cmd.exe on Korean Windows mis-decodes UTF-8 Korean (see run-report.bat note).
cd /d C:\Flowvium
echo [run-selfhost] starting next :3000 + cron-runner (UTC)...
start "flowvium-web" cmd /k "set NODE_ENV=production&& npm run start"
timeout /t 8 /nobreak >nul
start "flowvium-cron" cmd /k "set CRON_TZ=Etc/UTC&& node scripts\cron-runner.mjs"
echo [run-selfhost] both windows started. Cloudflare Tunnel is separate (cloudflared tunnel run flowvium).
