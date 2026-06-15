// pm2 ?꾨줈?몄뒪 ?뺤쓽 ???먭??몄뒪??24/7 (web + cron-runner + cloudflared tunnel).
// ?ъ슜: pm2 start ecosystem.config.cjs ; pm2 save
// 遺??吏?? (Windows) pm2 save ??Task Scheduler ??"pm2 resurrect" ?깅줉 ?먮뒗 pm2-installer.
const ROOT = 'C:/Flowvium';
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
      // 2026-06-12: 臾댁쨷??諛고룷 ??fork ?⑥씪?대씪 restart 留덈떎 ?섏큹 怨듬갚(?ъ슜?먭? 500 吏곸젒 紐⑷꺽).
      //   cluster 2 instance + `pm2 reload flowvium-web`(rolling) ?쇰줈 怨듬갚 0. 諛고룷 ??restart 湲덉?.
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
      script: 'scripts/run-tunnel.cjs',  // .cf-tunnel-token ?쎌뼱 cloudflared ?ㅽ뻾
      cwd: ROOT,
      autorestart: true,
    },
  ],
};

