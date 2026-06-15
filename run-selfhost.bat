@echo off
REM FlowVium ?먭??몄뒪??湲곕룞 ??next start(?? + cron-runner(?щ줎) ?숈떆.
REM 2026-06-02 Vercel ?댁쟾. ?ъ쟾: npm run build 1?? ?곸떆 ?댁쁺? pm2 沅뚯옣(MIGRATION-selfhost.md).
cd /d C:\Flowvium
echo [run-selfhost] next start :3000 + cron-runner (UTC) 湲곕룞...
start "flowvium-web" cmd /k "set NODE_ENV=production&& npm run start"
timeout /t 8 /nobreak >nul
start "flowvium-cron" cmd /k "set CRON_TZ=Etc/UTC&& node scripts\cron-runner.mjs"
echo [run-selfhost] ??李?湲곕룞?? Cloudflare Tunnel ? 蹂꾨룄(cloudflared tunnel run flowvium).
