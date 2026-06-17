@echo off
REM FlowVium 자가호스팅 기동 — next start(웹) + cron-runner(크론) 동시.
REM 2026-06-02 Vercel 이전. 사전: npm run build 1회. 상시 운영은 pm2 권장(MIGRATION-selfhost.md).
cd /d D:\Flowvium
echo [run-selfhost] next start :3000 + cron-runner (UTC) 기동...
start "flowvium-web" cmd /k "set NODE_ENV=production&& npm run start"
timeout /t 8 /nobreak >nul
start "flowvium-cron" cmd /k "set CRON_TZ=Etc/UTC&& node scripts\cron-runner.mjs"
echo [run-selfhost] 두 창 기동됨. Cloudflare Tunnel 은 별도(cloudflared tunnel run flowvium).
