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
      // 2026-06-12: 무중단 배포 — fork 단일이라 restart 마다 수초 공백(사용자가 500 직접 목격).
      //   cluster 2 instance + `pm2 reload flowvium-web`(rolling) 으로 공백 0. 배포 시 restart 금지.
      exec_mode: 'cluster',
      instances: 2,
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
