// pm2 프로세스 정의 — 자가호스팅 24/7 (web + cron-runner + cloudflared tunnel).
// 사용: pm2 start ecosystem.config.cjs ; pm2 save
// 부팅 지속: (Windows) pm2 save 후 Task Scheduler 에 "pm2 resurrect" 등록 또는 pm2-installer.
const ROOT = 'C:/NoAddsMakingApps/FlowVium';
module.exports = {
  apps: [
    {
      name: 'flowvium-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      cwd: ROOT,
      env: { NODE_ENV: 'production', PORT: '3000' },
      autorestart: true,
      max_restarts: 20,
    },
    {
      name: 'flowvium-cron',
      script: 'scripts/cron-runner.mjs',
      cwd: ROOT,
      env: { PORT: '3000', CRON_TZ: 'Etc/UTC' },
      autorestart: true,
    },
    {
      name: 'flowvium-tunnel',
      script: 'scripts/run-tunnel.cjs',  // .cf-tunnel-token 읽어 cloudflared 실행
      cwd: ROOT,
      autorestart: true,
    },
  ],
};
